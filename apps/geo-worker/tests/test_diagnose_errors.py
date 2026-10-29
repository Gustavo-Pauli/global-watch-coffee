"""Garantias para a comparação temporal e a sensibilidade, sem dados sintéticos fixos."""

import tempfile
import unittest
from pathlib import Path

from geo_worker.diagnose_errors import diagnose
from geo_worker.threshold_sensitivity import compare_thresholds


ROOT = Path(__file__).resolve().parents[3]


class DiagnosisTests(unittest.TestCase):
    def test_reference_errors_are_measured_from_real_output_polygons(self):
        with tempfile.TemporaryDirectory() as folder:
            result = diagnose(
                ROOT / "data/sample/imagem_multiespectral.tif",
                ROOT / "data/reference/mapbiomas_2025_recorte_30m.tif",
                {
                    "baseline": ROOT / "experiments/outputs/baseline/candidatos.geojson",
                    "rf_aug": ROOT / "experiments/outputs/model_uma_data/candidatos.geojson",
                    "rf_jul": ROOT / "experiments/outputs/model_adicional/candidatos.geojson",
                    "rf_both": ROOT / "experiments/outputs/model/candidatos.geojson",
                },
                Path(folder),
            )
            self.assertTrue((Path(folder) / "mapa_erros_referencia.png").exists())
            self.assertTrue(result["does_not_change_model_or_predictions"])
            self.assertGreater(result["variants"]["baseline"]["reference_forest_overlap_ha"], 800)
            self.assertLess(result["variants"]["rf_both"]["reference_forest_overlap_ha"], 12)
            self.assertGreater(len(result["largest_rf_both_polygons_by_area_disagreeing_with_reference"]), 3)

    def test_higher_cutoff_reduces_candidate_area_without_claiming_accuracy(self):
        with tempfile.TemporaryDirectory() as folder:
            report = compare_thresholds(
                ROOT / "data/sample/imagem_multiespectral.tif",
                ROOT / "data/sample/qualidade_scl.tif",
                ROOT / "data/additional/imagem_adicional_multiespectral.tif",
                ROOT / "data/additional/qualidade_adicional_scl.tif",
                ROOT / "apps/geo-worker/models/v1/coffee_rf.joblib",
                ROOT / "data/reference/mapbiomas_2025_recorte_30m.tif",
                Path(folder) / "sensibilidade.json",
                thresholds=(0.6, 0.8),
            )
            first, second = report["results"]
            self.assertGreater(first["candidate_area_ha_rasterized"], second["candidate_area_ha_rasterized"])
            self.assertGreater(first["reference_coffee_covered_pct"], second["reference_coffee_covered_pct"])
            self.assertFalse(report["model_was_retrained"])
            self.assertFalse(report["is_field_validation"])


if __name__ == "__main__":
    unittest.main()
