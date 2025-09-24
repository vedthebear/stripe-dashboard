-- Supabase SQL script to create subscriptions table
-- This will be the source of truth for all Stripe subscription data

CREATE TABLE subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  customer_email TEXT, -- nullable in case customer has no email
  subscription_status TEXT NOT NULL, -- active, trialing, past_due, canceled, incomplete, incomplete_expired, unpaid
  monthly_total DECIMAL(10,2) NOT NULL, -- normalized to monthly amount regardless of billing interval
  date_created TIMESTAMPTZ NOT NULL,
  trial_end_date TIMESTAMPTZ, -- null if no trial
  is_active BOOLEAN NOT NULL DEFAULT false, -- true for active, trialing, past_due
  percent_off INTEGER DEFAULT 0, -- discount percentage (0-100)

  -- Additional useful fields for analytics
  stripe_customer_id TEXT NOT NULL,
  customer_name TEXT,
  billing_interval TEXT NOT NULL, -- month, year, week
  original_amount DECIMAL(10,2) NOT NULL, -- actual subscription amount before normalization
  currency TEXT DEFAULT 'usd',

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX idx_subscriptions_status ON subscriptions (subscription_status);
CREATE INDEX idx_subscriptions_customer_email ON subscriptions (customer_email);
CREATE INDEX idx_subscriptions_is_active ON subscriptions (is_active);
CREATE INDEX idx_subscriptions_date_created ON subscriptions (date_created);
CREATE INDEX idx_subscriptions_stripe_customer_id ON subscriptions (stripe_customer_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE
    ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (optional, but recommended)
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations for now (you can restrict this later)
CREATE POLICY "Allow all operations on subscriptions" ON subscriptions FOR ALL USING (true);

-- Create useful views for analytics

-- Active MRR view
CREATE VIEW active_mrr AS
SELECT
  SUM(monthly_total) as total_mrr,
  COUNT(*) as active_subscriptions,
  AVG(monthly_total) as average_mrr_per_customer
FROM subscriptions
WHERE is_active = true;

-- Trial pipeline view
CREATE VIEW trial_pipeline AS
SELECT
  COUNT(*) as trial_customers,
  SUM(monthly_total) as potential_mrr,
  COUNT(*) FILTER (WHERE trial_end_date > NOW()) as active_trials,
  COUNT(*) FILTER (WHERE trial_end_date <= NOW()) as expired_trials
FROM subscriptions
WHERE subscription_status = 'trialing';

-- Status breakdown view
CREATE VIEW subscription_status_breakdown AS
SELECT
  subscription_status,
  COUNT(*) as count,
  SUM(monthly_total) as total_mrr,
  ROUND(AVG(monthly_total), 2) as avg_mrr
FROM subscriptions
GROUP BY subscription_status
ORDER BY total_mrr DESC;

-- Monthly cohort view
CREATE VIEW monthly_cohorts AS
SELECT
  DATE_TRUNC('month', date_created) as cohort_month,
  COUNT(*) as new_subscriptions,
  SUM(monthly_total) as cohort_mrr,
  COUNT(*) FILTER (WHERE is_active = true) as still_active
FROM subscriptions
GROUP BY DATE_TRUNC('month', date_created)
ORDER BY cohort_month DESC;

-- Comments
COMMENT ON TABLE subscriptions IS 'Source of truth for all Stripe subscription data';
COMMENT ON COLUMN subscriptions.monthly_total IS 'Amount normalized to monthly value regardless of billing interval';
COMMENT ON COLUMN subscriptions.is_active IS 'True for active, trialing, and past_due subscriptions';
COMMENT ON COLUMN subscriptions.percent_off IS 'Discount percentage applied to subscription (0-100)';