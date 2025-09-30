const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const hardcodedSubscriptions = require('../../config/hardcodedSubscriptions');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function normalizeToMonthly(amount, interval) {
  const amountInDollars = amount / 100;

  switch (interval) {
    case 'month':
      return amountInDollars;
    case 'year':
      return amountInDollars / 12;
    case 'week':
      return amountInDollars * 4.33;
    case 'day':
      return amountInDollars * 30;
    default:
      return amountInDollars;
  }
}

function calculateDiscountPercent(subscription) {
  if (!subscription.discount || !subscription.discount.coupon) {
    return 0;
  }

  const coupon = subscription.discount.coupon;
  if (coupon.percent_off) {
    return coupon.percent_off;
  } else if (coupon.amount_off) {
    const subscriptionAmount = subscription.items.data.reduce((sum, item) => {
      return sum + (item.price.unit_amount * item.quantity);
    }, 0);

    if (subscriptionAmount > 0) {
      return Math.round((coupon.amount_off / subscriptionAmount) * 100);
    }
  }

  return 0;
}

function isSubscriptionActive(status) {
  return ['active', 'trialing', 'past_due'].includes(status);
}

function shouldCountSubscription(subscription, customer) {
  if (subscription.status !== 'active') {
    return false;
  }

  if (subscription.canceled_at) {
    return false;
  }

  const percentOff = calculateDiscountPercent(subscription);
  if (percentOff >= 100) {
    return false;
  }

  if (customer.email && customer.email.endsWith('usebear.ai')) {
    return false;
  }

  return true;
}

function shouldCountTrial(subscription, customer) {
  if (subscription.status !== 'trialing') {
    return false;
  }

  if (subscription.canceled_at) {
    return false;
  }

  const percentOff = calculateDiscountPercent(subscription);
  if (percentOff >= 100) {
    return false;
  }

  if (customer.email && customer.email.endsWith('usebear.ai')) {
    return false;
  }

  return true;
}

async function processSubscription(subscription) {
  try {
    const customer = typeof subscription.customer === 'string'
      ? await stripe.customers.retrieve(subscription.customer)
      : subscription.customer;

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
    console.error(`Error processing subscription ${subscription.id}:`, error.message);
    throw error;
  }
}

async function getAllStripeSubscriptions() {
  console.log('🔍 Fetching all subscriptions from Stripe...');
  const subscriptions = [];
  let hasMore = true;
  let startingAfter = null;

  while (hasMore) {
    const params = {
      limit: 100,
      status: 'all',
      expand: ['data.customer', 'data.items.data.price'],
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

      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error('Error fetching subscriptions batch:', error.message);
      throw error;
    }
  }

  console.log(`✅ Total subscriptions fetched: ${subscriptions.length}`);
  return subscriptions;
}

async function syncToSupabase(subscriptions) {
  console.log('🔄 Syncing subscriptions to Supabase...');
  let processed = 0;
  let errors = 0;

  for (const subscription of subscriptions) {
    try {
      const subscriptionData = await processSubscription(subscription);

      const { error } = await supabase
        .from('subscriptions')
        .upsert(subscriptionData, {
          onConflict: 'stripe_subscription_id'
        });

      if (error) {
        console.error(`Error upserting subscription ${subscription.id}:`, error.message);
        errors++;
      } else {
        processed++;
      }

    } catch (error) {
      console.error(`Error processing subscription ${subscription.id}:`, error.message);
      errors++;
    }
  }

  console.log(`✅ Sync complete! Processed: ${processed}, Errors: ${errors}`);
  return { processed, errors };
}

async function saveHistoricalMRR() {
  console.log('📊 Saving daily historical MRR data...');

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
      .select('stripe_customer_id, stripe_subscription_id, customer_email, customer_name, subscription_status, monthly_total, is_active, is_counted, is_trial_counted, percent_off');

    if (subscriptionsError) throw subscriptionsError;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    // Prepare customer snapshots (excluding hardcoded subscriptions)
    const customerSnapshots = allSubscriptions.map(sub => ({
      date: today,
      stripe_customer_id: sub.stripe_customer_id,
      stripe_subscription_id: sub.stripe_subscription_id,
      customer_email: sub.customer_email,
      customer_name: sub.customer_name,
      subscription_status: sub.subscription_status,
      monthly_value: parseFloat(sub.monthly_total),
      is_active: sub.is_active,
      is_counted: sub.is_counted,
      is_trial_counted: sub.is_trial_counted || false,
      percent_off: sub.percent_off
    }));

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

export default async function handler(req, res) {
  console.log('🌅 Starting Vercel Cron Job - Daily Stripe → Supabase Sync');
  const startTime = new Date();

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

    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log('🎉 Daily sync completed successfully!');
    console.log(`⏰ Duration: ${duration} seconds`);
    console.log(`📊 Processed: ${result.processed} subscriptions`);
    console.log(`❌ Errors: ${result.errors}`);

    res.status(200).json({
      success: true,
      duration: duration,
      processed: result.processed,
      errors: result.errors,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('💥 Daily sync failed:', error.message);

    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}