-- Historical MRR Tracking Table
-- This table will store daily snapshots of MRR data for historical analysis and graphing

CREATE TABLE IF NOT EXISTS historical_mrr (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  official_mrr DECIMAL(10,2) NOT NULL,
  arr DECIMAL(10,2) NOT NULL,
  paying_customers_count INTEGER NOT NULL,
  average_customer_value DECIMAL(10,2) NOT NULL,
  trial_pipeline_mrr DECIMAL(10,2) NOT NULL,
  active_trials_count INTEGER NOT NULL,
  total_opportunity DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster date queries
CREATE INDEX IF NOT EXISTS idx_historical_mrr_date ON historical_mrr(date);
CREATE INDEX IF NOT EXISTS idx_historical_mrr_created_at ON historical_mrr(created_at);

-- Enable Row Level Security (RLS)
ALTER TABLE historical_mrr ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations for authenticated users
CREATE POLICY "Allow all operations for authenticated users" ON historical_mrr
    FOR ALL USING (auth.role() = 'authenticated');

-- Create or replace function to update the updated_at column
CREATE OR REPLACE FUNCTION update_historical_mrr_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS trigger_historical_mrr_updated_at ON historical_mrr;
CREATE TRIGGER trigger_historical_mrr_updated_at
    BEFORE UPDATE ON historical_mrr
    FOR EACH ROW
    EXECUTE FUNCTION update_historical_mrr_updated_at();

-- Add helpful comments
COMMENT ON TABLE historical_mrr IS 'Daily snapshots of MRR and revenue metrics for historical tracking and analysis';
COMMENT ON COLUMN historical_mrr.date IS 'The date this snapshot represents (YYYY-MM-DD)';
COMMENT ON COLUMN historical_mrr.official_mrr IS 'Official Monthly Recurring Revenue (filtered for active, non-canceled, non-100% discount)';
COMMENT ON COLUMN historical_mrr.arr IS 'Annual Recurring Revenue (official_mrr * 12)';
COMMENT ON COLUMN historical_mrr.paying_customers_count IS 'Number of paying customers counted in official MRR';
COMMENT ON COLUMN historical_mrr.average_customer_value IS 'Average monthly value per paying customer';
COMMENT ON COLUMN historical_mrr.trial_pipeline_mrr IS 'Potential MRR from active trial customers';
COMMENT ON COLUMN historical_mrr.active_trials_count IS 'Number of active trials in the pipeline';
COMMENT ON COLUMN historical_mrr.total_opportunity IS 'Sum of official MRR + trial pipeline MRR';

-- Create a view for easy querying of recent data
CREATE OR REPLACE VIEW recent_mrr_history AS
SELECT
  date,
  official_mrr,
  arr,
  paying_customers_count,
  average_customer_value,
  trial_pipeline_mrr,
  active_trials_count,
  total_opportunity,
  -- Calculate day-over-day changes
  LAG(official_mrr) OVER (ORDER BY date) AS previous_mrr,
  official_mrr - LAG(official_mrr) OVER (ORDER BY date) AS mrr_change,
  ROUND(
    ((official_mrr - LAG(official_mrr) OVER (ORDER BY date)) /
     NULLIF(LAG(official_mrr) OVER (ORDER BY date), 0)) * 100, 2
  ) AS mrr_change_percent
FROM historical_mrr
ORDER BY date DESC
LIMIT 90; -- Last 90 days

COMMENT ON VIEW recent_mrr_history IS 'Recent 90 days of MRR history with day-over-day change calculations';

-- Sample query examples (commented out)
/*
-- Get MRR growth over last 30 days
SELECT
  date,
  official_mrr,
  mrr_change,
  mrr_change_percent
FROM recent_mrr_history
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date;

-- Get monthly MRR snapshots (last day of each month)
SELECT DISTINCT ON (DATE_TRUNC('month', date))
  DATE_TRUNC('month', date) AS month,
  date,
  official_mrr,
  arr,
  paying_customers_count
FROM historical_mrr
WHERE date >= CURRENT_DATE - INTERVAL '12 months'
ORDER BY DATE_TRUNC('month', date) DESC, date DESC;
*/