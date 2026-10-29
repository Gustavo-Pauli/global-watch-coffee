"""Testes adicionais do classificador, com referência e cena reais do kit."""

import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio

from geo_worker.coffee_model import aligned_reference, classify, scene_features


ROOT = Path(__file__).resolve().parents[3]


class ModelTests(unittest.TestCase):
    def test_features_are_derived_from_supplied_radiometry(self):
        data, valid, reflectance, _ = scene_features(
            ROOT / "data/sample/imagem_multiespectral.tif",
            ROOT / "data/sample/qualidade_scl.tif",
        )
        self.assertEqual(data.shape, (512, 512, 12))
        self.assertGreater(int(valid.sum()), 250000)
        self.assertLess(float(reflectance[2].mean()), 0.15)

    def test_aligned_external_reference_has_coffee_and_forest(self):
        reference = aligned_reference(
            ROOT / "data/reference/mapbiomas_2025_recorte_30m.tif",
            ROOT / "data/sample/imagem_multiespectral.tif",
        )
        self.assertEqual(reference.shape, (512, 512))
        self.assertGreater(int((reference == 46).sum()), 100)
        self.assertGreater(int((reference == 3).sum()), 1000)

    def test_model_output_is_explicitly_not_field_validated(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "processed"
            stats = classify(
                ROOT / "data/sample/imagem_multiespectral.tif",
                output,
                ROOT / "apps/geo-worker/models/v1/coffee_rf.joblib",
                ROOT / "data/sample/qualidade_scl.tif",
            )
            self.assertGreater(stats["candidate_polygon_count"], 0)
            self.assertFalse(stats["is_coffee_detection_validated"])
            self.assertTrue((output / "candidatos.geojson").is_file())
            self.assertTrue((output / "imagem_classificada.png").is_file())
            with rasterio.open(ROOT / "data/sample/imagem_multiespectral.tif") as input_image:
                self.assertIsNotNone(input_image.crs)

    def test_classification_is_recomputed_for_modified_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            altered = Path(directory) / "altered.tif"
            with rasterio.open(ROOT / "data/sample/imagem_multiespectral.tif") as source:
                bands = source.read()
                # NDVI próximo de zero em todos os pixels, sem usar valores
                # fixos previamente gerados pela execução da cena original.
                bands[3] = np.maximum(1, bands[2] + 10)
                with rasterio.open(altered, "w", **source.profile) as dst:
                    dst.write(bands)
                    dst.scales = source.scales
                    dst.offsets = source.offsets
            model = ROOT / "apps/geo-worker/models/v1/coffee_rf.joblib"
            original_result = classify(ROOT / "data/sample/imagem_multiespectral.tif", Path(directory) / "original", model)
            altered_result = classify(altered, Path(directory) / "altered", model)
            self.assertNotEqual(original_result["candidate_area_ha"], altered_result["candidate_area_ha"])


if __name__ == "__main__":
    unittest.main()
