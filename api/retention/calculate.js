const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function getPacificDate() {
  // Get current date in Pacific timezone (America/Los_Angeles)
  const now = new Date();
  const pacificDateStr = now.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  // Parse MM/DD/YYYY format and convert to YYYY-MM-DD
  const [month, day, year] = pacificDateStr.split(/[,/\s]+/).filter(Boolean);
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function getPacificDateDaysAgo(days) {
  // Get a date X days ago in Pacific timezone
  const now = new Date();
  const pacificDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  pacificDate.setDate(pacificDate.getDate() - days);

  const year = pacificDate.getFullYear();
  const month = String(pacificDate.getMonth() + 1).padStart(2, '0');
  const day = String(pacificDate.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  const { period = '3' } = req.query; // Default to 3-day

  const daysMap = {
    '1': 1,
    '3': 3,
    '7': 7,
    '14': 14,
    '30': 30
  };

  const days = daysMap[period] || 3;

  console.log(`📊 [${requestId}] Retention API request for ${days}-day period`);

  try {
    if (!supabase) {
      return res.status(500).json({
        error: 'Supabase not configured',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    const todayStr = getPacificDate();
    const previousDateStr = getPacificDateDaysAgo(days);

    console.log(`📈 [${requestId}] Calculating ${days}-day retention:`);
    console.log(`   Today: ${todayStr}`);
    console.log(`   ${days} days ago: ${previousDateStr}`);

    // Step 1: Get all subscriptions that were is_counted=true exactly X days ago
    const { data: previousSubscriptions, error: previousError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_subscription_id, customer_email, customer_name, monthly_value, stripe_customer_id')
      .eq('date', previousDateStr)
      .eq('is_counted', true);

    if (previousError) {
      console.error(`❌ [${requestId}] Error fetching previous subscriptions:`, previousError);
      throw previousError;
    }

    // Step 2: Get all subscriptions that are is_counted=true today (most recent data)
    const { data: todaySubscriptions, error: todayError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_subscription_id')
      .eq('date', todayStr)
      .eq('is_counted', true);

    if (todayError) {
      console.error(`❌ [${requestId}] Error fetching today's subscriptions:`, todayError);
      throw todayError;
    }

    // Step 3: Create a set of today's is_counted subscription IDs for fast lookup
    const todaySubscriptionIds = new Set(todaySubscriptions.map(s => s.stripe_subscription_id));

    // Step 4: Check each previous subscription - if it's still is_counted today, it's retained
    const retained = [];
    const churned = [];

    for (const sub of previousSubscriptions) {
      const subscriptionDetail = {
        stripe_subscription_id: sub.stripe_subscription_id,
        stripe_customer_id: sub.stripe_customer_id,
        customer_email: sub.customer_email,
        customer_name: sub.customer_name,
        customer_display: sub.customer_name || sub.customer_email || 'Unknown',
        monthly_value: parseFloat(sub.monthly_value)
      };

      if (todaySubscriptionIds.has(sub.stripe_subscription_id)) {
        subscriptionDetail.status = 'retained';
        retained.push(subscriptionDetail);
      } else {
        subscriptionDetail.status = 'churned';
        churned.push(subscriptionDetail);
      }
    }

    const previousCount = previousSubscriptions.length;
    const retainedCount = retained.length;
    const churnedCount = churned.length;
    const retentionRate = previousCount > 0 ? (retainedCount / previousCount) * 100 : 0;

    // Combine and sort: churned first, then by monthly value descending
    const subscriptionDetails = [...churned, ...retained];

    // Sort: churned first, then by monthly value descending
    subscriptionDetails.sort((a, b) => {
      if (a.status === 'churned' && b.status === 'retained') return -1;
      if (a.status === 'retained' && b.status === 'churned') return 1;
      return b.monthly_value - a.monthly_value;
    });

    const responseData = {
      period: `${days}day`,
      period_days: days,
      retention_rate: Math.round(retentionRate * 100) / 100,
      metrics: {
        previous_period_customers: previousCount,
        current_period_customers: previousCount,
        retained_customers: retainedCount,
        churned_customers: churnedCount,
        new_customers: 0
      },
      period_labels: {
        previous: previousDateStr,
        current: todayStr
      },
      subscription_details: subscriptionDetails,
      requestId,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ [${requestId}] ${days}-day retention calculated: ${retentionRate.toFixed(2)}% retention rate`);
    console.log(`   ${days} days ago (${previousDateStr}): ${previousCount} subscriptions`);
    console.log(`   Retained: ${retainedCount}, Churned: ${churnedCount}`);

    res.json(responseData);

  } catch (error) {
    console.error(`❌ [${requestId}] Retention API error:`, error.message);
    res.status(500).json({
      error: 'Failed to calculate retention',
      details: error.message,
      requestId,
      timestamp: new Date().toISOString()
    });
  }
}