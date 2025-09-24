const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`📊 [${requestId}] Historical MRR API request`);

  try {
    if (!supabase) {
      return res.status(500).json({
        error: 'Supabase not configured',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    // Get historical MRR data from the last 30 days
    const { data: historicalData, error: histError } = await supabase
      .from('historical_mrr')
      .select('date, official_mrr, arr, paying_customers_count, trial_pipeline_mrr, active_trials_count, total_opportunity')
      .order('date', { ascending: true })
      .limit(30);

    if (histError) {
      console.error(`❌ [${requestId}] Error fetching historical data:`, histError);
      throw histError;
    }

    console.log(`✅ [${requestId}] Historical MRR data sent: ${historicalData.length} records`);

    res.json(historicalData || []);

  } catch (error) {
    console.error(`❌ [${requestId}] Historical MRR API error:`, error.message);
    res.status(500).json({
      error: 'Failed to fetch historical MRR data',
      details: error.message,
      requestId,
      timestamp: new Date().toISOString()
    });
  }
}