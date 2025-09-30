const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function getDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
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

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const previousDateStr = getDaysAgo(days);

    console.log(`📈 [${requestId}] Calculating ${days}-day retention:`);
    console.log(`   Today: ${todayStr}`);
    console.log(`   ${days} days ago: ${previousDateStr}`);

    // Get paying customers from previous date snapshot
    const { data: previousCustomers, error: previousError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status, stripe_subscription_id')
      .eq('date', previousDateStr)
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing');

    if (previousError) {
      console.error(`❌ [${requestId}] Error fetching previous customers:`, previousError);
      throw previousError;
    }

    // Get paying customers from today's snapshot
    const { data: todayCustomers, error: todayError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status, stripe_subscription_id')
      .eq('date', todayStr)
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing');

    if (todayError) {
      console.error(`❌ [${requestId}] Error fetching today's customers:`, todayError);
      throw todayError;
    }

    // Create sets for comparison
    const todayCustomerIds = new Set(todayCustomers.map(c => c.stripe_customer_id));
    const previousCustomerIds = new Set(previousCustomers.map(c => c.stripe_customer_id));

    // Calculate retention metrics
    const retainedCustomerIds = [...previousCustomerIds].filter(id => todayCustomerIds.has(id));
    const churnedCustomerIds = [...previousCustomerIds].filter(id => !todayCustomerIds.has(id));
    const newCustomerIds = [...todayCustomers].filter(c => !previousCustomerIds.has(c.stripe_customer_id));

    const previousCount = previousCustomerIds.size;
    const todayCount = todayCustomerIds.size;
    const retainedCount = retainedCustomerIds.length;
    const churnedCount = churnedCustomerIds.length;
    const newCount = newCustomerIds.length;

    const retentionRate = previousCount > 0 ? (retainedCount / previousCount) * 100 : 0;

    // Create detailed subscription list with status
    const subscriptionDetails = previousCustomers.map(customer => {
      const isRetained = todayCustomerIds.has(customer.stripe_customer_id);
      return {
        stripe_subscription_id: customer.stripe_subscription_id,
        stripe_customer_id: customer.stripe_customer_id,
        customer_email: customer.customer_email,
        customer_name: customer.customer_name,
        monthly_value: parseFloat(customer.monthly_value),
        status: isRetained ? 'retained' : 'churned',
        customer_display: customer.customer_name || customer.customer_email || 'Unknown'
      };
    });

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
        current_period_customers: todayCount,
        retained_customers: retainedCount,
        churned_customers: churnedCount,
        new_customers: newCount
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
    console.log(`   ${days} days ago (${previousDateStr}): ${previousCount} customers, Today (${todayStr}): ${todayCount} customers`);
    console.log(`   Retained: ${retainedCount}, Churned: ${churnedCount}, New: ${newCount}`);

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