-- Cleanup script for customer_retention_snapshots table
-- Deletes rows matching any of these criteria:
--   1. Date is 2025-09-26 or earlier
--   2. Customer email is steph@example.com
--   3. Customer email is nick@example.com

-- First, let's see what will be deleted (DRY RUN - uncomment to preview)
-- SELECT date, customer_email, customer_name, COUNT(*) as row_count
-- FROM customer_retention_snapshots
-- WHERE date <= '2025-09-26'
--    OR customer_email IN ('steph@example.com', 'nick@example.com')
-- GROUP BY date, customer_email, customer_name
-- ORDER BY date DESC;

-- Show total count before deletion
SELECT
  COUNT(*) as total_rows_before_deletion,
  COUNT(CASE WHEN date <= '2025-09-26' THEN 1 END) as rows_with_old_dates,
  COUNT(CASE WHEN customer_email IN ('steph@example.com', 'nick@example.com') THEN 1 END) as rows_with_specific_emails
FROM customer_retention_snapshots;

-- Perform the deletion
DELETE FROM customer_retention_snapshots
WHERE date <= '2025-09-26'
   OR customer_email IN ('steph@example.com', 'nick@example.com');

-- Show total count after deletion
SELECT COUNT(*) as total_rows_after_deletion
FROM customer_retention_snapshots;

-- Show remaining date range
SELECT
  MIN(date) as earliest_date,
  MAX(date) as latest_date,
  COUNT(DISTINCT date) as unique_dates,
  COUNT(*) as total_snapshots
FROM customer_retention_snapshots;

-- Show sample of remaining data
SELECT date, customer_email, customer_name, subscription_status, is_counted
FROM customer_retention_snapshots
ORDER BY date DESC
LIMIT 10;