-- Add is_trial_counted field to subscriptions table
-- This field should be true only if:
-- 1. subscription_status is 'trialing'
-- 2. percent_off is not 100
-- 3. email doesn't end with 'usebear.ai'

-- Step 1: Add the new column
ALTER TABLE subscriptions
ADD COLUMN is_trial_counted BOOLEAN DEFAULT FALSE;

-- Step 2: Update existing records with the correct logic
UPDATE subscriptions
SET is_trial_counted = (
    subscription_status = 'trialing'
    AND (percent_off IS NULL OR percent_off != 100)
    AND (customer_email IS NULL OR customer_email NOT LIKE '%usebear.ai')
);

-- Step 3: Create an index for better performance on queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_counted
ON subscriptions(is_trial_counted)
WHERE is_trial_counted = true;

-- Step 4: Add a comment to document the field logic
COMMENT ON COLUMN subscriptions.is_trial_counted IS
'TRUE when subscription_status=trialing AND percent_off!=100 AND email does not end with usebear.ai';

-- Verification query to check the results
SELECT
    subscription_status,
    percent_off,
    customer_email,
    is_trial_counted,
    COUNT(*) as count
FROM subscriptions
WHERE subscription_status = 'trialing'
GROUP BY subscription_status, percent_off, customer_email, is_trial_counted
ORDER BY is_trial_counted DESC, count DESC;