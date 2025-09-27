const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`📊 [${requestId}] Weekly retention API request`);

  try {
    if (!supabase) {
      return res.status(500).json({
        error: 'Supabase not configured',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    // Calculate specific dates for WoW retention (day-to-day comparison)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];

    console.log(`📈 [${requestId}] Calculating WoW retention (day-to-day):`);
    console.log(`   Today: ${todayStr}`);
    console.log(`   Week ago: ${weekAgoStr}`);

    // Get paying customers from today's snapshot
    const { data: todayCustomers, error: todayError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status')
      .eq('date', todayStr)
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing'); // Exclude trials

    if (todayError) {
      console.error(`❌ [${requestId}] Error fetching today's customers:`, todayError);
      throw todayError;
    }

    // Get paying customers from week ago snapshot
    const { data: weekAgoCustomers, error: weekAgoError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status')
      .eq('date', weekAgoStr)
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing'); // Exclude trials

    if (weekAgoError) {
      console.error(`❌ [${requestId}] Error fetching week ago customers:`, weekAgoError);
      throw weekAgoError;
    }

    // Convert to sets for easier comparison
    const todayCustomerIds = new Set(todayCustomers.map(c => c.stripe_customer_id));
    const weekAgoCustomerIds = new Set(weekAgoCustomers.map(c => c.stripe_customer_id));

    // Calculate retention metrics
    const retainedCustomerIds = [...weekAgoCustomerIds].filter(id => todayCustomerIds.has(id));
    const churnedCustomerIds = [...weekAgoCustomerIds].filter(id => !todayCustomerIds.has(id));
    const newCustomerIds = [...todayCustomerIds].filter(id => !weekAgoCustomerIds.has(id));

    const weekAgoCount = weekAgoCustomerIds.size;
    const todayCount = todayCustomerIds.size;
    const retainedCount = retainedCustomerIds.length;
    const churnedCount = churnedCustomerIds.length;
    const newCount = newCustomerIds.length;

    const retentionRate = weekAgoCount > 0 ? (retainedCount / weekAgoCount) * 100 : 0;

    // Create maps for easy lookup
    const weekAgoCustomerMap = new Map();
    weekAgoCustomers.forEach(c => weekAgoCustomerMap.set(c.stripe_customer_id, c));

    // Get detailed information about churned customers
    const churnedCustomersDetails = churnedCustomerIds.map(id => {
      const customer = weekAgoCustomerMap.get(id);
      return {
        stripe_customer_id: customer.stripe_customer_id,
        customer_email: customer.customer_email,
        customer_name: customer.customer_name,
        monthly_value: parseFloat(customer.monthly_value),
        previous_status: customer.subscription_status,
        churn_period: 'this_week'
      };
    });

    // Calculate churn value impact
    const churnedMRR = churnedCustomersDetails.reduce((sum, customer) =>
      sum + customer.monthly_value, 0
    );

    const responseData = {
      period: 'weekly',
      retention_rate: Math.round(retentionRate * 100) / 100, // Round to 2 decimal places
      metrics: {
        previous_period_customers: weekAgoCount,
        current_period_customers: todayCount,
        retained_customers: retainedCount,
        churned_customers: churnedCount,
        new_customers: newCount,
        churned_mrr: Math.round(churnedMRR * 100) / 100
      },
      period_labels: {
        previous: weekAgoStr,
        current: todayStr
      },
      churn_details: churnedCustomersDetails.sort((a, b) => b.monthly_value - a.monthly_value), // Sort by value desc
      requestId,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ [${requestId}] Weekly retention calculated: ${retentionRate.toFixed(2)}% retention rate`);
    console.log(`   Week ago (${weekAgoStr}): ${weekAgoCount} customers, Today (${todayStr}): ${todayCount} customers`);
    console.log(`   Retained: ${retainedCount}, Churned: ${churnedCount}, New: ${newCount}`);

    res.json(responseData);

  } catch (error) {
    console.error(`❌ [${requestId}] Weekly retention API error:`, error.message);
    res.status(500).json({
      error: 'Failed to calculate weekly retention',
      details: error.message,
      requestId,
      timestamp: new Date().toISOString()
    });
  }
}