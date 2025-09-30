require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const hardcodedSubscriptions = require('../config/hardcodedSubscriptions');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Normalize subscription amount to monthly value
 */
function normalizeToMonthly(amount, interval) {
  const amountInDollars = amount / 100; // Convert from cents

  switch (interval) {
    case 'month':
      return amountInDollars;
    case 'year':
      return amountInDollars / 12;
    case 'week':
      return amountInDollars * 4.33; // Average weeks per month
    case 'day':
      return amountInDollars * 30; // Average days per month
    default:
      return amountInDollars; // Default to treating as monthly
  }
}

/**
 * Calculate discount percentage from Stripe subscription
 */
function calculateDiscountPercent(subscription) {
  if (!subscription.discount || !subscription.discount.coupon) {
    return 0;
  }

  const coupon = subscription.discount.coupon;
  if (coupon.percent_off) {
    return coupon.percent_off;
  } else if (coupon.amount_off) {
    // Calculate percentage based on amount off
    const subscriptionAmount = subscription.items.data.reduce((sum, item) => {
      return sum + (item.price.unit_amount * item.quantity);
    }, 0);

    if (subscriptionAmount > 0) {
      return Math.round((coupon.amount_off / subscriptionAmount) * 100);
    }
  }

  return 0;
}

/**
 * Determine if subscription is considered active
 */
function isSubscriptionActive(status) {
  return ['active', 'trialing', 'past_due'].includes(status);
}

/**
 * Determine if subscription should be counted in official MRR
 * Requirements: status='active', date_canceled=null, percent_off!=100, !usebear.ai
 */
function shouldCountSubscription(subscription, customer) {
  // Only count if status is 'active'
  if (subscription.status !== 'active') {
    return false;
  }

  // Don't count if subscription was canceled
  if (subscription.canceled_at) {
    return false;
  }

  // Don't count if 100% discount
  const percentOff = calculateDiscountPercent(subscription);
  if (percentOff >= 100) {
    return false;
  }

  // Don't count if email ends with usebear.ai
  if (customer.email && customer.email.endsWith('usebear.ai')) {
    return false;
  }

  return true;
}

/**
 * Determine if trial subscription should be counted in trial pipeline
 * Requirements: status='trialing', date_canceled=null, percent_off!=100, !usebear.ai
 */
function shouldCountTrial(subscription, customer) {
  // Only count if status is 'trialing'
  if (subscription.status !== 'trialing') {
    return false;
  }

  // Don't count if subscription was canceled
  if (subscription.canceled_at) {
    return false;
  }

  // Don't count if 100% discount
  const percentOff = calculateDiscountPercent(subscription);
  if (percentOff >= 100) {
    return false;
  }

  // Don't count if email ends with usebear.ai
  if (customer.email && customer.email.endsWith('usebear.ai')) {
    return false;
  }

  return true;
}

/**
 * Process subscription data for Supabase upsert
 */
async function processSubscription(subscription) {
  try {
    // Get customer details (customer is already expanded, so check if it's an object or ID)
    const customer = typeof subscription.customer === 'string'
      ? await stripe.customers.retrieve(subscription.customer)
      : subscription.customer;

    // Calculate subscription totals
    let totalAmount = 0;
    for (const item of subscription.items.data) {
      const price = item.price;
      totalAmount += (price.unit_amount * item.quantity);
    }

    const billingInterval = subscription.items.data[0]?.price?.recurring?.interval || 'month';
    const monthlyTotal = normalizeToMonthly(totalAmount, billingInterval);
    const percentOff = calculateDiscountPercent(subscription);
    const isActive = isSubscriptionActive(subscription.status);
    const isCounted = shouldCountSubscription(subscription, customer);
    const isTrialCounted = shouldCountTrial(subscription, customer);

    // Format dates
    const trialEndDate = subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null;

    const dateCreated = new Date(subscription.created * 1000).toISOString();

    const dateCanceled = subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : null;

    return {
      stripe_subscription_id: subscription.id,
      customer_email: customer.email,
      subscription_status: subscription.status,
      monthly_total: monthlyTotal,
      date_created: dateCreated,
      trial_end_date: trialEndDate,
      is_active: isActive,
      percent_off: percentOff,
      is_counted: isCounted,
      is_trial_counted: isTrialCounted,
      date_canceled: dateCanceled,
      stripe_customer_id: customer.id,
      customer_name: customer.name
    };

  } catch (error) {
    console.error(`❌ Error processing subscription ${subscription.id}:`, error.message);
    throw error;
  }
}

/**
 * Get all subscriptions from Stripe
 */
async function getAllStripeSubscriptions() {
  console.log('🔍 Fetching all subscriptions from Stripe...');
  const subscriptions = [];
  let hasMore = true;
  let startingAfter = null;

  while (hasMore) {
    const params = {
      limit: 100,
      status: 'all', // This ensures we get ALL subscriptions regardless of status (active, canceled, trialing, etc.)
      expand: ['data.customer', 'data.items.data.price'], // Expand customer and price data
    };

    if (startingAfter) {
      params.starting_after = startingAfter;
    }

    try {
      const response = await stripe.subscriptions.list(params);
      subscriptions.push(...response.data);

      hasMore = response.has_more;
      if (hasMore && response.data.length > 0) {
        startingAfter = response.data[response.data.length - 1].id;
      }

      console.log(`📋 Fetched ${subscriptions.length} subscriptions so far...`);

      // Add small delay to avoid rate limiting
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error('❌ Error fetching subscriptions batch:', error.message);
      throw error;
    }
  }

  console.log(`✅ Total subscriptions fetched: ${subscriptions.length}`);
  console.log(`📊 Breakdown by status:`);

  // Show breakdown by status
  const statusBreakdown = subscriptions.reduce((acc, sub) => {
    acc[sub.status] = (acc[sub.status] || 0) + 1;
    return acc;
  }, {});

  Object.entries(statusBreakdown).forEach(([status, count]) => {
    console.log(`   ${status}: ${count}`);
  });

  return subscriptions;
}

/**
 * Update Supabase with all subscription data
 */
async function syncToSupabase(subscriptions) {
  console.log('\n🔄 Syncing subscriptions to Supabase...');
  let processed = 0;
  let errors = 0;

  for (const subscription of subscriptions) {
    try {
      const subscriptionData = await processSubscription(subscription);

      // Upsert subscription (insert or update)
      const { error } = await supabase
        .from('subscriptions')
        .upsert(subscriptionData, {
          onConflict: 'stripe_subscription_id'
        });

      if (error) {
        console.error(`❌ Error upserting subscription ${subscription.id}:`, error.message);
        errors++;
      } else {
        processed++;
        if (processed % 10 === 0) {
          console.log(`📊 Processed ${processed}/${subscriptions.length} subscriptions...`);
        }
      }

    } catch (error) {
      console.error(`❌ Error processing subscription ${subscription.id}:`, error.message);
      errors++;
    }
  }

  console.log(`\n✅ Sync complete! Processed: ${processed}, Errors: ${errors}`);
  return { processed, errors };
}

/**
 * Generate sync report
 */
async function generateReport() {
  console.log('\n📊 Generating sync report...');

  try {
    // Count subscriptions by status
    const { data: statusBreakdown, error: statusError } = await supabase
      .from('subscriptions')
      .select('subscription_status, is_counted, is_trial_counted')
      .order('subscription_status');

    if (statusError) {
      throw statusError;
    }

    // Calculate totals
    const stats = statusBreakdown.reduce((acc, sub) => {
      const status = sub.subscription_status;
      if (!acc[status]) {
        acc[status] = { total: 0, counted: 0, trial_counted: 0 };
      }
      acc[status].total++;
      if (sub.is_counted) acc[status].counted++;
      if (sub.is_trial_counted) acc[status].trial_counted++;
      return acc;
    }, {});

    console.log('\n📋 Subscription Status Breakdown:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Object.entries(stats).forEach(([status, data]) => {
      console.log(`${status.padEnd(15)}: ${data.total.toString().padStart(3)} total, ${data.counted.toString().padStart(3)} counted, ${data.trial_counted.toString().padStart(3)} trial_counted`);
    });

    // Get official MRR totals
    const { data: mrrData, error: mrrError } = await supabase
      .from('subscriptions')
      .select('monthly_total')
      .eq('is_counted', true);

    if (mrrError) {
      throw mrrError;
    }

    const totalMRR = mrrData.reduce((sum, sub) => sum + parseFloat(sub.monthly_total), 0);

    // Get trial pipeline totals
    const { data: trialData, error: trialError } = await supabase
      .from('subscriptions')
      .select('monthly_total')
      .eq('is_trial_counted', true);

    if (trialError) {
      throw trialError;
    }

    const totalTrialPipeline = trialData.reduce((sum, sub) => sum + parseFloat(sub.monthly_total), 0);

    console.log('\n💰 Revenue Totals:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Official MRR:       $${totalMRR.toFixed(2)} (${mrrData.length} subscriptions)`);
    console.log(`Trial Pipeline:     $${totalTrialPipeline.toFixed(2)} (${trialData.length} trials)`);
    console.log(`Total Opportunity:  $${(totalMRR + totalTrialPipeline).toFixed(2)}`);

  } catch (error) {
    console.error('❌ Error generating report:', error.message);
  }
}

async function saveHistoricalMRR() {
  console.log('\n📊 Saving daily historical MRR data...');

  try {
    // Get current MRR metrics from Supabase
    const { data: payingSubscriptions, error: payingError } = await supabase
      .from('subscriptions')
      .select('monthly_total')
      .eq('is_counted', true)
      .eq('is_active', true);

    if (payingError) throw payingError;

    const { data: trialSubscriptions, error: trialError } = await supabase
      .from('subscriptions')
      .select('monthly_total')
      .eq('subscription_status', 'trialing')
      .eq('is_active', true)
      .eq('is_trial_counted', true);

    if (trialError) throw trialError;

    // Add hard-coded customers from config
    const hardCodedMRR = hardcodedSubscriptions.reduce((sum, sub) => sum + sub.monthly_total, 0);

    // Calculate metrics
    const officialMRR = payingSubscriptions.reduce((sum, sub) => sum + parseFloat(sub.monthly_total), 0) + hardCodedMRR;
    const arr = officialMRR * 12;
    const payingCustomersCount = payingSubscriptions.length + hardcodedSubscriptions.length;
    const averageCustomerValue = payingCustomersCount > 0 ? officialMRR / payingCustomersCount : 0;
    const trialPipelineMRR = trialSubscriptions.reduce((sum, sub) => sum + parseFloat(sub.monthly_total), 0);
    const activeTrialsCount = trialSubscriptions.length;
    const totalOpportunity = officialMRR + trialPipelineMRR;

    // Insert or update today's record
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    const { error: upsertError } = await supabase
      .from('historical_mrr')
      .upsert({
        date: today,
        official_mrr: officialMRR,
        arr: arr,
        paying_customers_count: payingCustomersCount,
        average_customer_value: averageCustomerValue,
        trial_pipeline_mrr: trialPipelineMRR,
        active_trials_count: activeTrialsCount,
        total_opportunity: totalOpportunity
      }, {
        onConflict: 'date'
      });

    if (upsertError) throw upsertError;

    console.log(`✅ Historical MRR saved for ${today}: $${officialMRR.toFixed(2)} MRR, $${arr.toFixed(2)} ARR`);

  } catch (error) {
    console.error('❌ Error saving historical MRR:', error.message);
    // Don't throw error - we don't want to fail the entire sync for this
  }
}

async function saveCustomerRetentionSnapshots() {
  console.log('\n👥 Saving daily customer retention snapshots...');

  try {
    // Get all current subscription data for retention tracking
    const { data: allSubscriptions, error: subscriptionsError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, customer_email, customer_name, subscription_status, monthly_total, is_active, is_counted');

    if (subscriptionsError) throw subscriptionsError;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    // Prepare customer snapshots
    const customerSnapshots = allSubscriptions.map(sub => ({
      date: today,
      stripe_customer_id: sub.stripe_customer_id,
      stripe_subscription_id: sub.stripe_subscription_id,
      customer_email: sub.customer_email,
      customer_name: sub.customer_name,
      subscription_status: sub.subscription_status,
      monthly_value: parseFloat(sub.monthly_total),
      is_active: sub.is_active,
      is_counted: sub.is_counted
    }));

    // Add hard-coded customers from config to retention tracking
    hardcodedSubscriptions.forEach(hardcodedSub => {
      customerSnapshots.push({
        date: today,
        stripe_customer_id: hardcodedSub.stripe_subscription_id.replace('manual_', 'hardcoded_'),
        stripe_subscription_id: hardcodedSub.stripe_subscription_id,
        customer_email: hardcodedSub.customer_email,
        customer_name: hardcodedSub.customer_name,
        subscription_status: hardcodedSub.subscription_status,
        monthly_value: parseFloat(hardcodedSub.monthly_total),
        is_active: hardcodedSub.is_active,
        is_counted: hardcodedSub.is_counted
      });
    });

    // First, delete any existing snapshots for today to ensure clean data
    const { error: deleteError } = await supabase
      .from('customer_retention_snapshots')
      .delete()
      .eq('date', today);

    if (deleteError) {
      console.warn(`⚠️ Warning deleting existing snapshots for ${today}:`, deleteError.message);
    }

    // Insert all customer snapshots in batches (Supabase has limits on batch size)
    const batchSize = 100;
    let totalInserted = 0;
    let errors = 0;

    for (let i = 0; i < customerSnapshots.length; i += batchSize) {
      const batch = customerSnapshots.slice(i, i + batchSize);

      const { error: insertError } = await supabase
        .from('customer_retention_snapshots')
        .insert(batch);

      if (insertError) {
        console.error(`❌ Error inserting customer snapshot batch ${i / batchSize + 1}:`, insertError.message);
        errors++;
      } else {
        totalInserted += batch.length;
        if (totalInserted % 50 === 0) {
          console.log(`📊 Inserted ${totalInserted}/${customerSnapshots.length} customer snapshots...`);
        }
      }
    }

    console.log(`✅ Customer retention snapshots saved for ${today}: ${totalInserted} customers tracked`);
    if (errors > 0) {
      console.warn(`⚠️ ${errors} batch errors occurred during customer snapshot insertion`);
    }

  } catch (error) {
    console.error('❌ Error saving customer retention snapshots:', error.message);
    // Don't throw error - we don't want to fail the entire sync for this
  }
}

/**
 * Main sync function
 */
async function dailySync() {
  const startTime = new Date();
  console.log('🌅 Starting Daily Stripe → Supabase Sync');
  console.log(`⏰ Started at: ${startTime.toLocaleString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Validate environment
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY environment variable not set');
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Supabase environment variables not set');
    }

    console.log('✅ Environment variables validated');

    // Fetch all subscriptions from Stripe
    const subscriptions = await getAllStripeSubscriptions();

    // Sync to Supabase
    const result = await syncToSupabase(subscriptions);

    // Save daily historical MRR data
    await saveHistoricalMRR();

    // Save daily customer retention snapshots
    await saveCustomerRetentionSnapshots();

    // Generate report
    await generateReport();

    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log('\n🎉 Daily sync completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`⏰ Duration: ${duration} seconds`);
    console.log(`📊 Processed: ${result.processed} subscriptions`);
    console.log(`❌ Errors: ${result.errors}`);
    console.log(`✅ Success rate: ${((result.processed / (result.processed + result.errors)) * 100).toFixed(1)}%`);

    return result;

  } catch (error) {
    console.error('\n💥 Daily sync failed:', error.message);
    console.error(error.stack);
    throw error;
  }
}

// Run the sync if this file is executed directly
if (require.main === module) {
  dailySync()
    .then(() => {
      console.log('\n🎯 Exiting with success');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💀 Exiting with error:', error.message);
      process.exit(1);
    });
}

module.exports = {
  dailySync,
  getAllStripeSubscriptions,
  processSubscription,
  shouldCountSubscription,
  shouldCountTrial
};