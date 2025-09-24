const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client
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

  // Don't count if email ends with usebear.ai (keeping this existing filter)
  if (customer.email && customer.email.endsWith('usebear.ai')) {
    return false;
  }

  return true;
}

/**
 * Determine if trial subscription should be counted in trial pipeline
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
async function processSubscriptionForUpsert(subscription, stripe) {
  try {
    // Get customer details
    const customer = await stripe.customers.retrieve(subscription.customer);

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
    console.error(`Error processing subscription ${subscription.id}:`, error.message);
    throw error;
  }
}

/**
 * Sync subscription to Supabase
 */
async function syncSubscriptionToSupabase(subscription, stripe) {
  try {
    console.log(`🔄 Syncing subscription ${subscription.id} to Supabase...`);

    const subscriptionData = await processSubscriptionForUpsert(subscription, stripe);

    // Upsert subscription (insert or update)
    const { data, error } = await supabase
      .from('subscriptions')
      .upsert(subscriptionData, {
        onConflict: 'stripe_subscription_id'
      })
      .select();

    if (error) {
      console.error(`❌ Error upserting subscription ${subscription.id}:`, error);
      throw error;
    }

    console.log(`✅ Successfully synced subscription ${subscription.id} (status: ${subscription.status}, counted: ${subscriptionData.is_counted})`);
    return data;

  } catch (error) {
    console.error(`❌ Failed to sync subscription ${subscription.id}:`, error.message);
    throw error;
  }
}

/**
 * Handle subscription created event
 */
async function handleSubscriptionCreated(event, stripe) {
  console.log('📝 Handling subscription.created event');
  const subscription = event.data.object;
  await syncSubscriptionToSupabase(subscription, stripe);
}

/**
 * Handle subscription updated event
 */
async function handleSubscriptionUpdated(event, stripe) {
  console.log('📝 Handling subscription.updated event');
  const subscription = event.data.object;
  await syncSubscriptionToSupabase(subscription, stripe);
}

/**
 * Handle subscription deleted/canceled event
 */
async function handleSubscriptionDeleted(event, stripe) {
  console.log('📝 Handling subscription.deleted event');
  const subscription = event.data.object;

  // For deleted subscriptions, we still want to sync them but mark as canceled
  // and set the canceled date
  subscription.status = 'canceled';
  subscription.canceled_at = Math.floor(Date.now() / 1000);

  await syncSubscriptionToSupabase(subscription, stripe);
}

/**
 * Handle customer updated event (to sync email/name changes)
 */
async function handleCustomerUpdated(event, stripe) {
  console.log('📝 Handling customer.updated event');
  const customer = event.data.object;

  try {
    // Get all subscriptions for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      limit: 100
    });

    // Update all subscriptions with new customer info
    for (const subscription of subscriptions.data) {
      await syncSubscriptionToSupabase(subscription, stripe);
    }

    console.log(`✅ Updated ${subscriptions.data.length} subscriptions for customer ${customer.id}`);

  } catch (error) {
    console.error(`❌ Error handling customer update for ${customer.id}:`, error.message);
  }
}

/**
 * Main webhook handler
 */
async function handleWebhook(event, stripe) {
  console.log(`🪝 Received webhook: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event, stripe);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event, stripe);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event, stripe);
        break;

      case 'customer.updated':
        await handleCustomerUpdated(event, stripe);
        break;

      case 'invoice.payment_succeeded':
        // Subscription might have changed status, sync it
        console.log('📝 Handling invoice.payment_succeeded - syncing subscription');
        const invoice = event.data.object;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          await syncSubscriptionToSupabase(subscription, stripe);
        }
        break;

      case 'invoice.payment_failed':
        // Subscription might have gone past_due, sync it
        console.log('📝 Handling invoice.payment_failed - syncing subscription');
        const failedInvoice = event.data.object;
        if (failedInvoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(failedInvoice.subscription);
          await syncSubscriptionToSupabase(subscription, stripe);
        }
        break;

      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    console.log(`✅ Successfully processed webhook: ${event.type}`);

  } catch (error) {
    console.error(`❌ Error processing webhook ${event.type}:`, error.message);
    throw error;
  }
}

module.exports = {
  handleWebhook,
  syncSubscriptionToSupabase,
  processSubscriptionForUpsert,
  shouldCountSubscription,
  shouldCountTrial
};