-- SQL query to update is_counted field to false for specific conditions
-- This will exclude subscriptions from official MRR calculation

UPDATE subscriptions
SET is_counted = false, updated_at = NOW()
WHERE
  -- Condition 1: Status is canceled or trialing
  subscription_status IN ('canceled', 'trialing')
  OR
  -- Condition 2: 100% discount
  percent_off = 100
  OR
  -- Condition 3: Email ends with "usebear.ai"
  customer_email LIKE '%usebear.ai';

-- Show summary of what was updated
SELECT
  'Summary of is_counted updates:' as info;

-- Count by exclusion reason
SELECT
  CASE
    WHEN subscription_status IN ('canceled', 'trialing') THEN 'Status: ' || subscription_status
    WHEN percent_off = 100 THEN 'Discount: 100% off'
    WHEN customer_email LIKE '%usebear.ai' THEN 'Email: usebear.ai domain'
    ELSE 'Other'
  END as exclusion_reason,
  COUNT(*) as count,
  SUM(monthly_total) as excluded_mrr
FROM subscriptions
WHERE is_counted = false
GROUP BY
  CASE
    WHEN subscription_status IN ('canceled', 'trialing') THEN 'Status: ' || subscription_status
    WHEN percent_off = 100 THEN 'Discount: 100% off'
    WHEN customer_email LIKE '%usebear.ai' THEN 'Email: usebear.ai domain'
    ELSE 'Other'
  END
ORDER BY excluded_mrr DESC;

-- Show updated MRR summary
SELECT
  'Updated MRR Summary:' as info;

SELECT
  (SELECT total_mrr FROM official_mrr) as official_mrr_counted,
  (SELECT total_mrr FROM active_mrr) as total_active_mrr,
  (SELECT COUNT(*) FROM subscriptions WHERE is_counted = true) as counted_subscriptions,
  (SELECT COUNT(*) FROM subscriptions WHERE is_counted = false) as excluded_subscriptions;