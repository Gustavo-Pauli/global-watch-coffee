"""Compatibility entrypoint; implementation lives in geo_worker.research.evaluate_reference."""
from geo_worker.research.evaluate_reference import (
    _load_polygon_mask,
    evaluate,
    main,
)

if __name__ == "__main__":
    main()
