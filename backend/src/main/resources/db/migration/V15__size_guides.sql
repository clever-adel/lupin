-- Each product may carry its own size chart: what is measured (the body or the garment), one row per
-- measurement with a value per size code, and an optional note. Null means "no chart for this product".
alter table products add column size_guide jsonb;
