"""Compatibility entrypoint; implementation lives in geo_worker.research.coffee_model."""
from geo_worker.research.coffee_model import (
    scene_features,
    aligned_reference,
    _sample_balanced,
    train,
    _predicted_scores,
    classify,
    main,
    FEATURE_NAMES,
    LABEL_COFFEE,
    MAX_SAMPLES_PER_NEGATIVE_CLASS,
    MAX_SAMPLES_COFFEE,
    PREDICTION_CUTOFF,
)

if __name__ == "__main__":
    main()
