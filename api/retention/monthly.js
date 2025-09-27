const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`📊 [${requestId}] Monthly retention API request`);

  try {
    if (!supabase) {
      return res.status(500).json({
        error: 'Supabase not configured',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    // Calculate specific dates for MoM retention (day-to-day comparison)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const monthAgo = new Date(today);
    monthAgo.setDate(today.getDate() - 30); // 30 days ago
    const monthAgoStr = monthAgo.toISOString().split('T')[0];

    console.log(`📈 [${requestId}] Calculating MoM retention (day-to-day):`);
    console.log(`   Today: ${todayStr}`);
    console.log(`   Month ago: ${monthAgoStr}`);

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

    // Get paying customers from month ago snapshot
    const { data: monthAgoCustomers, error: monthAgoError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status')
      .eq('date', monthAgoStr)
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing'); // Exclude trials

    if (monthAgoError) {
      console.error(`❌ [${requestId}] Error fetching month ago customers:`, monthAgoError);
      throw monthAgoError;
    }

    // Convert to sets for easier comparison
    const todayCustomerIds = new Set(todayCustomers.map(c => c.stripe_customer_id));
    const monthAgoCustomerIds = new Set(monthAgoCustomers.map(c => c.stripe_customer_id));

    // Calculate retention metrics
    const retainedCustomerIds = [...monthAgoCustomerIds].filter(id => todayCustomerIds.has(id));
    const churnedCustomerIds = [...monthAgoCustomerIds].filter(id => !todayCustomerIds.has(id));
    const newCustomerIds = [...todayCustomerIds].filter(id => !monthAgoCustomerIds.has(id));

    const monthAgoCount = monthAgoCustomerIds.size;
    const todayCount = todayCustomerIds.size;
    const retainedCount = retainedCustomerIds.length;
    const churnedCount = churnedCustomerIds.length;
    const newCount = newCustomerIds.length;

    const retentionRate = monthAgoCount > 0 ? (retainedCount / monthAgoCount) * 100 : 0;

    // Create maps for easy lookup
    const monthAgoCustomerMap = new Map();
    monthAgoCustomers.forEach(c => monthAgoCustomerMap.set(c.stripe_customer_id, c));

    // Get detailed information about churned customers
    const churnedCustomersDetails = churnedCustomerIds.map(id => {
      const customer = monthAgoCustomerMap.get(id);
      return {
        stripe_customer_id: customer.stripe_customer_id,
        customer_email: customer.customer_email,
        customer_name: customer.customer_name,
        monthly_value: parseFloat(customer.monthly_value),
        previous_status: customer.subscription_status,
        churn_period: 'this_month'
      };
    });

    // Calculate churn value impact
    const churnedMRR = churnedCustomersDetails.reduce((sum, customer) =>
      sum + customer.monthly_value, 0
    );

    const responseData = {
      period: 'monthly',
      retention_rate: Math.round(retentionRate * 100) / 100, // Round to 2 decimal places
      metrics: {
        previous_period_customers: monthAgoCount,
        current_period_customers: todayCount,
        retained_customers: retainedCount,
        churned_customers: churnedCount,
        new_customers: newCount,
        churned_mrr: Math.round(churnedMRR * 100) / 100
      },
      period_labels: {
        previous: monthAgoStr,
        current: todayStr
      },
      churn_details: churnedCustomersDetails.sort((a, b) => b.monthly_value - a.monthly_value), // Sort by value desc
      requestId,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ [${requestId}] Monthly retention calculated: ${retentionRate.toFixed(2)}% retention rate`);
    console.log(`   Month ago (${monthAgoStr}): ${monthAgoCount} customers, Today (${todayStr}): ${todayCount} customers`);
    console.log(`   Retained: ${retainedCount}, Churned: ${churnedCount}, New: ${newCount}`);

    res.json(responseData);

  } catch (error) {
    console.error(`❌ [${requestId}] Monthly retention API error:`, error.message);
    res.status(500).json({
      error: 'Failed to calculate monthly retention',
      details: error.message,
      requestId,
      timestamp: new Date().toISOString()
    });
  }
}