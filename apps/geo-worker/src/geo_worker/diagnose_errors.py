"""Compatibility entrypoint; implementation lives in geo_worker.research.diagnose_errors."""
from geo_worker.research.diagnose_errors import (
    _pixel_area_ha,
    _metrics,
    _important_polygons,
    _panel,
    diagnose,
    main,
    CLASSES,
)

if __name__ == "__main__":
    main()
