require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

// Check if environment variables are loaded
console.log('🔑 Checking environment variables...');
console.log('Stripe key loaded:', !!process.env.STRIPE_SECRET_KEY);
console.log('Supabase URL loaded:', !!process.env.SUPABASE_URL);
console.log('Supabase key loaded:', !!process.env.SUPABASE_ANON_KEY);

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY not found in environment variables');
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ Supabase credentials not found in environment variables');
  process.exit(1);
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Initialize Supabase client
// Add your Supabase URL and key to your .env file
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
 * Process a single subscription for Supabase insertion
 */
async function processSubscription(subscription) {
  try {
    // Get customer details
    const customer = await stripe.customers.retrieve(subscription.customer);

    // Calculate subscription totals
    let totalAmount = 0;
    let billingInterval = 'month';

    for (const item of subscription.items.data) {
      const price = item.price;
      totalAmount += (price.unit_amount * item.quantity);
      billingInterval = price.recurring.interval;
    }

    const monthlyTotal = normalizeToMonthly(totalAmount, billingInterval);
    const percentOff = calculateDiscountPercent(subscription);
    const isActive = isSubscriptionActive(subscription.status);

    // Determine if subscription should be counted in official MRR
    // Default to true, but you can add logic here to exclude certain subscriptions
    const isCounted = true;

    // Format trial end date
    const trialEndDate = subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null;

    // Format creation date
    const dateCreated = new Date(subscription.created * 1000).toISOString();

    // Format canceled date
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
      date_canceled: dateCanceled,
      stripe_customer_id: customer.id,
      customer_name: customer.name
    };

  } catch (error) {
    console.error(`Error processing subscription ${subscription.id}:`, error.message);
    return null;
  }
}

/**
 * Migrate all subscriptions from Stripe to Supabase
 */
async function migrateAllSubscriptions() {
  console.log('🚀 Starting migration of ALL Stripe subscriptions to Supabase...');

  let totalProcessed = 0;
  let totalInserted = 0;
  let totalErrors = 0;
  let hasMore = true;
  let startingAfter = null;

  // Clear existing data first (optional - comment out if you want to keep existing data)
  console.log('🗑️ Clearing existing subscription data...');
  const { error: deleteError } = await supabase
    .from('subscriptions')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows

  if (deleteError) {
    console.error('❌ Error clearing existing data:', deleteError);
    return;
  }

  while (hasMore) {
    try {
      console.log(`📥 Fetching subscriptions batch (starting after: ${startingAfter || 'beginning'})...`);

      const params = {
        limit: 100,
        status: 'all', // Get ALL subscriptions regardless of status
      };

      if (startingAfter) {
        params.starting_after = startingAfter;
      }

      const subscriptions = await stripe.subscriptions.list(params);

      console.log(`📋 Processing ${subscriptions.data.length} subscriptions...`);

      // Process each subscription
      const processedSubscriptions = [];
      for (const subscription of subscriptions.data) {
        totalProcessed++;
        const processed = await processSubscription(subscription);
        if (processed) {
          processedSubscriptions.push(processed);
        }
      }

      // Batch insert to Supabase
      if (processedSubscriptions.length > 0) {
        console.log(`💾 Inserting ${processedSubscriptions.length} subscriptions to Supabase...`);

        const { data, error } = await supabase
          .from('subscriptions')
          .insert(processedSubscriptions);

        if (error) {
          console.error('❌ Error inserting batch:', error);
          totalErrors += processedSubscriptions.length;
        } else {
          totalInserted += processedSubscriptions.length;
          console.log(`✅ Successfully inserted ${processedSubscriptions.length} subscriptions`);
        }
      }

      // Check if there are more subscriptions
      hasMore = subscriptions.has_more;
      if (subscriptions.data.length > 0) {
        startingAfter = subscriptions.data[subscriptions.data.length - 1].id;
      }

      // Progress update
      console.log(`📊 Progress: ${totalProcessed} processed, ${totalInserted} inserted, ${totalErrors} errors`);

    } catch (error) {
      console.error('❌ Error during migration batch:', error.message);
      hasMore = false; // Stop on error
    }
  }

  console.log('\n🎉 Migration completed!');
  console.log(`📊 Final Results:
    - Total processed: ${totalProcessed}
    - Total inserted: ${totalInserted}
    - Total errors: ${totalErrors}
  `);

  // Verify the migration
  await verifyMigration();
}

/**
 * Verify the migration by checking counts and sample data
 */
async function verifyMigration() {
  console.log('\n🔍 Verifying migration...');

  try {
    // Get total count
    const { count: totalCount, error: countError } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('❌ Error getting total count:', countError);
      return;
    }

    // Get status breakdown
    const { data: statusBreakdown, error: statusError } = await supabase
      .from('subscription_status_breakdown')
      .select('*');

    if (statusError) {
      console.error('❌ Error getting status breakdown:', statusError);
      return;
    }

    // Get MRR summary
    const { data: officialMrrData, error: officialMrrError } = await supabase
      .from('official_mrr')
      .select('*');

    const { data: activeMrrData, error: activeMrrError } = await supabase
      .from('active_mrr')
      .select('*');

    if (officialMrrError || activeMrrError) {
      console.error('❌ Error getting MRR data:', officialMrrError || activeMrrError);
      return;
    }

    console.log(`\n📊 Migration Verification Results:
    - Total subscriptions: ${totalCount}
    - Official MRR (counted): $${officialMrrData[0]?.total_mrr || 0}
    - Active MRR (all): $${activeMrrData[0]?.total_mrr || 0}
    - Active subscriptions: ${activeMrrData[0]?.active_subscriptions || 0}
    `);

    console.log('\n📋 Status Breakdown:');
    statusBreakdown.forEach(status => {
      console.log(`  - ${status.subscription_status}: ${status.count} subscriptions ($${status.total_mrr} MRR)`);
    });

  } catch (error) {
    console.error('❌ Error during verification:', error.message);
  }
}

// Run the migration
if (require.main === module) {
  migrateAllSubscriptions()
    .then(() => {
      console.log('✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = {
  migrateAllSubscriptions,
  processSubscription,
  normalizeToMonthly
};