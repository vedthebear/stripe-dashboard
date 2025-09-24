-- Fix Row Level Security for historical_mrr table
-- This allows the anon key to write to the table (for cron jobs)

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON historical_mrr;

-- Create a more permissive policy that allows operations for service role and anon key
CREATE POLICY "Allow operations for service and anon users" ON historical_mrr
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Alternative: You could also disable RLS entirely for this table if it's not user-facing
-- ALTER TABLE historical_mrr DISABLE ROW LEVEL SECURITY;