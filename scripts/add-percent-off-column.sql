-- Add percent_off column to customer_retention_snapshots table
-- This will store the discount percentage to ensure is_counted accuracy

-- Add the column if it doesn't exist
ALTER TABLE customer_retention_snapshots
ADD COLUMN IF NOT EXISTS percent_off INTEGER DEFAULT NULL;

-- Add a comment explaining the field
COMMENT ON COLUMN customer_retention_snapshots.percent_off IS 'Discount percentage (0-100). Used to determine if subscription should be counted (must be < 100 or NULL)';

-- Verify the column was added
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'customer_retention_snapshots'
  AND column_name = 'percent_off';