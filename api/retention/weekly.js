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

    // Calculate date ranges for WoW retention
    const today = new Date();
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - 6); // Last 7 days (including today)

    const previousWeekStart = new Date(today);
    previousWeekStart.setDate(today.getDate() - 13); // 7-13 days ago
    const previousWeekEnd = new Date(today);
    previousWeekEnd.setDate(today.getDate() - 7);

    console.log(`📈 [${requestId}] Calculating WoW retention:`);
    console.log(`   Current week: ${currentWeekStart.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`);
    console.log(`   Previous week: ${previousWeekStart.toISOString().split('T')[0]} to ${previousWeekEnd.toISOString().split('T')[0]}`);

    // Get customers active in current week (last 7 days)
    const { data: currentWeekCustomers, error: currentError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status')
      .gte('date', currentWeekStart.toISOString().split('T')[0])
      .lte('date', today.toISOString().split('T')[0])
      .eq('is_counted', true);

    if (currentError) {
      console.error(`❌ [${requestId}] Error fetching current week customers:`, currentError);
      throw currentError;
    }

    // Get customers active in previous week (7-13 days ago)
    const { data: previousWeekCustomers, error: previousError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status')
      .gte('date', previousWeekStart.toISOString().split('T')[0])
      .lt('date', currentWeekStart.toISOString().split('T')[0])
      .eq('is_counted', true);

    if (previousError) {
      console.error(`❌ [${requestId}] Error fetching previous week customers:`, previousError);
      throw previousError;
    }

    // Process unique customers (remove duplicates within each period)
    const currentWeekUnique = new Map();
    currentWeekCustomers.forEach(customer => {
      if (!currentWeekUnique.has(customer.stripe_customer_id)) {
        currentWeekUnique.set(customer.stripe_customer_id, customer);
      }
    });

    const previousWeekUnique = new Map();
    previousWeekCustomers.forEach(customer => {
      if (!previousWeekUnique.has(customer.stripe_customer_id)) {
        previousWeekUnique.set(customer.stripe_customer_id, customer);
      }
    });

    // Calculate retention metrics
    const previousWeekCustomerIds = new Set(previousWeekUnique.keys());
    const currentWeekCustomerIds = new Set(currentWeekUnique.keys());

    // Find retained customers (in both periods)
    const retainedCustomerIds = [...previousWeekCustomerIds].filter(id =>
      currentWeekCustomerIds.has(id)
    );

    // Find churned customers (in previous but not current)
    const churnedCustomerIds = [...previousWeekCustomerIds].filter(id =>
      !currentWeekCustomerIds.has(id)
    );

    // Find new customers (in current but not previous)
    const newCustomerIds = [...currentWeekCustomerIds].filter(id =>
      !previousWeekCustomerIds.has(id)
    );

    // Calculate retention rate
    const previousCount = previousWeekCustomerIds.size;
    const currentCount = currentWeekCustomerIds.size;
    const retainedCount = retainedCustomerIds.length;
    const churnedCount = churnedCustomerIds.length;
    const newCount = newCustomerIds.length;

    const retentionRate = previousCount > 0 ? (retainedCount / previousCount) * 100 : 0;

    // Get detailed information about churned customers
    const churnedCustomersDetails = churnedCustomerIds.map(id => {
      const customer = previousWeekUnique.get(id);
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
        previous_period_customers: previousCount,
        current_period_customers: currentCount,
        retained_customers: retainedCount,
        churned_customers: churnedCount,
        new_customers: newCount,
        churned_mrr: Math.round(churnedMRR * 100) / 100
      },
      period_labels: {
        previous: `${previousWeekStart.toISOString().split('T')[0]} to ${previousWeekEnd.toISOString().split('T')[0]}`,
        current: `${currentWeekStart.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`
      },
      churn_details: churnedCustomersDetails.sort((a, b) => b.monthly_value - a.monthly_value), // Sort by value desc
      requestId,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ [${requestId}] Weekly retention calculated: ${retentionRate.toFixed(2)}% retention rate`);
    console.log(`   Previous week: ${previousCount} customers, Current week: ${currentCount} customers`);
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