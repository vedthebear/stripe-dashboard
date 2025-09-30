require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');
const hardcodedSubscriptions = require('../config/hardcodedSubscriptions');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Backfill historical MRR data for the last N days
 * This reconstructs what the MRR would have been on each day based on subscription lifecycles
 */
async function backfillHistoricalMRR(daysToBackfill = 30) {
  const startTime = new Date();
  console.log('📈 Starting Historical MRR Data Backfill');
  console.log(`⏰ Started at: ${startTime.toLocaleString()}`);
  console.log(`📅 Backfilling last ${daysToBackfill} days of MRR history`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Validate environment
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Supabase environment variables not set');
    }

    console.log('✅ Environment variables validated');

    // Get all subscriptions with their lifecycle data
    console.log('\n📋 Fetching subscription lifecycle data...');
    const { data: allSubscriptions, error: subscriptionsError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, customer_email, customer_name, subscription_status, monthly_total, is_active, is_counted, date_created, date_canceled');

    if (subscriptionsError) {
      throw subscriptionsError;
    }

    console.log(`✅ Found ${allSubscriptions.length} total subscriptions`);

    // Check existing historical_mrr data to avoid duplicates
    const { data: existingMRR, error: existingError } = await supabase
      .from('historical_mrr')
      .select('date')
      .order('date', { ascending: true });

    if (existingError) {
      throw existingError;
    }

    if (existingMRR && existingMRR.length > 0) {
      console.log(`⚠️ Warning: historical_mrr table already contains ${existingMRR.length} records`);
      console.log(`   Existing date range: ${existingMRR[0]?.date} to ${existingMRR[existingMRR.length - 1]?.date}`);
      console.log('   This script will add new records without removing existing ones');
    }

    // Generate MRR snapshots for each day
    const today = new Date();
    let totalMRRRecordsCreated = 0;
    let errors = 0;
    const mrrHistory = [];

    for (let dayOffset = daysToBackfill - 1; dayOffset >= 0; dayOffset--) {
      const snapshotDate = new Date(today);
      snapshotDate.setDate(today.getDate() - dayOffset);
      const dateString = snapshotDate.toISOString().split('T')[0];

      console.log(`\n💰 Calculating MRR for ${dateString}...`);

      // Filter subscriptions that would have been contributing to MRR on this date
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

        // Apply the same business logic as current MRR calculations
        return sub.is_counted; // Only count subscriptions that meet MRR criteria
      });

      // Calculate MRR metrics for this date
      const hardCodedMRR = hardcodedSubscriptions.reduce((sum, sub) => sum + sub.monthly_total, 0);
      const subscriptionMRR = activeOnDate.reduce((sum, sub) => sum + parseFloat(sub.monthly_total), 0);
      const officialMRR = subscriptionMRR + hardCodedMRR;
      const arr = officialMRR * 12;
      const payingCustomersCount = activeOnDate.length + hardcodedSubscriptions.length;
      const averageCustomerValue = payingCustomersCount > 0 ? officialMRR / payingCustomersCount : 0;

      // Calculate trial pipeline for this date (subscriptions that were trialing)
      const trialOnDate = allSubscriptions.filter(sub => {
        const createdDate = new Date(sub.date_created);
        const canceledDate = sub.date_canceled ? new Date(sub.date_canceled) : null;
        const trialEndDate = sub.trial_end_date ? new Date(sub.trial_end_date) : null;

        // Must have existed and been trialing on this date
        if (createdDate > snapshotDate) return false;
        if (canceledDate && canceledDate <= snapshotDate) return false;
        if (!trialEndDate || trialEndDate <= snapshotDate) return false;

        return sub.subscription_status === 'trialing' && sub.is_trial_counted;
      });

      const trialPipelineMRR = trialOnDate.reduce((sum, sub) => sum + parseFloat(sub.monthly_total), 0);
      const activeTrialsCount = trialOnDate.length;
      const totalOpportunity = officialMRR + trialPipelineMRR;

      // Prepare historical MRR record
      const mrrRecord = {
        date: dateString,
        official_mrr: officialMRR,
        arr: arr,
        paying_customers_count: payingCustomersCount,
        average_customer_value: averageCustomerValue,
        trial_pipeline_mrr: trialPipelineMRR,
        active_trials_count: activeTrialsCount,
        total_opportunity: totalOpportunity
      };

      mrrHistory.push(mrrRecord);

      console.log(`   📊 MRR: $${officialMRR.toFixed(2)} (${payingCustomersCount} customers)`);
      console.log(`   📈 ARR: $${arr.toFixed(2)}`);
      console.log(`   🔄 Trial Pipeline: $${trialPipelineMRR.toFixed(2)} (${activeTrialsCount} trials)`);

      // Insert the MRR record
      const { error: insertError } = await supabase
        .from('historical_mrr')
        .upsert(mrrRecord, {
          onConflict: 'date'
        });

      if (insertError) {
        console.error(`   ❌ Error inserting MRR for ${dateString}:`, insertError.message);
        errors++;
      } else {
        totalMRRRecordsCreated++;
        console.log(`   ✅ MRR record created for ${dateString}`);
      }
    }

    // Generate growth analysis
    console.log('\n📊 Generating MRR growth analysis...');

    if (mrrHistory.length >= 2) {
      const oldestMRR = mrrHistory[0].official_mrr;
      const newestMRR = mrrHistory[mrrHistory.length - 1].official_mrr;
      const totalGrowth = newestMRR - oldestMRR;
      const growthPercent = oldestMRR > 0 ? (totalGrowth / oldestMRR) * 100 : 0;

      console.log(`📈 MRR Growth over ${daysToBackfill} days:`);
      console.log(`   Start: $${oldestMRR.toFixed(2)} (${mrrHistory[0].date})`);
      console.log(`   End: $${newestMRR.toFixed(2)} (${mrrHistory[mrrHistory.length - 1].date})`);
      console.log(`   Growth: $${totalGrowth.toFixed(2)} (${growthPercent >= 0 ? '+' : ''}${growthPercent.toFixed(1)}%)`);

      // Calculate daily average growth
      const dailyGrowth = totalGrowth / daysToBackfill;
      console.log(`   Daily avg: $${dailyGrowth.toFixed(2)}/day`);

      // Find biggest single day changes
      let biggestGrowthDay = null;
      let biggestGrowth = 0;
      let biggestDeclineDay = null;
      let biggestDecline = 0;

      for (let i = 1; i < mrrHistory.length; i++) {
        const dayChange = mrrHistory[i].official_mrr - mrrHistory[i - 1].official_mrr;
        if (dayChange > biggestGrowth) {
          biggestGrowth = dayChange;
          biggestGrowthDay = mrrHistory[i].date;
        }
        if (dayChange < biggestDecline) {
          biggestDecline = dayChange;
          biggestDeclineDay = mrrHistory[i].date;
        }
      }

      if (biggestGrowthDay) {
        console.log(`   📈 Biggest growth day: ${biggestGrowthDay} (+$${biggestGrowth.toFixed(2)})`);
      }
      if (biggestDeclineDay) {
        console.log(`   📉 Biggest decline day: ${biggestDeclineDay} ($${biggestDecline.toFixed(2)})`);
      }
    }

    // Verify final data
    console.log('\n🔍 Verifying backfilled data...');

    const { data: finalData, error: finalError } = await supabase
      .from('historical_mrr')
      .select('date, official_mrr, arr')
      .gte('date', new Date(today.getTime() - (daysToBackfill * 24 * 60 * 60 * 1000)).toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (!finalError && finalData) {
      console.log(`✅ Verified ${finalData.length} MRR records in database`);
      console.log(`   Date range: ${finalData[0]?.date} to ${finalData[finalData.length - 1]?.date}`);
      console.log(`   MRR range: $${Math.min(...finalData.map(d => d.official_mrr)).toFixed(2)} to $${Math.max(...finalData.map(d => d.official_mrr)).toFixed(2)}`);
    }

    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log('\n🎉 Historical MRR backfill completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`⏰ Duration: ${duration} seconds`);
    console.log(`💰 MRR records created: ${totalMRRRecordsCreated}`);
    console.log(`📅 Days backfilled: ${daysToBackfill}`);
    console.log(`❌ Errors: ${errors}`);
    if (totalMRRRecordsCreated > 0) {
      console.log(`✅ Success rate: ${((totalMRRRecordsCreated / (totalMRRRecordsCreated + errors)) * 100).toFixed(1)}%`);
    }

    console.log('\n🚀 Next steps:');
    console.log('   1. Check MRR Growth Chart on dashboard for historical timeline');
    console.log('   2. Test /api/historical/mrr endpoint for historical data');
    console.log('   3. Daily sync will continue adding new MRR snapshots');
    console.log('   4. Consider running this backfill with more days if needed');

    return { totalMRRRecordsCreated, errors, daysBackfilled: daysToBackfill, mrrHistory };

  } catch (error) {
    console.error('\n💥 Historical MRR backfill failed:', error.message);
    console.error(error.stack);
    throw error;
  }
}

// Run the backfill if this file is executed directly
if (require.main === module) {
  // Default to 30 days, but allow command line argument
  const daysToBackfill = process.argv[2] ? parseInt(process.argv[2]) : 30;

  if (isNaN(daysToBackfill) || daysToBackfill < 1 || daysToBackfill > 365) {
    console.error('❌ Invalid days argument. Please provide a number between 1 and 365.');
    console.log('Usage: node backfill-historical-mrr.js [days]');
    console.log('Example: node backfill-historical-mrr.js 60  # Last 60 days');
    process.exit(1);
  }

  backfillHistoricalMRR(daysToBackfill)
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
  backfillHistoricalMRR
};