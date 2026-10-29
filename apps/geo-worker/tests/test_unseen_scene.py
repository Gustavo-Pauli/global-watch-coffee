"""Verifica o teste temporal separado do conjunto usado no treinamento."""

import json
import tempfile
import unittest
from pathlib import Path

from geo_worker.audit_scene import inspect_scene
from geo_worker.evaluate_reference import evaluate
from geo_worker.visual_review import create_visual_review


ROOT = Path(__file__).resolve().parents[3]


class UnseenSceneTests(unittest.TestCase):
    def test_october_scene_does_not_belong_to_training_and_has_valid_radiometry(self):
        training = json.loads((ROOT / "apps/geo-worker/models/v1/treinamento.json").read_text())
        self.assertEqual(len(training["training_images"]), 2)
        self.assertNotIn("unseen", " ".join(training["training_images"]))
        audit = inspect_scene(
            ROOT / "data/unseen/imagem_adicional_multiespectral.tif",
            ROOT / "data/unseen/qualidade_adicional_scl.tif",
            "2025-10-25",
        )
        self.assertEqual(audit["shape_pixels"], [512, 512])
        self.assertGreater(audit["valid_clear_pixel_count"], 250_000)
        self.assertEqual(audit["offsets"], [-0.1] * 4)

    def test_temporal_failure_is_measurable_without_changing_classifier(self):
        with tempfile.TemporaryDirectory() as folder:
            report = evaluate(
                ROOT / "data/sample/imagem_multiespectral.tif",
                ROOT / "data/reference/mapbiomas_2025_recorte_30m.tif",
                {"aug_jul": ROOT / "experiments/outputs/model/candidatos.geojson",
                 "oct_unseen": ROOT / "experiments/outputs/model_outubro/candidatos.geojson"},
                Path(folder),
            )
            self.assertFalse(report["comparison_is_validation_against_field_truth"])
            self.assertGreater(report["comparisons"]["oct_unseen"]["candidate_overlap_reference_forest_ha"], 60)
            self.assertLess(report["comparisons"]["oct_unseen"]["candidate_overlap_reference_coffee_ha"], 10)

    def test_visual_review_georeferences_the_same_polygons_across_three_dates(self):
        with tempfile.TemporaryDirectory() as folder:
            report = create_visual_review(
                ROOT / "data/sample/imagem_multiespectral.tif",
                ROOT / "data/additional/imagem_adicional_multiespectral.tif",
                ROOT / "data/unseen/imagem_adicional_multiespectral.tif",
                ROOT / "data/reference/mapbiomas_2025_recorte_30m.tif",
                ROOT / "experiments/outputs/model/candidatos.geojson", Path(folder), ids=(33,),
            )
            self.assertEqual(report[0]["polygon_id"], 33)
            self.assertTrue((Path(folder) / "poligono_33_inspecao.png").is_file())
            self.assertLess(report[0]["center"]["lat"], -21)


if __name__ == "__main__":
    unittest.main()
