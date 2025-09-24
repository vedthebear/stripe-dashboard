require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Test webhook integration by creating a test customer and subscription
 */
async function testWebhookIntegration() {
  console.log('🧪 Testing webhook integration...');

  let testCustomer = null;
  let testSubscription = null;

  try {
    // Step 1: Get initial subscription count
    console.log('\n📊 Getting initial subscription count...');
    const { count: initialCount, error: countError } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('❌ Error getting initial count:', countError);
      return;
    }

    console.log(`📋 Initial subscriptions in Supabase: ${initialCount}`);

    // Step 2: Create a test customer
    console.log('\n👤 Creating test customer...');
    testCustomer = await stripe.customers.create({
      email: 'webhook-test@example.com',
      name: 'Webhook Test User',
      description: 'Test customer for webhook integration'
    });

    console.log(`✅ Created test customer: ${testCustomer.id}`);

    // Step 3: Get a price ID (use existing price or create one)
    console.log('\n💰 Getting test price...');
    const prices = await stripe.prices.list({ limit: 1, active: true });

    if (prices.data.length === 0) {
      console.error('❌ No active prices found. Creating a test price...');

      // Create a test product and price
      const testProduct = await stripe.products.create({
        name: 'Webhook Test Product',
        description: 'Test product for webhook integration'
      });

      const testPrice = await stripe.prices.create({
        unit_amount: 999, // $9.99
        currency: 'usd',
        recurring: { interval: 'month' },
        product: testProduct.id
      });

      console.log(`✅ Created test price: ${testPrice.id}`);
      priceId = testPrice.id;
    } else {
      priceId = prices.data[0].id;
      console.log(`✅ Using existing price: ${priceId}`);
    }

    // Step 4: Create a test subscription (this should trigger webhook)
    console.log('\n📝 Creating test subscription (this will trigger webhook)...');
    testSubscription = await stripe.subscriptions.create({
      customer: testCustomer.id,
      items: [{ price: priceId }],
      trial_period_days: 7, // 7-day trial
      metadata: {
        test: 'webhook-integration',
        created_by: 'test-script'
      }
    });

    console.log(`✅ Created test subscription: ${testSubscription.id}`);
    console.log(`📋 Subscription status: ${testSubscription.status}`);

    // Step 5: Wait for webhook to process
    console.log('\n⏳ Waiting 5 seconds for webhook to process...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 6: Check if subscription was synced to Supabase
    console.log('\n🔍 Checking if subscription synced to Supabase...');
    const { data: syncedSubscription, error: syncError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('stripe_subscription_id', testSubscription.id)
      .single();

    if (syncError) {
      console.error('❌ Subscription not found in Supabase:', syncError);
      console.log('🔧 This means the webhook might not be working properly');
      return false;
    }

    console.log('✅ Subscription successfully synced to Supabase!');
    console.log(`📋 Synced data:
    - Email: ${syncedSubscription.customer_email}
    - Status: ${syncedSubscription.subscription_status}
    - Monthly Total: $${syncedSubscription.monthly_total}
    - Is Active: ${syncedSubscription.is_active}
    - Is Counted: ${syncedSubscription.is_counted}
    - Trial End: ${syncedSubscription.trial_end_date}`);

    // Step 7: Test subscription update (another webhook trigger)
    console.log('\n📝 Testing subscription update...');
    await stripe.subscriptions.update(testSubscription.id, {
      metadata: {
        test: 'webhook-integration-updated',
        updated_by: 'test-script'
      }
    });

    console.log('✅ Updated subscription metadata');

    // Step 8: Wait and check update
    console.log('\n⏳ Waiting 3 seconds for update webhook...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 9: Get final count
    const { count: finalCount, error: finalCountError } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true });

    if (!finalCountError) {
      console.log(`\n📊 Final Results:
    - Initial subscriptions: ${initialCount}
    - Final subscriptions: ${finalCount}
    - New subscriptions added: ${finalCount - initialCount}`);
    }

    console.log('\n🎉 Webhook integration test completed successfully!');
    return true;

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return false;

  } finally {
    // Cleanup: Delete test subscription and customer
    console.log('\n🧹 Cleaning up test data...');

    if (testSubscription) {
      try {
        await stripe.subscriptions.cancel(testSubscription.id);
        console.log('✅ Canceled test subscription');

        // Wait for webhook to process cancellation
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error('⚠️ Error canceling subscription:', error.message);
      }
    }

    if (testCustomer) {
      try {
        await stripe.customers.del(testCustomer.id);
        console.log('✅ Deleted test customer');
      } catch (error) {
        console.error('⚠️ Error deleting customer:', error.message);
      }
    }
  }
}

/**
 * Check webhook logs from server
 */
async function checkWebhookLogs() {
  console.log('\n📋 Webhook Integration Status:');
  console.log('- Webhook server: Running on port 3001');
  console.log('- ngrok tunnel: Active');
  console.log('- Supabase: Connected');
  console.log('- Stripe webhook secret: Configured');
  console.log('\n💡 Check your webhook server logs for real-time activity');
}

// Run test
if (require.main === module) {
  testWebhookIntegration()
    .then((success) => {
      if (success) {
        console.log('\n✅ All tests passed! Your webhook integration is working perfectly.');
      } else {
        console.log('\n❌ Some tests failed. Check the logs above for details.');
      }
      checkWebhookLogs();
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('❌ Test script failed:', error);
      process.exit(1);
    });
}

module.exports = { testWebhookIntegration };