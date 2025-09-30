-- Add is_trial_counted column to customer_retention_snapshots table
-- This script is safe to run multiple times (idempotent)

-- Add the column if it doesn't exist
ALTER TABLE customer_retention_snapshots
ADD COLUMN IF NOT EXISTS is_trial_counted BOOLEAN DEFAULT false;

-- Set default value for existing rows (optional, but good practice)
UPDATE customer_retention_snapshots
SET is_trial_counted = false
WHERE is_trial_counted IS NULL;

-- Verify the column was added
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'customer_retention_snapshots'
  AND column_name = 'is_trial_counted';

-- Show sample of data with the new column
SELECT date, customer_email, subscription_status, is_counted, is_trial_counted
FROM customer_retention_snapshots
ORDER BY date DESC
LIMIT 5;