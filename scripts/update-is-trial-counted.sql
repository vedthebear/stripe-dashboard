-- Update is_trial_counted field for all rows in customer_retention_snapshots
-- Based on the shouldCountTrial logic from the codebase:
--   1. subscription_status must be 'trialing'
--   2. Must not be canceled (we don't have canceled_at in snapshots, so check is_active = true)
--   3. Customer email must not end with 'usebear.ai'
--   4. Must not have 100% discount (we don't track discount in snapshots, so skip this check)

-- Preview how many rows will be affected (DRY RUN - uncomment to preview)
-- SELECT
--   COUNT(*) as total_rows,
--   COUNT(CASE
--     WHEN subscription_status = 'trialing'
--       AND is_active = true
--       AND (customer_email NOT LIKE '%usebear.ai' OR customer_email IS NULL)
--     THEN 1
--   END) as will_be_trial_counted,
--   COUNT(CASE
--     WHEN NOT (
--       subscription_status = 'trialing'
--       AND is_active = true
--       AND (customer_email NOT LIKE '%usebear.ai' OR customer_email IS NULL)
--     )
--     THEN 1
--   END) as will_not_be_trial_counted
-- FROM customer_retention_snapshots;

-- Show current state
SELECT
  is_trial_counted,
  subscription_status,
  COUNT(*) as row_count
FROM customer_retention_snapshots
GROUP BY is_trial_counted, subscription_status
ORDER BY subscription_status, is_trial_counted;

-- Update is_trial_counted to TRUE for rows that meet the criteria
UPDATE customer_retention_snapshots
SET is_trial_counted = true
WHERE subscription_status = 'trialing'
  AND is_active = true
  AND (customer_email NOT LIKE '%usebear.ai' OR customer_email IS NULL);

-- Update is_trial_counted to FALSE for rows that don't meet the criteria
UPDATE customer_retention_snapshots
SET is_trial_counted = false
WHERE NOT (
  subscription_status = 'trialing'
  AND is_active = true
  AND (customer_email NOT LIKE '%usebear.ai' OR customer_email IS NULL)
);

-- Show updated state
SELECT
  is_trial_counted,
  subscription_status,
  COUNT(*) as row_count
FROM customer_retention_snapshots
GROUP BY is_trial_counted, subscription_status
ORDER BY subscription_status, is_trial_counted;

-- Verify with sample data
SELECT
  date,
  customer_email,
  customer_name,
  subscription_status,
  is_active,
  is_counted,
  is_trial_counted
FROM customer_retention_snapshots
WHERE subscription_status = 'trialing'
ORDER BY date DESC
LIMIT 10;

-- Show summary statistics
SELECT
  COUNT(*) as total_snapshots,
  COUNT(CASE WHEN is_counted = true THEN 1 END) as paying_customers,
  COUNT(CASE WHEN is_trial_counted = true THEN 1 END) as trial_customers,
  COUNT(CASE WHEN is_active = true THEN 1 END) as active_subscriptions,
  COUNT(DISTINCT date) as unique_dates
FROM customer_retention_snapshots;