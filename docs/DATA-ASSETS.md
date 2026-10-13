# Data assets

## Never modify

- `data/warehouse/*.parquet` — pre-built upstream in `cbms-demo`; not regenerated here
- `data/2024-CBMS-Data-Dictionary.json`
- Warehouse view shapes: `barangay`, `household`, `person`, `v_barangay_summary`

## Build flow

`apps/chat-app/public/data/` is build-generated — copied from `data/` by `prebuild`
(`scripts/copy-data.mjs`) — and is gitignored. Edit `data/`, never the generated copy.
