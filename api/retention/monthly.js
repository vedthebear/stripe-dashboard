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

    // Calculate date ranges for MoM retention
    const today = new Date();

    // Current month: from 1st of current month to today
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // Previous month: from 1st of previous month to last day of previous month
    const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const previousMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0); // Last day of previous month

    console.log(`📈 [${requestId}] Calculating MoM retention:`);
    console.log(`   Current month: ${currentMonthStart.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`);
    console.log(`   Previous month: ${previousMonthStart.toISOString().split('T')[0]} to ${previousMonthEnd.toISOString().split('T')[0]}`);

    // Get customers active in current month
    const { data: currentMonthCustomers, error: currentError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status')
      .gte('date', currentMonthStart.toISOString().split('T')[0])
      .lte('date', today.toISOString().split('T')[0])
      .eq('is_counted', true);

    if (currentError) {
      console.error(`❌ [${requestId}] Error fetching current month customers:`, currentError);
      throw currentError;
    }

    // Get customers active in previous month
    const { data: previousMonthCustomers, error: previousError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status')
      .gte('date', previousMonthStart.toISOString().split('T')[0])
      .lte('date', previousMonthEnd.toISOString().split('T')[0])
      .eq('is_counted', true);

    if (previousError) {
      console.error(`❌ [${requestId}] Error fetching previous month customers:`, previousError);
      throw previousError;
    }

    // Process unique customers (remove duplicates within each period)
    const currentMonthUnique = new Map();
    currentMonthCustomers.forEach(customer => {
      if (!currentMonthUnique.has(customer.stripe_customer_id)) {
        currentMonthUnique.set(customer.stripe_customer_id, customer);
      }
    });

    const previousMonthUnique = new Map();
    previousMonthCustomers.forEach(customer => {
      if (!previousMonthUnique.has(customer.stripe_customer_id)) {
        previousMonthUnique.set(customer.stripe_customer_id, customer);
      }
    });

    // Calculate retention metrics
    const previousMonthCustomerIds = new Set(previousMonthUnique.keys());
    const currentMonthCustomerIds = new Set(currentMonthUnique.keys());

    // Find retained customers (in both periods)
    const retainedCustomerIds = [...previousMonthCustomerIds].filter(id =>
      currentMonthCustomerIds.has(id)
    );

    // Find churned customers (in previous but not current)
    const churnedCustomerIds = [...previousMonthCustomerIds].filter(id =>
      !currentMonthCustomerIds.has(id)
    );

    // Find new customers (in current but not previous)
    const newCustomerIds = [...currentMonthCustomerIds].filter(id =>
      !previousMonthCustomerIds.has(id)
    );

    // Calculate retention rate
    const previousCount = previousMonthCustomerIds.size;
    const currentCount = currentMonthCustomerIds.size;
    const retainedCount = retainedCustomerIds.length;
    const churnedCount = churnedCustomerIds.length;
    const newCount = newCustomerIds.length;

    const retentionRate = previousCount > 0 ? (retainedCount / previousCount) * 100 : 0;

    // Get detailed information about churned customers
    const churnedCustomersDetails = churnedCustomerIds.map(id => {
      const customer = previousMonthUnique.get(id);
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

    // Format month names for display
    const currentMonthName = currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const previousMonthName = previousMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const responseData = {
      period: 'monthly',
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
        previous: previousMonthName,
        current: currentMonthName,
        previous_dates: `${previousMonthStart.toISOString().split('T')[0]} to ${previousMonthEnd.toISOString().split('T')[0]}`,
        current_dates: `${currentMonthStart.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`
      },
      churn_details: churnedCustomersDetails.sort((a, b) => b.monthly_value - a.monthly_value), // Sort by value desc
      requestId,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ [${requestId}] Monthly retention calculated: ${retentionRate.toFixed(2)}% retention rate`);
    console.log(`   Previous month: ${previousCount} customers, Current month: ${currentCount} customers`);
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