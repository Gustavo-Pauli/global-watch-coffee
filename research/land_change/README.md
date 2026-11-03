# Amazon pilot: frozen comparison protocol

Study `amazon-land-change-20261102-v1`, registered before model inference.

The question is which deserves further development: recent vegetation-loss detection
with follow-up land use, or regional land-cover classification. This is a small
feasibility study, not field validation or proof of national superiority.

## Fixed scope

- Novo Progresso/PA: development area; Belterra/PA: geographic holdout.
- Observation cutoff: 2026-11-02 23:59:59 UTC. Recent window starts 2026-08-01.
- Same-season August-October 2025 scenes provide the baseline. A difference
  from 2025 does not establish that removal happened during the recent window.
- Public Sentinel-2 C1 L2A only; no purchases, paid APIs or production services.
- Six reflectance bands: B02/B03/B04/B08/B11/B12. SWIR is natively 20 m;
  resampling onto a 10 m grid does not create 10 m SWIR information.
- SCL 4/5/6 and finite data define usable pixels. Unknown/obscured is not stable.
- A 20 GB local-data ceiling and two concurrent data jobs.

## Selection and references

`study.json` freezes coordinates, dates, seed and data selection. STAC metadata
and AOI SCL quality are inventoried before predictions. Select the clearest full
coverage observation in each eight-day bin, then evenly subsample to four
baseline/twelve recent observations. Scene-wide cloud percentage is informational;
selection uses the pilot footprint. Missing scenes and acquisition failures stay
in the audit. Two distinct calendar dates are needed for persistence.

Reference samples are selected and reviewed without model predictions or MapBiomas
classes on screen. Record source dates, interpretation, uncertainty and reviewer
for each sample. AI-assisted visual interpretation must be identified as such;
it is not a substitute for independent expert or field validation. Ambiguous
crop/pasture, tiny water bodies and mixed patches remain unknown rather than
being forced into a class. A model-generated or reference-product label must
never silently become an independent test label.

The initial unreviewed screening cards were archived as `review-v1-unaligned/`.
Before annotation, centers were snapped to the global 16-pixel grid plus eight
pixels. This sampling revision makes reference, spectral and TerraMind features
describe the same 160 m square. No labels or accuracy results informed that change.

## Experiments and evaluation

1. Detection: NDVI/NBR seasonal baseline, robust change thresholds, persistence,
   candidate polygons >=0.5 ha. Distinguish the first possible change, last
   intact observation, confirmation date, and left-censored events. A vegetation
   anomaly alone is neither permanent deforestation nor attribution of cause.
2. Classification: spectral/temporal Random Forest versus TerraMind Tiny with
   a frozen encoder and lightweight head. Start with feasibility and document
   native prediction support. Patch embeddings cannot be represented as validated
   10 m pixel predictions. No generated sensor imagery is used as evidence.
3. Candidate classes: forest, pasture, cropland, exposed soil, water; ambiguous
   interpretation or insufficient support makes a class inconclusive.
4. Spatially disjoint development/validation/test groups in Novo Progresso;
   Belterra is reserved for transfer evaluation. The same patch/parcel, or
   adjacent duplicated pixels across dates, must not leak across partitions.
   Distinct 1 km sampling cells alone do not establish statistical independence:
   frozen TerraMind tokens share the 2.24 km inference-window context. Geographic
   transfer is the stronger separation check; no local interval assumes independent
   pixels or tokens merely because their centers occupy different cells.
5. Independent labels, if sufficient, support precision/recall/F1 and block-level
   intervals. Weak-reference concordance and unsupervised separability are reported
   separately and cannot substantiate accuracy or superiority claims.
   Before any annotation, local evaluation gates were amended to five blocks
   per class for the small validation/test folds; training and geographic-transfer
   evaluation retain ten. This is exploratory visual agreement, not a population
   accuracy estimate. No confidence intervals are claimed until implemented and
   supported. The amendment follows frame sizes, not measured model performance.
6. Compare published products only where access, dates, definitions and spatial
   support match. Inaccessible products remain unavailable. No-date change is
   not treated as a measured detection lag; timing is interval-censored.

Report missing labels, false alerts, omission uncertainty, geographic transfer,
time/VRAM/disk use and manual interpretation effort. Model comparisons use the
same evidence cutoff. No hyperparameter search on holdout results.

## Commands and artifacts

Run from repository root with the existing worker Python:

```powershell
apps/geo-worker/.venv/Scripts/python.exe -m research.land_change.acquire
```

Large files, source metadata and generated reports go under
`experiments/outputs/land-change/` (ignored). Each completed scene stores hashes,
source asset URLs, dates, physical scale conversion and regional clear coverage.
Re-running acquisition reuses completed scenes and the frozen inventory.
Model dependencies live in a separate research `.venv`; application dependencies,
APIs and the database are not part of this study.

The final result may recommend A, B, a combination, or explicitly state that the
available evidence does not yet support a choice. A lack of independent labels
prevents an accuracy-based winner; it does not justify fabricated metrics.

Generate local review artifacts after acquisition and detection:

```powershell
apps/geo-worker/.venv/Scripts/python.exe -m research.land_change.review
apps/geo-worker/.venv/Scripts/python.exe -m research.land_change.cases
apps/geo-worker/.venv/Scripts/python.exe -m research.land_change.annotate
apps/geo-worker/.venv/Scripts/python.exe -m research.land_change.classify --embedding-root experiments/outputs/land-change/model-probe
apps/geo-worker/.venv/Scripts/python.exe -m research.land_change.report
```

Open `experiments/outputs/land-change/report.html` for measured results or
`annotate.html` for a prediction-free classification annotation view. Exported
labels preserve the sampling/manifest freeze and reviewer provenance. Do not
label yourself an expert unless that accurately describes your review.

Contains modified Copernicus Sentinel data (2025, 2026). Other source products
and pretrained models retain their own attribution and license conditions.
