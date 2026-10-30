"""Compatibility entrypoint; implementation lives in geo_worker.research.visual_review."""
from geo_worker.research.visual_review import (
    _satellite_images,
    _projected_geometry_mask_bounds,
    _draw_outline,
    _panel,
    create_visual_review,
    main,
    COLORS,
)

if __name__ == "__main__":
    main()
