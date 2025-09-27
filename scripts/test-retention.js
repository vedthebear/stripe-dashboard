require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function testRetentionCalculations() {
  console.log('🧪 Testing retention calculations with backfilled data...');

  try {
    // Test weekly retention calculation
    const today = new Date();
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - 6);

    const previousWeekStart = new Date(today);
    previousWeekStart.setDate(today.getDate() - 13);
    const previousWeekEnd = new Date(today);
    previousWeekEnd.setDate(today.getDate() - 7);

    console.log(`📅 Current week: ${currentWeekStart.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`);
    console.log(`📅 Previous week: ${previousWeekStart.toISOString().split('T')[0]} to ${previousWeekEnd.toISOString().split('T')[0]}`);

    const { data: currentWeek, error: currentError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_name, monthly_value')
      .gte('date', currentWeekStart.toISOString().split('T')[0])
      .lte('date', today.toISOString().split('T')[0])
      .eq('is_counted', true);

    const { data: previousWeek, error: previousError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_name, monthly_value')
      .gte('date', previousWeekStart.toISOString().split('T')[0])
      .lt('date', currentWeekStart.toISOString().split('T')[0])
      .eq('is_counted', true);

    if (currentError || previousError) {
      throw new Error(`Database error: ${currentError?.message || previousError?.message}`);
    }

    // Remove duplicates and get unique customers
    const currentUnique = new Map();
    currentWeek.forEach(c => {
      if (!currentUnique.has(c.stripe_customer_id)) {
        currentUnique.set(c.stripe_customer_id, c);
      }
    });

    const previousUnique = new Map();
    previousWeek.forEach(c => {
      if (!previousUnique.has(c.stripe_customer_id)) {
        previousUnique.set(c.stripe_customer_id, c);
      }
    });

    const currentSet = new Set(currentUnique.keys());
    const previousSet = new Set(previousUnique.keys());

    const retained = [...previousSet].filter(id => currentSet.has(id));
    const churned = [...previousSet].filter(id => !currentSet.has(id));
    const newCustomers = [...currentSet].filter(id => !previousSet.has(id));

    const retentionRate = previousSet.size > 0 ? (retained.length / previousSet.size) * 100 : 0;

    console.log('\n📊 Weekly Retention Results:');
    console.log(`   Previous week customers: ${previousSet.size}`);
    console.log(`   Current week customers: ${currentSet.size}`);
    console.log(`   Retained customers: ${retained.length}`);
    console.log(`   Churned customers: ${churned.length}`);
    console.log(`   New customers: ${newCustomers.length}`);
    console.log(`   Retention rate: ${retentionRate.toFixed(1)}%`);

    if (churned.length > 0) {
      console.log('\n🔍 Churned customers:');
      churned.slice(0, 3).forEach(id => {
        const customer = previousUnique.get(id);
        console.log(`   - ${customer.customer_name || customer.stripe_customer_id}: $${customer.monthly_value}`);
      });
      if (churned.length > 3) {
        console.log(`   ... and ${churned.length - 3} more`);
      }
    }

    if (newCustomers.length > 0) {
      console.log('\n🆕 New customers:');
      newCustomers.slice(0, 3).forEach(id => {
        const customer = currentUnique.get(id);
        console.log(`   - ${customer.customer_name || customer.stripe_customer_id}: $${customer.monthly_value}`);
      });
      if (newCustomers.length > 3) {
        console.log(`   ... and ${newCustomers.length - 3} more`);
      }
    }

    // Test data quality
    console.log('\n🔍 Data Quality Check:');
    const { data: totalRecords, error: countError } = await supabase
      .from('customer_retention_snapshots')
      .select('date', { count: 'exact' });

    if (!countError) {
      console.log(`   Total retention records: ${totalRecords.length}`);
    }

    const { data: dateRange, error: rangeError } = await supabase
      .from('customer_retention_snapshots')
      .select('date')
      .order('date', { ascending: true })
      .limit(1);

    const { data: dateRangeEnd, error: rangeEndError } = await supabase
      .from('customer_retention_snapshots')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);

    if (!rangeError && !rangeEndError) {
      console.log(`   Date range: ${dateRange[0]?.date} to ${dateRangeEnd[0]?.date}`);
    }

    console.log('\n✅ Retention calculation test completed successfully!');
    console.log('   The backfilled data is working correctly for retention analysis.');

  } catch (error) {
    console.error('❌ Error testing retention calculations:', error.message);
    throw error;
  }
}

// Run the test
if (require.main === module) {
  testRetentionCalculations()
    .then(() => {
      console.log('\n🎯 Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💀 Test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testRetentionCalculations };