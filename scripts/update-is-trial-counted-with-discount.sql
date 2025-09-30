-- Update is_trial_counted field for all rows in customer_retention_snapshots
-- Based on the complete shouldCountTrial logic from the codebase:
--   1. subscription_status must be 'trialing'
--   2. Must be active (is_active = true)
--   3. Customer email must not end with 'usebear.ai'
--   4. Must not have 100% discount (check subscriptions.percent_off)

-- First, show current state before update
SELECT
  'BEFORE UPDATE' as stage,
  is_trial_counted,
  subscription_status,
  COUNT(*) as row_count
FROM customer_retention_snapshots
GROUP BY is_trial_counted, subscription_status
ORDER BY subscription_status, is_trial_counted;

-- Preview: Show how many rows will be affected (uncomment to see breakdown)
-- SELECT
--   COUNT(*) as total_rows,
--   COUNT(CASE
--     WHEN crs.subscription_status = 'trialing'
--       AND crs.is_active = true
--       AND (crs.customer_email NOT LIKE '%usebear.ai' OR crs.customer_email IS NULL)
--       AND (s.percent_off IS NULL OR s.percent_off < 100)
--     THEN 1
--   END) as will_be_trial_counted_true,
--   COUNT(CASE
--     WHEN NOT (
--       crs.subscription_status = 'trialing'
--       AND crs.is_active = true
--       AND (crs.customer_email NOT LIKE '%usebear.ai' OR crs.customer_email IS NULL)
--       AND (s.percent_off IS NULL OR s.percent_off < 100)
--     )
--     THEN 1
--   END) as will_be_trial_counted_false
-- FROM customer_retention_snapshots crs
-- LEFT JOIN subscriptions s ON crs.stripe_subscription_id = s.stripe_subscription_id;

-- Update is_trial_counted to TRUE for rows that meet ALL criteria
-- Join with subscriptions table to check percent_off
UPDATE customer_retention_snapshots crs
SET is_trial_counted = true
FROM subscriptions s
WHERE crs.stripe_subscription_id = s.stripe_subscription_id
  AND crs.subscription_status = 'trialing'
  AND crs.is_active = true
  AND (crs.customer_email NOT LIKE '%usebear.ai' OR crs.customer_email IS NULL)
  AND (s.percent_off IS NULL OR s.percent_off < 100);

-- Update is_trial_counted to FALSE for all other rows
-- This includes:
--   - Non-trialing subscriptions
--   - Inactive subscriptions
--   - usebear.ai emails
--   - 100% discount subscriptions
UPDATE customer_retention_snapshots crs
SET is_trial_counted = false
WHERE NOT EXISTS (
  SELECT 1
  FROM subscriptions s
  WHERE crs.stripe_subscription_id = s.stripe_subscription_id
    AND crs.subscription_status = 'trialing'
    AND crs.is_active = true
    AND (crs.customer_email NOT LIKE '%usebear.ai' OR crs.customer_email IS NULL)
    AND (s.percent_off IS NULL OR s.percent_off < 100)
);

-- Show updated state after update
SELECT
  'AFTER UPDATE' as stage,
  is_trial_counted,
  subscription_status,
  COUNT(*) as row_count
FROM customer_retention_snapshots
GROUP BY is_trial_counted, subscription_status
ORDER BY subscription_status, is_trial_counted;

-- Verify trial subscriptions with discount information
SELECT
  crs.date,
  crs.customer_email,
  crs.customer_name,
  crs.subscription_status,
  crs.is_active,
  s.percent_off as discount_percent,
  crs.is_trial_counted,
  CASE
    WHEN crs.subscription_status = 'trialing'
      AND crs.is_active = true
      AND (crs.customer_email NOT LIKE '%usebear.ai' OR crs.customer_email IS NULL)
      AND (s.percent_off IS NULL OR s.percent_off < 100)
    THEN 'SHOULD BE TRUE'
    ELSE 'SHOULD BE FALSE'
  END as expected_value
FROM customer_retention_snapshots crs
LEFT JOIN subscriptions s ON crs.stripe_subscription_id = s.stripe_subscription_id
WHERE crs.subscription_status = 'trialing'
ORDER BY crs.date DESC, s.percent_off DESC
LIMIT 20;

-- Show any mismatches (should be empty if logic is correct)
SELECT
  crs.date,
  crs.customer_email,
  crs.subscription_status,
  crs.is_active,
  s.percent_off,
  crs.is_trial_counted as actual_value,
  CASE
    WHEN crs.subscription_status = 'trialing'
      AND crs.is_active = true
      AND (crs.customer_email NOT LIKE '%usebear.ai' OR crs.customer_email IS NULL)
      AND (s.percent_off IS NULL OR s.percent_off < 100)
    THEN true
    ELSE false
  END as expected_value
FROM customer_retention_snapshots crs
LEFT JOIN subscriptions s ON crs.stripe_subscription_id = s.stripe_subscription_id
WHERE crs.is_trial_counted != (
  CASE
    WHEN crs.subscription_status = 'trialing'
      AND crs.is_active = true
      AND (crs.customer_email NOT LIKE '%usebear.ai' OR crs.customer_email IS NULL)
      AND (s.percent_off IS NULL OR s.percent_off < 100)
    THEN true
    ELSE false
  END
);

-- Summary statistics
SELECT
  COUNT(*) as total_snapshots,
  COUNT(CASE WHEN crs.is_counted = true THEN 1 END) as paying_customers,
  COUNT(CASE WHEN crs.is_trial_counted = true THEN 1 END) as valid_trial_customers,
  COUNT(CASE WHEN crs.subscription_status = 'trialing' THEN 1 END) as all_trialing_snapshots,
  COUNT(CASE WHEN crs.subscription_status = 'trialing' AND s.percent_off >= 100 THEN 1 END) as trialing_with_100_discount,
  COUNT(DISTINCT crs.date) as unique_dates
FROM customer_retention_snapshots crs
LEFT JOIN subscriptions s ON crs.stripe_subscription_id = s.stripe_subscription_id;