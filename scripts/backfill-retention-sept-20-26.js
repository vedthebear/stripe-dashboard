require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Date range for backfill
const START_DATE = '2025-09-01';
const END_DATE = '2025-09-19';

/**
 * Helper: Check if a subscription was in trialing status on a specific date
 */
function wasTrialingOnDate(subscription, snapshotDate) {
  if (!subscription.trial_end_date) {
    return false;
  }

  const trialEnd = new Date(subscription.trial_end_date);
  const created = new Date(subscription.date_created);
  const snapshot = new Date(snapshotDate);

  // Must be within trial period on that date
  return created <= snapshot && trialEnd >= snapshot;
}

/**
 * Helper: Check if subscription existed and wasn't canceled on a specific date
 */
function wasActiveOnDate(subscription, snapshotDate) {
  const created = new Date(subscription.date_created);
  const snapshot = new Date(snapshotDate);

  // Must have been created by this date
  if (created > snapshot) {
    return false;
  }

  // If canceled, must have been canceled after this date
  if (subscription.date_canceled) {
    const canceled = new Date(subscription.date_canceled);
    if (canceled <= snapshot) {
      return false;
    }
  }

  return true;
}

/**
 * Helper: Calculate subscription_status on a specific date
 */
function getStatusOnDate(subscription, snapshotDate) {
  if (wasTrialingOnDate(subscription, snapshotDate)) {
    return 'trialing';
  }
  return 'active';
}

/**
 * Helper: Check if subscription should be counted (is_counted) on a specific date
 */
function shouldBeCountedOnDate(subscription, snapshotDate) {
  const status = getStatusOnDate(subscription, snapshotDate);

  // Must be active (not trialing)
  if (status !== 'active') {
    return false;
  }

  // Must not be canceled on this date
  if (subscription.date_canceled) {
    const canceled = new Date(subscription.date_canceled);
    if (canceled <= new Date(snapshotDate)) {
      return false;
    }
  }

  // Must have discount < 100%
  if (subscription.percent_off !== null && subscription.percent_off >= 100) {
    return false;
  }

  // Must not be usebear.ai email
  if (subscription.customer_email && subscription.customer_email.endsWith('usebear.ai')) {
    return false;
  }

  return true;
}

/**
 * Helper: Check if trial should be counted (is_trial_counted) on a specific date
 */
function shouldTrialBeCountedOnDate(subscription, snapshotDate) {
  const status = getStatusOnDate(subscription, snapshotDate);

  // Must be trialing
  if (status !== 'trialing') {
    return false;
  }

  // Must not be canceled on this date
  if (subscription.date_canceled) {
    const canceled = new Date(subscription.date_canceled);
    if (canceled <= new Date(snapshotDate)) {
      return false;
    }
  }

  // Must have discount < 100%
  if (subscription.percent_off !== null && subscription.percent_off >= 100) {
    return false;
  }

  // Must not be usebear.ai email
  if (subscription.customer_email && subscription.customer_email.endsWith('usebear.ai')) {
    return false;
  }

  return true;
}

/**
 * Helper: Get all dates in range
 */
function getDateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Main backfill function
 */
async function backfillRetentionSnapshots() {
  const startTime = new Date();
  console.log('🔄 Starting Retention Snapshots Backfill');
  console.log(`⏰ Started at: ${startTime.toLocaleString()}`);
  console.log(`📅 Date range: ${START_DATE} to ${END_DATE}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Validate environment
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Supabase environment variables not set');
    }
    console.log('✅ Environment validated');

    // Fetch all subscriptions
    console.log('\n📋 Fetching all subscriptions from database...');
    const { data: allSubscriptions, error: fetchError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, customer_email, customer_name, monthly_total, date_created, date_canceled, trial_end_date, percent_off');

    if (fetchError) {
      throw new Error(`Failed to fetch subscriptions: ${fetchError.message}`);
    }

    console.log(`✅ Found ${allSubscriptions.length} subscriptions`);

    // Get all dates in range
    const dates = getDateRange(START_DATE, END_DATE);
    console.log(`📆 Processing ${dates.length} dates: ${dates.join(', ')}`);

    let totalSnapshotsCreated = 0;
    let totalErrors = 0;

    // Process each date
    for (const snapshotDate of dates) {
      console.log(`\n📸 Processing ${snapshotDate}...`);

      // Filter subscriptions that existed on this date
      const activeSubscriptions = allSubscriptions.filter(sub =>
        wasActiveOnDate(sub, snapshotDate)
      );

      console.log(`   Found ${activeSubscriptions.length} subscriptions active on ${snapshotDate}`);

      // Build snapshots for this date
      const snapshots = [];

      for (const subscription of activeSubscriptions) {
        const status = getStatusOnDate(subscription, snapshotDate);
        const isCounted = shouldBeCountedOnDate(subscription, snapshotDate);
        const isTrialCounted = shouldTrialBeCountedOnDate(subscription, snapshotDate);

        // Only include if counted or trial counted
        if (!isCounted && !isTrialCounted) {
          continue;
        }

        const isActive = (status === 'trialing' || status === 'active');

        snapshots.push({
          date: snapshotDate,
          stripe_customer_id: subscription.stripe_customer_id,
          stripe_subscription_id: subscription.stripe_subscription_id,
          customer_email: subscription.customer_email,
          customer_name: subscription.customer_name,
          subscription_status: status,
          monthly_value: parseFloat(subscription.monthly_total || 0),
          is_active: isActive,
          is_counted: isCounted,
          is_trial_counted: isTrialCounted,
          percent_off: subscription.percent_off
        });
      }

      console.log(`   Created ${snapshots.length} snapshots (${snapshots.filter(s => s.is_counted).length} counted, ${snapshots.filter(s => s.is_trial_counted).length} trial counted)`);

      // Insert in batches
      if (snapshots.length > 0) {
        const batchSize = 100;
        let inserted = 0;

        for (let i = 0; i < snapshots.length; i += batchSize) {
          const batch = snapshots.slice(i, i + batchSize);

          const { error: insertError } = await supabase
            .from('customer_retention_snapshots')
            .insert(batch);

          if (insertError) {
            console.error(`   ❌ Error inserting batch: ${insertError.message}`);
            totalErrors++;
          } else {
            inserted += batch.length;
          }
        }

        console.log(`   ✅ Inserted ${inserted} snapshots for ${snapshotDate}`);
        totalSnapshotsCreated += inserted;
      } else {
        console.log(`   ⚠️ No snapshots to insert for ${snapshotDate}`);
      }
    }

    // Summary
    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Backfill completed!');
    console.log(`⏰ Duration: ${duration} seconds`);
    console.log(`📸 Total snapshots created: ${totalSnapshotsCreated}`);
    console.log(`📅 Dates processed: ${dates.length}`);
    console.log(`❌ Errors: ${totalErrors}`);

    // Verification query
    console.log('\n🔍 Verifying results...');
    const { data: verification, error: verifyError } = await supabase
      .from('customer_retention_snapshots')
      .select('date, is_counted, is_trial_counted')
      .gte('date', START_DATE)
      .lte('date', END_DATE)
      .order('date');

    if (!verifyError && verification) {
      const dailyCounts = {};
      verification.forEach(row => {
        if (!dailyCounts[row.date]) {
          dailyCounts[row.date] = { total: 0, counted: 0, trial_counted: 0 };
        }
        dailyCounts[row.date].total++;
        if (row.is_counted) dailyCounts[row.date].counted++;
        if (row.is_trial_counted) dailyCounts[row.date].trial_counted++;
      });

      console.log('\n📊 Daily breakdown:');
      Object.entries(dailyCounts).forEach(([date, counts]) => {
        console.log(`   ${date}: ${counts.total} total, ${counts.counted} counted, ${counts.trial_counted} trial counted`);
      });
    }

    console.log('\n✅ Backfill completed successfully!');
    return { totalSnapshotsCreated, totalErrors, datesProcessed: dates.length };

  } catch (error) {
    console.error('\n💥 Backfill failed:', error.message);
    console.error(error.stack);
    throw error;
  }
}

// Run the backfill
if (require.main === module) {
  backfillRetentionSnapshots()
    .then((result) => {
      console.log('\n🎯 Exiting with success');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💀 Exiting with error:', error.message);
      process.exit(1);
    });
}

module.exports = { backfillRetentionSnapshots };
