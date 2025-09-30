require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Backfill customer retention snapshots for PAYING CUSTOMERS ONLY
 * This excludes trials and focuses on actual revenue-generating customers
 */
async function backfillPayingCustomerRetention(daysToBackfill = 30) {
  const startTime = new Date();
  console.log('💳 Starting Paying Customer Retention Data Backfill');
  console.log(`⏰ Started at: ${startTime.toLocaleString()}`);
  console.log(`📅 Backfilling last ${daysToBackfill} days (PAYING CUSTOMERS ONLY)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Validate environment
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Supabase environment variables not set');
    }

    console.log('✅ Environment variables validated');

    // Get all current subscriptions from Supabase (only paying customers)
    console.log('\n📋 Fetching PAYING subscription data...');
    const { data: allSubscriptions, error: subscriptionsError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, customer_email, customer_name, subscription_status, monthly_total, is_active, is_counted, date_created, date_canceled')
      .neq('subscription_status', 'trialing'); // EXCLUDE TRIALS

    if (subscriptionsError) {
      throw subscriptionsError;
    }

    console.log(`✅ Found ${allSubscriptions.length} paying subscriptions (trials excluded)`);

    // Generate snapshots for each day
    const today = new Date();
    let totalSnapshotsCreated = 0;
    let errors = 0;

    for (let dayOffset = daysToBackfill - 1; dayOffset >= 0; dayOffset--) {
      const snapshotDate = new Date(today);
      snapshotDate.setDate(today.getDate() - dayOffset);
      const dateString = snapshotDate.toISOString().split('T')[0];

      console.log(`\n📸 Creating snapshots for ${dateString}...`);

      // Filter paying subscriptions that would have been active on this date
      const activeOnDate = allSubscriptions.filter(sub => {
        const createdDate = new Date(sub.date_created);
        const canceledDate = sub.date_canceled ? new Date(sub.date_canceled) : null;

        // Subscription must have existed by this date
        if (createdDate > snapshotDate) {
          return false;
        }

        // If canceled, must have been canceled after this date
        if (canceledDate && canceledDate <= snapshotDate) {
          return false;
        }

        // Only include paying customers (is_counted = true)
        return sub.is_counted;
      });

      // Prepare customer snapshots for this date (PAYING CUSTOMERS ONLY)
      const customerSnapshots = activeOnDate.map(sub => ({
        date: dateString,
        stripe_customer_id: sub.stripe_customer_id,
        stripe_subscription_id: sub.stripe_subscription_id,
        customer_email: sub.customer_email,
        customer_name: sub.customer_name,
        subscription_status: sub.subscription_status,
        monthly_value: parseFloat(sub.monthly_total),
        is_active: sub.is_active,
        is_counted: sub.is_counted
      }));

      // Add hard-coded paying customers (they've always been active)
      customerSnapshots.push(
        {
          date: dateString,
          stripe_customer_id: 'hardcoded_steph_moccio',
          stripe_subscription_id: 'hardcoded_steph_moccio_sub',
          customer_email: 'steph@example.com',
          customer_name: 'Steph Moccio',
          subscription_status: 'active',
          monthly_value: 500.00,
          is_active: true,
          is_counted: true
        },
        {
          date: dateString,
          stripe_customer_id: 'hardcoded_nick_scott',
          stripe_subscription_id: 'hardcoded_nick_scott_sub',
          customer_email: 'nick@example.com',
          customer_name: 'Nick Scott',
          subscription_status: 'active',
          monthly_value: 1000.00,
          is_active: true,
          is_counted: true
        }
      );

      console.log(`   📊 Processing ${customerSnapshots.length} PAYING customer snapshots...`);

      // Insert snapshots in batches
      const batchSize = 100;
      let dayInserted = 0;

      for (let i = 0; i < customerSnapshots.length; i += batchSize) {
        const batch = customerSnapshots.slice(i, i + batchSize);

        const { error: insertError } = await supabase
          .from('customer_retention_snapshots')
          .insert(batch);

        if (insertError) {
          console.error(`   ❌ Error inserting batch for ${dateString}:`, insertError.message);
          errors++;
        } else {
          dayInserted += batch.length;
        }
      }

      totalSnapshotsCreated += dayInserted;
      console.log(`   ✅ Created ${dayInserted} paying customer snapshots for ${dateString}`);
    }

    // Generate summary report
    console.log('\n📊 Generating backfill report...');

    // Check final counts
    const { data: finalCount, error: countError } = await supabase
      .from('customer_retention_snapshots')
      .select('date', { count: 'exact' })
      .gte('date', new Date(today.getTime() - (daysToBackfill * 24 * 60 * 60 * 1000)).toISOString().split('T')[0]);

    if (countError) {
      console.error('❌ Error getting final count:', countError.message);
    } else {
      console.log(`✅ Total snapshots in database for backfill period: ${finalCount.length || 0}`);
    }

    // Check data distribution (paying customers only)
    const { data: payingBreakdown, error: payingError } = await supabase
      .from('customer_retention_snapshots')
      .select('date, is_counted, subscription_status')
      .gte('date', new Date(today.getTime() - (daysToBackfill * 24 * 60 * 60 * 1000)).toISOString().split('T')[0])
      .neq('subscription_status', 'trialing')
      .order('date');

    if (!payingError && payingBreakdown) {
      console.log('\n📈 Daily paying customer breakdown:');
      const dailyCounts = {};
      payingBreakdown.forEach(row => {
        if (!dailyCounts[row.date]) {
          dailyCounts[row.date] = { total: 0, counted: 0 };
        }
        dailyCounts[row.date].total++;
        if (row.is_counted) {
          dailyCounts[row.date].counted++;
        }
      });

      Object.entries(dailyCounts).slice(-7).forEach(([date, counts]) => {
        console.log(`   ${date}: ${counts.total} total paying, ${counts.counted} counted`);
      });
    }

    // Test a simple retention calculation (paying customers only)
    console.log('\n🧪 Testing paying customer retention calculation...');

    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);

    const { data: currentWeekTest, error: currentError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id')
      .eq('date', today.toISOString().split('T')[0])
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing');

    const { data: previousWeekTest, error: previousError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id')
      .eq('date', weekAgo.toISOString().split('T')[0])
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing');

    if (!currentError && !previousError) {
      const currentWeekCustomers = new Set(currentWeekTest.map(r => r.stripe_customer_id));
      const previousWeekCustomers = new Set(previousWeekTest.map(r => r.stripe_customer_id));

      console.log(`   Today's paying customers: ${currentWeekCustomers.size}`);
      console.log(`   Week ago paying customers: ${previousWeekCustomers.size}`);

      if (previousWeekCustomers.size > 0) {
        const retained = [...previousWeekCustomers].filter(id => currentWeekCustomers.has(id)).length;
        const retentionRate = (retained / previousWeekCustomers.size) * 100;
        console.log(`   ✅ Paying customer retention: ${retentionRate.toFixed(1)}% (${retained}/${previousWeekCustomers.size})`);
      }
    } else {
      console.log('   ⚠️ Could not test retention calculation');
    }

    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log('\n🎉 Paying Customer Retention Backfill completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`⏰ Duration: ${duration} seconds`);
    console.log(`📸 Total snapshots created: ${totalSnapshotsCreated}`);
    console.log(`📅 Days backfilled: ${daysToBackfill}`);
    console.log(`❌ Errors: ${errors}`);
    if (totalSnapshotsCreated > 0) {
      console.log(`✅ Success rate: ${((totalSnapshotsCreated / (totalSnapshotsCreated + errors)) * 100).toFixed(1)}%`);
    }

    console.log('\n🚀 Next steps:');
    console.log('   1. Test retention APIs: /api/retention/weekly and /api/retention/monthly');
    console.log('   2. Check dashboard RetentionCard for accurate paying customer data');
    console.log('   3. Run daily sync to continue capturing snapshots');
    console.log('   4. Retention calculations now exclude trials completely');

    return { totalSnapshotsCreated, errors, daysBackfilled: daysToBackfill };

  } catch (error) {
    console.error('\n💥 Backfill failed:', error.message);
    console.error(error.stack);
    throw error;
  }
}

// Run the backfill if this file is executed directly
if (require.main === module) {
  // Default to 30 days, but allow command line argument
  const daysToBackfill = process.argv[2] ? parseInt(process.argv[2]) : 30;

  if (isNaN(daysToBackfill) || daysToBackfill < 1 || daysToBackfill > 90) {
    console.error('❌ Invalid days argument. Please provide a number between 1 and 90.');
    console.log('Usage: node backfill-retention-paying-only.js [days]');
    console.log('Example: node backfill-retention-paying-only.js 30');
    process.exit(1);
  }

  backfillPayingCustomerRetention(daysToBackfill)
    .then((result) => {
      console.log('\n🎯 Exiting with success');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💀 Exiting with error:', error.message);
      process.exit(1);
    });
}

module.exports = {
  backfillPayingCustomerRetention
};