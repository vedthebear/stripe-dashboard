-- Customer Retention Snapshots Table
-- This table stores daily snapshots of each customer's subscription state
-- to enable retention rate calculations and churn analysis

CREATE TABLE IF NOT EXISTS customer_retention_snapshots (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  customer_email TEXT,
  customer_name TEXT,
  subscription_status TEXT NOT NULL,
  monthly_value DECIMAL(10,2) NOT NULL,
  is_active BOOLEAN NOT NULL,
  is_counted BOOLEAN NOT NULL, -- follows same filtering logic as main MRR calculations
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_customer_retention_date ON customer_retention_snapshots(date);
CREATE INDEX IF NOT EXISTS idx_customer_retention_customer_id ON customer_retention_snapshots(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_retention_date_customer ON customer_retention_snapshots(date, stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_retention_is_counted ON customer_retention_snapshots(is_counted);

-- Composite index for retention queries
CREATE INDEX IF NOT EXISTS idx_customer_retention_date_counted ON customer_retention_snapshots(date, is_counted) WHERE is_counted = true;

-- Enable Row Level Security (RLS)
ALTER TABLE customer_retention_snapshots ENABLE ROW LEVEL SECURITY;

-- Create policy to allow operations for service and anon users (same as historical_mrr)
CREATE POLICY "Allow operations for service and anon users" ON customer_retention_snapshots
    FOR ALL USING (true) WITH CHECK (true);

-- Add helpful comments
COMMENT ON TABLE customer_retention_snapshots IS 'Daily snapshots of each customer subscription state for retention analysis';
COMMENT ON COLUMN customer_retention_snapshots.date IS 'The date this customer snapshot represents (YYYY-MM-DD)';
COMMENT ON COLUMN customer_retention_snapshots.stripe_customer_id IS 'Stripe customer ID';
COMMENT ON COLUMN customer_retention_snapshots.stripe_subscription_id IS 'Stripe subscription ID';
COMMENT ON COLUMN customer_retention_snapshots.customer_email IS 'Customer email address';
COMMENT ON COLUMN customer_retention_snapshots.customer_name IS 'Customer display name';
COMMENT ON COLUMN customer_retention_snapshots.subscription_status IS 'Stripe subscription status (active, trialing, canceled, etc.)';
COMMENT ON COLUMN customer_retention_snapshots.monthly_value IS 'Monthly recurring value from this customer';
COMMENT ON COLUMN customer_retention_snapshots.is_active IS 'Whether subscription is considered active (active/trialing/past_due)';
COMMENT ON COLUMN customer_retention_snapshots.is_counted IS 'Whether this customer counts toward official MRR (excludes canceled, 100% discount, usebear.ai)';

-- Create useful views for retention analysis

-- Week-over-Week retention view
CREATE OR REPLACE VIEW weekly_retention_analysis AS
WITH current_week AS (
  SELECT DISTINCT stripe_customer_id, customer_email, customer_name, monthly_value
  FROM customer_retention_snapshots
  WHERE date >= CURRENT_DATE - INTERVAL '6 days'
    AND date <= CURRENT_DATE
    AND is_counted = true
),
previous_week AS (
  SELECT DISTINCT stripe_customer_id, customer_email, customer_name, monthly_value
  FROM customer_retention_snapshots
  WHERE date >= CURRENT_DATE - INTERVAL '13 days'
    AND date <= CURRENT_DATE - INTERVAL '7 days'
    AND is_counted = true
),
retained_customers AS (
  SELECT cw.*, pw.monthly_value as previous_monthly_value
  FROM current_week cw
  INNER JOIN previous_week pw ON cw.stripe_customer_id = pw.stripe_customer_id
),
churned_customers AS (
  SELECT pw.*
  FROM previous_week pw
  LEFT JOIN current_week cw ON pw.stripe_customer_id = cw.stripe_customer_id
  WHERE cw.stripe_customer_id IS NULL
)
SELECT
  (SELECT COUNT(*) FROM previous_week) as previous_week_customers,
  (SELECT COUNT(*) FROM current_week) as current_week_customers,
  (SELECT COUNT(*) FROM retained_customers) as retained_customers,
  (SELECT COUNT(*) FROM churned_customers) as churned_customers,
  CASE
    WHEN (SELECT COUNT(*) FROM previous_week) > 0
    THEN ROUND(((SELECT COUNT(*) FROM retained_customers)::DECIMAL / (SELECT COUNT(*) FROM previous_week)::DECIMAL) * 100, 2)
    ELSE 0
  END as retention_rate_percent;

-- Month-over-Month retention view
CREATE OR REPLACE VIEW monthly_retention_analysis AS
WITH current_month AS (
  SELECT DISTINCT stripe_customer_id, customer_email, customer_name, monthly_value
  FROM customer_retention_snapshots
  WHERE date >= DATE_TRUNC('month', CURRENT_DATE)
    AND date <= CURRENT_DATE
    AND is_counted = true
),
previous_month AS (
  SELECT DISTINCT stripe_customer_id, customer_email, customer_name, monthly_value
  FROM customer_retention_snapshots
  WHERE date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
    AND date < DATE_TRUNC('month', CURRENT_DATE)
    AND is_counted = true
),
retained_customers AS (
  SELECT cm.*, pm.monthly_value as previous_monthly_value
  FROM current_month cm
  INNER JOIN previous_month pm ON cm.stripe_customer_id = pm.stripe_customer_id
),
churned_customers AS (
  SELECT pm.*
  FROM previous_month pm
  LEFT JOIN current_month cm ON pm.stripe_customer_id = cm.stripe_customer_id
  WHERE cm.stripe_customer_id IS NULL
)
SELECT
  (SELECT COUNT(*) FROM previous_month) as previous_month_customers,
  (SELECT COUNT(*) FROM current_month) as current_month_customers,
  (SELECT COUNT(*) FROM retained_customers) as retained_customers,
  (SELECT COUNT(*) FROM churned_customers) as churned_customers,
  CASE
    WHEN (SELECT COUNT(*) FROM previous_month) > 0
    THEN ROUND(((SELECT COUNT(*) FROM retained_customers)::DECIMAL / (SELECT COUNT(*) FROM previous_month)::DECIMAL) * 100, 2)
    ELSE 0
  END as retention_rate_percent;

COMMENT ON VIEW weekly_retention_analysis IS 'Week-over-week customer retention metrics and calculations';
COMMENT ON VIEW monthly_retention_analysis IS 'Month-over-month customer retention metrics and calculations';

-- Sample queries for reference (commented out)
/*
-- Get weekly churned customers with details
SELECT
  pw.stripe_customer_id,
  pw.customer_email,
  pw.customer_name,
  pw.monthly_value,
  'churned_this_week' as status
FROM customer_retention_snapshots pw
WHERE pw.date >= CURRENT_DATE - INTERVAL '13 days'
  AND pw.date <= CURRENT_DATE - INTERVAL '7 days'
  AND pw.is_counted = true
  AND pw.stripe_customer_id NOT IN (
    SELECT DISTINCT stripe_customer_id
    FROM customer_retention_snapshots
    WHERE date >= CURRENT_DATE - INTERVAL '6 days'
      AND date <= CURRENT_DATE
      AND is_counted = true
  );

-- Get retention rate trends over last 4 weeks
SELECT
  DATE_TRUNC('week', date) as week_start,
  COUNT(DISTINCT stripe_customer_id) as active_customers
FROM customer_retention_snapshots
WHERE date >= CURRENT_DATE - INTERVAL '4 weeks'
  AND is_counted = true
GROUP BY DATE_TRUNC('week', date)
ORDER BY week_start;
*/