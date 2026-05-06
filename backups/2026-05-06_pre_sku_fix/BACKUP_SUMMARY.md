# Backup 2026-05-06 — pre-sku-fix

Taken before deleting bad recipe records created by mistaken POS Excel import.

## Table counts
- dough_usage: 0 rows
- expenses: 33 rows
- fixed_workers: 4 rows
- ingredient_aliases: 13 rows
- ingredients: 415 rows
- invoices: 0 rows
- labor_log: 0 rows
- packaging_rules: 0 rows
- pos_products: TABLE DOES NOT EXIST YET (migration not applied to Railway)
- production_log: 0 rows
- production_logs: 0 rows
- purchase_orders: 0 rows
- recipes: 222 rows (204 legitimate + 18 bad from POS import)
- sales_log: 0 rows
- scan_corrections: 0 rows
- stock_audits: 0 rows
- suppliers: 0 rows

## Bad records to delete: IDs 205–222 (18 records)
Created today 2026-05-06 between 12:34:56–12:35:04.
All have: no ingredients, no category, created by `handleRecExcel` (wrong button).
None have name collisions with pre-existing recipes.

## Root cause
Two visually-similar "import Excel" buttons exist on the recipes page:
1. "📊 ייבא מאקסל" → handleRecExcel → writes to recipes table (WRONG button used)
2. "🏪 ייבוא מקטים מקופה" → handlePosSkuExcel → writes to pos_products (CORRECT)

Secondary issue: pos_products table doesn't exist on Railway (migration 0002_pos_sku.sql not applied).
