"""Testes dos invariantes físicos das duas cenas reais e da auditoria."""

import json
import tempfile
import unittest
from pathlib import Path

from geo_worker.audit_scene import audit


ROOT = Path(__file__).resolve().parents[3]


class GeospatialAuditTests(unittest.TestCase):
    def test_two_scenes_have_same_grid_and_real_spectral_data(self):
        with tempfile.TemporaryDirectory() as directory:
            report_path = Path(directory) / "auditoria.json"
            report = audit(
                ROOT / "data/sample/imagem_multiespectral.tif",
                ROOT / "data/sample/qualidade_scl.tif",
                ROOT / "data/additional/imagem_adicional_multiespectral.tif",
                ROOT / "data/additional/qualidade_adicional_scl.tif",
                ROOT / "data/reference/mapbiomas_2025_recorte_30m.tif",
                report_path,
            )
            self.assertTrue(report["same_projected_grid"])
            self.assertEqual(report["primary"]["pixel_size_m"], [10.0, 10.0])
            self.assertEqual(report["primary"]["pixel_area_ha"], 0.01)
            self.assertEqual(report["primary"]["scales"], [0.0001] * 4)
            self.assertEqual(report["primary"]["offsets"], [-0.1] * 4)
            self.assertNotEqual(
                report["primary"]["ndvi_percentiles_clear"],
                report["additional"]["ndvi_percentiles_clear"],
            )
            self.assertGreater(report["reference_class_pixels_10m_grid"]["46"], 0)
            self.assertTrue(json.loads(report_path.read_text())["does_not_establish_coffee_ground_truth"])


if __name__ == "__main__":
    unittest.main()
