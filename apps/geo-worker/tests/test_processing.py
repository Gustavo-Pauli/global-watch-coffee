"""Verificações independentes com imagens sintéticas georreferenciadas."""

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from geo_worker.processing import process_scene


class ProcessingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.raster = self.root / "image.tif"
        self.scl = self.root / "scl.tif"
        self.data = np.empty((4, 64, 64), dtype="uint16")
        self.data[0] = 1500  # B02 -> 0.05 reflectância
        self.data[1] = 1700  # B03 -> 0.07
        self.data[2] = 2000  # B04 -> 0.10
        self.data[3] = 2200  # B08 -> 0.12; NDVI baixo

    def write_raster(self, data=None):
        data = self.data if data is None else data
        with rasterio.open(
            self.raster,
            "w",
            driver="GTiff",
            width=data.shape[2],
            height=data.shape[1],
            count=data.shape[0],
            dtype="uint16",
            nodata=0,
            crs="EPSG:32723",
            transform=from_origin(323200, 7642980, 10, 10),
        ) as dst:
            dst.write(data)
            dst.scales = (0.0001,) * data.shape[0]
            dst.offsets = (-0.1,) * data.shape[0]

    def write_scl(self, cloudy=False):
        labels = np.full((32, 32), 4, dtype="uint8")
        if cloudy:
            labels[11:14, 11:14] = 9
        with rasterio.open(
            self.scl,
            "w",
            driver="GTiff",
            width=32,
            height=32,
            count=1,
            dtype="uint8",
            crs="EPSG:32723",
            transform=from_origin(323200, 7642980, 20, 20),
        ) as dst:
            dst.write(labels, 1)

    def test_polygon_area_and_outputs_come_from_pixels(self):
        self.data[1, 10:50, 10:50] = 1900  # verde -> 0.09
        self.data[2, 10:50, 10:50] = 1600  # vermelho -> 0.06
        self.data[3, 10:50, 10:50] = 4200  # NIR -> 0.32
        self.write_raster()
        self.write_scl(cloudy=True)
        result = process_scene(self.raster, self.root / "output", self.scl, "2025-08-16")
        geojson = json.loads((self.root / "output/candidatos.geojson").read_text())

        self.assertGreater(result["candidate_polygon_count"], 0)
        self.assertLess(result["candidate_area_ha"], 16)
        self.assertGreater(result["candidate_area_ha"], 10)
        self.assertFalse(result["is_coffee_detection_validated"])
        self.assertEqual(result["offsets"], [-0.1] * 4)
        self.assertEqual(result["scl_applied"], True)
        self.assertEqual(len(geojson["features"]), result["candidate_polygon_count"])
        self.assertTrue((self.root / "output/imagem_classificada.png").exists())
        self.assertTrue((self.root / "output/imagem_mapa.png").exists())

    def test_no_candidates_and_nodata(self):
        self.data[:, :10, :10] = 0
        self.write_raster()
        result = process_scene(self.raster, self.root / "output")
        self.assertEqual(result["candidate_polygon_count"], 0)
        self.assertEqual(result["candidate_area_ha"], 0)
        self.assertEqual(result["valid_pixels"], 64 * 64 - 10 * 10)

    def test_invalid_band_count_is_rejected(self):
        self.write_raster(self.data[:3])
        with self.assertRaisesRegex(ValueError, "quatro bandas"):
            process_scene(self.raster, self.root / "output")


if __name__ == "__main__":
    unittest.main()
