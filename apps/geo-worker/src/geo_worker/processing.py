"""Compatibility CLI/imports for the historical spectral-screening baseline.

Canonical implementation: geo_worker.research.spectral_screening.
Shared production helpers live in geo_worker.pipeline, not this prototype.
"""
from geo_worker.research.spectral_screening import INDEX_THRESHOLDS, process_scene, main
from geo_worker.pipeline.features import MAX_PIXELS, align_scl as _load_scl, normalized_difference as _normalized_difference
from geo_worker.pipeline.geometry import GEOD, candidate_polygons as _polygons
from geo_worker.pipeline.rendering import (
    rgb_composite as _visualize_rgb,
    draw_candidate_outlines as _draw_candidate_outlines,
    save_leaflet_raster as _save_leaflet_raster,
)

if __name__ == "__main__":
    main()
