const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');
const CustomerDatabase = require('./database');
const { createClient } = require('@supabase/supabase-js');
const hardcodedSubscriptions = require('../config/hardcodedSubscriptions');
require('dotenv').config();

// Environment validation function
function validateEnvironment() {
  const requiredEnvVars = ['STRIPE_SECRET_KEY'];
  const missingVars = [];

  console.log('🔍 Validating environment configuration...');

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missingVars.push(envVar);
    }
  }

  // Check if Stripe secret key looks valid
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey && !stripeKey.startsWith('sk_')) {
    console.error('❌ STRIPE_SECRET_KEY must start with "sk_"');
    missingVars.push('STRIPE_SECRET_KEY (invalid format)');
  }

  if (stripeKey && stripeKey.includes('dummy')) {
    console.error('❌ STRIPE_SECRET_KEY appears to be a dummy/placeholder value');
    console.error('   Please set a real Stripe API key from your Stripe dashboard');
    missingVars.push('STRIPE_SECRET_KEY (dummy value)');
  }

  if (missingVars.length > 0) {
    console.error('❌ Environment validation failed!');
    console.error('Missing or invalid environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('\n💡 To fix this:');
    console.error('   1. Copy .env.example to .env');
    console.error('   2. Add your real Stripe API keys from https://dashboard.stripe.com/apikeys');
    console.error('   3. Restart the server\n');
    return false;
  }

  console.log('✅ Environment validation passed');
  return true;
}

// Validate environment before starting
if (!validateEnvironment()) {
  console.error('🚫 Server startup aborted due to configuration issues');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const io = socketIo(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

// Initialize Stripe with error handling
let stripe;
try {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  console.log('✅ Stripe client initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize Stripe client:', error.message);
  process.exit(1);
}

// Initialize Supabase client
let supabase;
if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
  try {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    console.log('✅ Supabase client initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Supabase client:', error.message);
  }
} else {
  console.log('⚠️ Supabase credentials not found - Supabase analytics will be unavailable');
}

const PORT = process.env.PORT || 5050;

// Initialize customer database
const customerDB = new CustomerDatabase();

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

// Store connected clients
let connectedClients = [];

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id} (${socket.conn.remoteAddress})`);
  console.log(`👥 Total clients: ${connectedClients.length + 1}`);
  connectedClients.push(socket);

  // Send initial connection acknowledgment
  socket.emit('connection_acknowledged', {
    message: 'Connected to Stripe Dashboard',
    timestamp: new Date().toISOString(),
    clientId: socket.id
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔌 Client disconnected: ${socket.id} (reason: ${reason})`);
    connectedClients = connectedClients.filter(client => client.id !== socket.id);
    console.log(`👥 Total clients: ${connectedClients.length}`);
  });

  socket.on('error', (error) => {
    console.error(`❌ Socket error for client ${socket.id}:`, error.message);
  });
});

// Determine customer payment status
async function getCustomerPaymentStatus(customer) {
  try {
    // Get customer's subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      limit: 10
    });

    // Get customer's payment methods
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customer.id,
      type: 'card'
    });

    // Get recent charges for this customer
    const charges = await stripe.charges.list({
      customer: customer.id,
      limit: 5
    });

    const hasPaymentMethod = paymentMethods.data.length > 0;
    const hasSuccessfulCharge = charges.data.some(charge => charge.status === 'succeeded');
    const activeSubscription = subscriptions.data.find(sub =>
      sub.status === 'active' || sub.status === 'trialing'
    );

    // Determine payment status
    if (activeSubscription && activeSubscription.status === 'active' && hasSuccessfulCharge) {
      return {
        status: 'paying',
        category: 'Paying Customer',
        description: 'Active subscription with successful charges',
        subscription_status: activeSubscription.status,
        has_payment_method: hasPaymentMethod,
        has_successful_charge: hasSuccessfulCharge,
        last_charge: charges.data[0] ? {
          amount: charges.data[0].amount / 100,
          created: new Date(charges.data[0].created * 1000),
          status: charges.data[0].status
        } : null
      };
    } else if (activeSubscription && activeSubscription.status === 'trialing') {
      return {
        status: 'trial',
        category: 'Trial Customer',
        description: 'In trial period, may or may not have payment method',
        subscription_status: activeSubscription.status,
        has_payment_method: hasPaymentMethod,
        has_successful_charge: hasSuccessfulCharge,
        trial_end: activeSubscription.trial_end ? new Date(activeSubscription.trial_end * 1000) : null
      };
    } else if (hasPaymentMethod && !activeSubscription) {
      return {
        status: 'payment_method_only',
        category: 'Payment Method Added',
        description: 'Has payment method but no active subscription',
        subscription_status: null,
        has_payment_method: hasPaymentMethod,
        has_successful_charge: hasSuccessfulCharge
      };
    } else {
      return {
        status: 'signup_only',
        category: 'Signup Only',
        description: 'Customer created but no payment method or subscription',
        subscription_status: null,
        has_payment_method: hasPaymentMethod,
        has_successful_charge: hasSuccessfulCharge
      };
    }
  } catch (error) {
    console.warn(`⚠️ Error getting payment status for customer ${customer.id}:`, error.message);
    return {
      status: 'unknown',
      category: 'Unknown',
      description: 'Could not determine payment status',
      subscription_status: null,
      has_payment_method: false,
      has_successful_charge: false,
      error: error.message
    };
  }
}

// Enhanced customer validation with database integration
async function isValidCustomer(customer) {
  if (!customer.email) return false;

  // Check database first for manual overrides
  try {
    const dbStatus = await customerDB.getCustomerStatus(customer.id);
    if (dbStatus) {
      return dbStatus.status === 'included';
    }
  } catch (error) {
    console.warn(`⚠️ Database check failed for customer ${customer.id}:`, error.message);
  }

  // Fallback to automatic filtering
  const email = customer.email.toLowerCase();
  const testPatterns = [
    'test@',
    'testing@',
    '@example.',
    '@test.',
    '+test',
    'usebear.ai'
  ];

  // Auto-exclude if email matches any test pattern
  const isValid = !testPatterns.some(pattern => email.includes(pattern));

  // Auto-populate database with the decision
  try {
    const status = isValid ? 'included' : 'auto_excluded';
    const reason = isValid ? null : 'Matches test pattern';
    await customerDB.setCustomerStatus(customer.id, customer.email, customer.name, status, reason, 'auto_filter');
  } catch (error) {
    console.warn(`⚠️ Failed to save customer status for ${customer.email}:`, error.message);
  }

  return isValid;
}

// Calculate churn rate based on canceled subscriptions
async function calculateChurnRate() {
  try {
    console.log('📊 Calculating churn rate...');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    console.log('🔍 Fetching subscription data from Stripe...');
    const [activeSubscriptions, canceledSubscriptions] = await Promise.all([
      stripe.subscriptions.list({
        status: 'active',
        limit: 100
      }),
      stripe.subscriptions.list({
        status: 'canceled',
        created: { gte: Math.floor(thirtyDaysAgo.getTime() / 1000) },
        limit: 100
      })
    ]);

    console.log(`📋 Found ${activeSubscriptions.data.length} active subscriptions`);
    console.log(`📋 Found ${canceledSubscriptions.data.length} canceled subscriptions`);

    // Filter out test accounts
    const validActiveSubscriptions = [];
    const validCanceledSubscriptions = [];

    for (const sub of activeSubscriptions.data) {
      if (sub.customer) {
        try {
          const customer = await stripe.customers.retrieve(sub.customer);
          if (await isValidCustomer(customer)) {
            validActiveSubscriptions.push(sub);
          }
        } catch (error) {
          console.warn(`⚠️ Failed to retrieve customer ${sub.customer}:`, error.message);
        }
      }
    }

    for (const sub of canceledSubscriptions.data) {
      if (sub.customer) {
        try {
          const customer = await stripe.customers.retrieve(sub.customer);
          if (await isValidCustomer(customer)) {
            validCanceledSubscriptions.push(sub);
          }
        } catch (error) {
          console.warn(`⚠️ Failed to retrieve customer ${sub.customer}:`, error.message);
        }
      }
    }

    const totalCustomers = validActiveSubscriptions.length + validCanceledSubscriptions.length;
    const churnRate = totalCustomers > 0 ? (validCanceledSubscriptions.length / totalCustomers) * 100 : 0;

    console.log(`📈 Calculated churn rate: ${churnRate.toFixed(2)}% (${validCanceledSubscriptions.length}/${totalCustomers})`);
    return churnRate;
  } catch (error) {
    console.error('❌ Error calculating churn rate:', error.message);
    if (error.type === 'StripeInvalidRequestError') {
      console.error('   This might be due to invalid API keys or insufficient permissions');
    }
    return 0;
  }
}

// Fetch dashboard data
async function fetchDashboardData() {
  try {
    console.log('🚀 Starting dashboard data fetch...');
    const fetchStartTime = Date.now();

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    console.log(`📅 Fetching data for periods:
    - Today: ${startOfDay.toISOString()}
    - Week: ${startOfWeek.toISOString()}
    - Month: ${startOfMonth.toISOString()}`);

    // Fetch all data in parallel with individual error handling
    console.log('🔄 Making parallel API calls to Stripe...');
    const [
      todayPayments,
      weekPayments,
      monthPayments,
      customers,
      charges,
      subscriptions
    ] = await Promise.allSettled([
      stripe.paymentIntents.list({
        created: { gte: Math.floor(startOfDay.getTime() / 1000) },
        limit: 100
      }),
      stripe.paymentIntents.list({
        created: { gte: Math.floor(startOfWeek.getTime() / 1000) },
        limit: 100
      }),
      stripe.paymentIntents.list({
        created: { gte: Math.floor(startOfMonth.getTime() / 1000) },
        limit: 100
      }),
      stripe.customers.list({ limit: 100 }),
      stripe.charges.list({ limit: 10 }),
      stripe.subscriptions.list({
        status: 'all',
        limit: 100
      })
    ]);

    // Check for any failed API calls
    const apiResults = [
      { name: 'todayPayments', result: todayPayments },
      { name: 'weekPayments', result: weekPayments },
      { name: 'monthPayments', result: monthPayments },
      { name: 'customers', result: customers },
      { name: 'charges', result: charges },
      { name: 'subscriptions', result: subscriptions }
    ];

    const failedAPIs = apiResults.filter(api => api.result.status === 'rejected');
    if (failedAPIs.length > 0) {
      console.error('❌ Some API calls failed:');
      failedAPIs.forEach(api => {
        console.error(`   - ${api.name}: ${api.result.reason.message}`);
      });
    }

    // Extract successful results with fallbacks
    const safeExtract = (result, fallback = { data: [] }) =>
      result.status === 'fulfilled' ? result.value : fallback;

    const todayPaymentsData = safeExtract(todayPayments);
    const weekPaymentsData = safeExtract(weekPayments);
    const monthPaymentsData = safeExtract(monthPayments);
    const customersData = safeExtract(customers);
    const chargesData = safeExtract(charges);
    const subscriptionsData = safeExtract(subscriptions);

    console.log(`📊 API Results:
    - Today's payments: ${todayPaymentsData.data.length}
    - Week's payments: ${weekPaymentsData.data.length}
    - Month's payments: ${monthPaymentsData.data.length}
    - Customers: ${customersData.data.length}
    - Recent charges: ${chargesData.data.length}
    - Subscriptions: ${subscriptionsData.data.length}`);

    // Filter valid customers (now async)
    console.log('🔍 Filtering valid customers...');
    const validCustomers = [];
    for (const customer of customersData.data) {
      if (await isValidCustomer(customer)) {
        validCustomers.push(customer);
      }
    }
    console.log(`✅ Found ${validCustomers.length} valid customers (filtered from ${customersData.data.length})`);

    // Calculate MRR metrics - Include ALL active subscriptions
    console.log('💰 Calculating MRR metrics for ALL active subscriptions...');
    let totalMRR = 0;
    let trialMRR = 0;
    let activeSubscriptions = 0;
    let trialSubscriptions = 0;
    let pastDueSubscriptions = 0;
    let pastDueMRR = 0;

    // Create a map for customer details for efficiency
    const customerMap = new Map();
    for (const customer of customersData.data) {
      customerMap.set(customer.id, customer);
    }

    for (const subscription of subscriptionsData.data) {
      // Include active, trialing, and past_due subscriptions in MRR
      if (subscription.status === 'active' || subscription.status === 'trialing' || subscription.status === 'past_due') {
        const monthlyAmount = subscription.items.data.reduce((sum, item) => {
          const price = item.price;
          let monthlyPrice = 0;

          if (price.recurring) {
            if (price.recurring.interval === 'month') {
              monthlyPrice = price.unit_amount / 100;
            } else if (price.recurring.interval === 'year') {
              monthlyPrice = (price.unit_amount / 100) / 12;
            } else if (price.recurring.interval === 'week') {
              monthlyPrice = (price.unit_amount / 100) * 4.33; // Average weeks per month
            }
          }

          return sum + (monthlyPrice * item.quantity);
        }, 0);

        if (subscription.status === 'trialing') {
          trialMRR += monthlyAmount;
          trialSubscriptions++;
        } else if (subscription.status === 'past_due') {
          pastDueMRR += monthlyAmount;
          pastDueSubscriptions++;
        } else {
          totalMRR += monthlyAmount;
          activeSubscriptions++;
        }
      }
    }

    const actualTotalMRR = totalMRR + pastDueMRR + trialMRR;
    console.log(`💰 MRR Calculated:
    - Active MRR: $${totalMRR.toFixed(2)} (${activeSubscriptions} active subs)
    - Past Due MRR: $${pastDueMRR.toFixed(2)} (${pastDueSubscriptions} past due subs)
    - Trial MRR: $${trialMRR.toFixed(2)} (${trialSubscriptions} trial subs)
    - TOTAL MRR: $${actualTotalMRR.toFixed(2)} (${activeSubscriptions + pastDueSubscriptions + trialSubscriptions} total subs)`);

    // Calculate churn rate
    const churnRate = await calculateChurnRate();

    // Calculate standard metrics
    console.log('💸 Calculating revenue metrics...');
    const todayRevenue = todayPaymentsData.data
      .filter(p => p.status === 'succeeded')
      .reduce((sum, p) => sum + p.amount, 0) / 100;

    const weekRevenue = weekPaymentsData.data
      .filter(p => p.status === 'succeeded')
      .reduce((sum, p) => sum + p.amount, 0) / 100;

    const monthRevenue = monthPaymentsData.data
      .filter(p => p.status === 'succeeded')
      .reduce((sum, p) => sum + p.amount, 0) / 100;

    // Track unique customers generating revenue
    const revenueGeneratingCustomers = new Set();
    monthPaymentsData.data
      .filter(p => p.status === 'succeeded')
      .forEach(p => {
        if (p.customer) revenueGeneratingCustomers.add(p.customer);
      });

    console.log(`💰 Revenue Summary:
    - Today: $${todayRevenue.toFixed(2)}
    - Week: $${weekRevenue.toFixed(2)}
    - Month: $${monthRevenue.toFixed(2)}
    - Unique paying customers this month: ${revenueGeneratingCustomers.size}`);

    console.log('🎯 REACHED PAYMENT STATUS SECTION');
    // Calculate payment status segmentation for dashboard using subscription data
    console.log('🔍 Analyzing customer payment status for dashboard...');

    let paymentStatusCounts = { paying: 0, trial: 0, payment_method_only: 0, signup_only: 0 };

    try {
      console.log(`📋 Starting analysis for ${validCustomers.length} valid customers`);
      console.log(`📊 Total subscriptions to process: ${subscriptionsData.data.length}`);

      // Map customers to their subscriptions for efficient lookup
      const customerSubscriptionMap = new Map();
      const subscriptionStatusCount = {};

      for (const subscription of subscriptionsData.data) {
        // subscription.customer might be a string ID or an object
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id;

        if (customerId && !customerSubscriptionMap.has(customerId)) {
          customerSubscriptionMap.set(customerId, []);
        }
        if (customerId) {
          customerSubscriptionMap.get(customerId).push(subscription);
        }

        // Track subscription status distribution for debugging
        subscriptionStatusCount[subscription.status] = (subscriptionStatusCount[subscription.status] || 0) + 1;
      }

      console.log(`🔍 Subscription Status Distribution:`, JSON.stringify(subscriptionStatusCount));
      console.log(`🔗 Mapped ${customerSubscriptionMap.size} customers to subscriptions`);

      // Debug: Check how many unique customers have active/past_due subscriptions
      let uniquePayingCustomers = 0;
      let uniqueTrialCustomers = 0;
      const activeCustomerIds = [];
      for (const [customerId, subs] of customerSubscriptionMap) {
        const hasActive = subs.some(s => s.status === 'active' || s.status === 'past_due');
        const hasTrialOnly = !hasActive && subs.some(s => s.status === 'trialing');
        if (hasActive) {
          uniquePayingCustomers++;
          activeCustomerIds.push(customerId);
        }
        if (hasTrialOnly) uniqueTrialCustomers++;
      }
      console.log(`🎯 Unique customers with active/past_due subs: ${uniquePayingCustomers}`);
      console.log(`🎯 Unique customers with trial-only subs: ${uniqueTrialCustomers}`);

      // Debug: Check if active customers are in validCustomers list
      const validCustomerIds = new Set(validCustomers.map(c => c.id));
      const activeInValid = activeCustomerIds.filter(id => validCustomerIds.has(id));
      console.log(`🔍 Active customers in valid list: ${activeInValid.length}/${activeCustomerIds.length}`);

      // Categorize ALL customers with subscriptions (matching MRR calculation logic)
      // Count customers from the subscription map, not just validCustomers
      let payingCount = 0;
      let trialCount = 0;

      for (const [customerId, subs] of customerSubscriptionMap) {
        const hasActive = subs.some(s => s.status === 'active' || s.status === 'past_due');
        const hasTrialing = subs.some(s => s.status === 'trialing');

        if (hasActive) {
          payingCount++;
        } else if (hasTrialing) {
          trialCount++;
        }
      }

      // For customers without subscriptions, check payment methods
      let paymentMethodOnly = 0;
      let signupOnly = 0;

      for (const customer of validCustomers) {
        const customerSubs = customerSubscriptionMap.get(customer.id) || [];

        if (customerSubs.length === 0) {
          // No subscriptions - check payment method
          if (customer.invoice_settings?.default_payment_method || customer.default_source) {
            paymentMethodOnly++;
          } else {
            signupOnly++;
          }
        }
      }

      paymentStatusCounts.paying = payingCount;
      paymentStatusCounts.trial = trialCount;
      paymentStatusCounts.payment_method_only = paymentMethodOnly;
      paymentStatusCounts.signup_only = signupOnly;

      console.log(`👥 Customer Payment Segmentation:
      - Paying: ${paymentStatusCounts.paying}
      - Trial: ${paymentStatusCounts.trial}
      - Payment Method Only: ${paymentStatusCounts.payment_method_only}
      - Signup Only: ${paymentStatusCounts.signup_only}`);

    } catch (error) {
      console.error('❌ Error calculating payment status:', error);
      console.error('Stack trace:', error.stack);
    }

    // Calculate monthly spending by customer
    console.log('💸 Calculating monthly customer spending...');
    const customerSpending = new Map();
    const customerStatus = new Map();

    // Aggregate spending from month's payments
    for (const payment of monthPaymentsData.data) {
      if (payment.status === 'succeeded' && payment.customer) {
        const amount = payment.amount / 100;
        if (!customerSpending.has(payment.customer)) {
          customerSpending.set(payment.customer, {
            total: 0,
            transactions: 0,
            last_payment: payment.created
          });
        }
        const spending = customerSpending.get(payment.customer);
        spending.total += amount;
        spending.transactions++;
        if (payment.created > spending.last_payment) {
          spending.last_payment = payment.created;
        }
      }
    }

    // Build customer status map with detailed information
    for (const subscription of subscriptionsData.data) {
      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

      if (customerId) {
        const customer = customerMap.get(customerId);
        const status = {
          subscription_status: subscription.status,
          plan: subscription.items.data[0]?.price?.nickname || 'Unknown Plan',
          amount: subscription.items.data.reduce((sum, item) => {
            return sum + ((item.price.unit_amount / 100) * item.quantity);
          }, 0),
          interval: subscription.items.data[0]?.price?.recurring?.interval || 'month',
          trial_end: subscription.trial_end,
          current_period_end: subscription.current_period_end,
          customer_name: customer?.name || customer?.email || customerId,
          customer_email: customer?.email,
          created: subscription.created
        };

        // Prioritize active/past_due over trial
        if (!customerStatus.has(customerId) ||
            (customerStatus.get(customerId).subscription_status === 'trialing' &&
             (subscription.status === 'active' || subscription.status === 'past_due'))) {
          customerStatus.set(customerId, status);
        }
      }
    }

    // Convert maps to arrays for dashboard
    const topSpenders = Array.from(customerSpending.entries())
      .map(([customerId, spending]) => {
        const customer = customerMap.get(customerId);
        return {
          customer_id: customerId,
          customer_name: customer?.name || customer?.email || customerId,
          customer_email: customer?.email,
          ...spending
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 20); // Top 20 spenders

    const customerStatusList = Array.from(customerStatus.entries())
      .map(([customerId, status]) => ({
        customer_id: customerId,
        ...status
      }))
      .sort((a, b) => {
        // Sort by status priority: active > past_due > trialing > others
        const statusPriority = { 'active': 1, 'past_due': 2, 'trialing': 3 };
        return (statusPriority[a.subscription_status] || 4) - (statusPriority[b.subscription_status] || 4);
      });

    console.log(`📊 Analyzed spending for ${customerSpending.size} customers`);
    console.log(`📊 Customer status tracked for ${customerStatus.size} customers`);

    const dashboardData = {
      revenue: {
        today: todayRevenue,
        week: weekRevenue,
        month: monthRevenue
      },
      mrr: {
        active: totalMRR,
        past_due: pastDueMRR,
        trial: trialMRR,
        total: actualTotalMRR,
        active_subscriptions: activeSubscriptions,
        past_due_subscriptions: pastDueSubscriptions,
        trial_subscriptions: trialSubscriptions,
        total_subscriptions: activeSubscriptions + pastDueSubscriptions + trialSubscriptions
      },
      churn: {
        rate: churnRate
      },
      transactions: {
        today: todayPaymentsData.data.filter(p => p.status === 'succeeded').length,
        week: weekPaymentsData.data.filter(p => p.status === 'succeeded').length,
        month: monthPaymentsData.data.filter(p => p.status === 'succeeded').length
      },
      customers: {
        total: validCustomers.length,
        new_today: validCustomers.filter(c =>
          new Date(c.created * 1000) >= startOfDay
        ).length
      },
      payment_segmentation: paymentStatusCounts,
      recent_charges: await Promise.all(chargesData.data.map(async charge => {
        let customerName = 'Unknown Customer';
        let customerEmail = null;

        if (charge.customer) {
          const customer = customerMap.get(charge.customer);
          if (customer) {
            customerName = customer.name || customer.email || charge.customer;
            customerEmail = customer.email;
          } else {
            // Try to fetch if not in map
            try {
              const fetchedCustomer = await stripe.customers.retrieve(charge.customer);
              customerName = fetchedCustomer.name || fetchedCustomer.email || charge.customer;
              customerEmail = fetchedCustomer.email;
            } catch (e) {
              // Keep default
            }
          }
        }

        return {
          id: charge.id,
          amount: charge.amount / 100,
          currency: charge.currency,
          status: charge.status,
          created: charge.created,
          customer: charge.customer,
          customer_name: customerName,
          customer_email: customerEmail,
          description: charge.description,
          payment_method: charge.payment_method_details?.type || 'card',
          created_formatted: new Date(charge.created * 1000).toLocaleString()
        };
      })),
      top_spenders: topSpenders,
      customer_status: customerStatusList,
      timestamp: new Date().toISOString()
    };

    const fetchEndTime = Date.now();
    console.log(`✅ Dashboard data fetch completed in ${fetchEndTime - fetchStartTime}ms`);
    console.log(`📊 Final metrics: ${dashboardData.transactions.today} transactions today, ${dashboardData.customers.total} customers, $${dashboardData.revenue.today} revenue`);

    return dashboardData;
  } catch (error) {
    console.error('❌ Critical error fetching Stripe data:', error.message);
    if (error.type === 'StripeAuthenticationError') {
      console.error('   Authentication failed - check your Stripe API keys');
    } else if (error.type === 'StripePermissionError') {
      console.error('   Permission denied - ensure your API key has the required permissions');
    } else if (error.type === 'StripeRateLimitError') {
      console.error('   Rate limit exceeded - please wait before making more requests');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.error('   Network connection failed - check your internet connection');
    }
    console.error('   Stack trace:', error.stack);
    return null;
  }
}

// API Routes
app.get('/api/dashboard', async (req, res) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`📊 [${requestId}] Dashboard API request from ${req.ip}`);

  try {
    const data = await fetchDashboardData();
    if (data) {
      console.log(`✅ [${requestId}] Dashboard data sent successfully`);
      res.json(data);
    } else {
      console.error(`❌ [${requestId}] Dashboard data fetch returned null`);
      res.status(500).json({
        error: 'Failed to fetch dashboard data',
        requestId,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`❌ [${requestId}] Dashboard API error:`, error.message);
    res.status(500).json({
      error: 'Internal server error',
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// Supabase Analytics API endpoint
app.get('/api/supabase/analytics', async (req, res) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`📊 [${requestId}] Supabase Analytics API request from ${req.ip}`);

  try {
    if (!supabase) {
      return res.status(500).json({
        error: 'Supabase not configured',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    // Fetch official MRR data
    const { data: officialMrrData, error: mrrError } = await supabase
      .from('official_mrr')
      .select('*');

    if (mrrError) {
      console.error(`❌ [${requestId}] Error fetching official MRR:`, mrrError);
      throw mrrError;
    }

    // Fetch trial pipeline data
    const { data: trialData, error: trialError } = await supabase
      .from('trial_pipeline')
      .select('*');

    if (trialError) {
      console.error(`❌ [${requestId}] Error fetching trial data:`, trialError);
      throw trialError;
    }

    // Fetch paying subscriptions (counted subscriptions)
    const { data: payingSubscriptions, error: payingError } = await supabase
      .from('subscriptions')
      .select('customer_email, customer_name, subscription_status, monthly_total, date_created, stripe_subscription_id')
      .eq('is_counted', true)
      .eq('is_active', true)
      .order('monthly_total', { ascending: false });

    if (payingError) {
      console.error(`❌ [${requestId}] Error fetching paying subscriptions:`, payingError);
      throw payingError;
    }

    // Fetch trial subscriptions (only counted trials)
    const { data: trialSubscriptions, error: trialSubsError } = await supabase
      .from('subscriptions')
      .select('customer_email, customer_name, monthly_total, trial_end_date, date_created, stripe_subscription_id, is_trial_counted')
      .eq('subscription_status', 'trialing')
      .eq('is_active', true)
      .eq('is_trial_counted', true)
      .order('trial_end_date', { ascending: true });

    if (trialSubsError) {
      console.error(`❌ [${requestId}] Error fetching trial subscriptions:`, trialSubsError);
      throw trialSubsError;
    }

    // Combine Stripe data with hard-coded customers from config
    const allPayingSubscriptions = [...payingSubscriptions.map(sub => ({
      ...sub,
      monthly_total: parseFloat(sub.monthly_total),
      created_formatted: new Date(sub.date_created).toLocaleDateString(),
      customer_display: sub.customer_name || sub.customer_email || 'Unknown'
    })), ...hardcodedSubscriptions];

    // Calculate additional metrics including hard-coded customers
    const totalSubscriptions = allPayingSubscriptions.length + trialSubscriptions.length;
    const totalMrrWithHardCoded = allPayingSubscriptions.reduce((sum, sub) => sum + sub.monthly_total, 0);
    const averagePayingAmount = allPayingSubscriptions.length > 0
      ? totalMrrWithHardCoded / allPayingSubscriptions.length
      : 0;

    // Format trial subscriptions with time remaining
    const formattedTrials = trialSubscriptions.map(trial => {
      const trialEndDate = new Date(trial.trial_end_date);
      const now = new Date();
      const daysRemaining = Math.ceil((trialEndDate - now) / (1000 * 60 * 60 * 24));

      return {
        ...trial,
        days_remaining: daysRemaining,
        trial_end_formatted: trialEndDate.toLocaleDateString(),
        is_expired: daysRemaining <= 0
      };
    });

    // Calculate trial pipeline metrics from filtered trial subscriptions
    const activeTrials = formattedTrials.filter(trial => !trial.is_expired);
    const expiredTrials = formattedTrials.filter(trial => trial.is_expired);
    const potentialMrr = activeTrials.reduce((sum, trial) => sum + parseFloat(trial.monthly_total), 0);

    const analyticsData = {
      official_mrr: {
        total: totalMrrWithHardCoded,
        subscriptions_count: allPayingSubscriptions.length,
        average_per_customer: averagePayingAmount
      },
      trial_pipeline: {
        total_customers: trialSubscriptions.length,
        potential_mrr: potentialMrr,
        active_trials: activeTrials.length,
        expired_trials: expiredTrials.length,
        counted_trial_mrr: potentialMrr
      },
      paying_subscriptions: allPayingSubscriptions.sort((a, b) => b.monthly_total - a.monthly_total),
      trial_subscriptions: formattedTrials.map(trial => ({
        ...trial,
        monthly_total: parseFloat(trial.monthly_total),
        created_formatted: new Date(trial.date_created).toLocaleDateString(),
        customer_display: trial.customer_name || trial.customer_email || 'Unknown'
      })),
      summary: {
        total_active_subscriptions: totalSubscriptions,
        official_mrr_total: totalMrrWithHardCoded,
        trial_potential: potentialMrr,
        conversion_opportunity: potentialMrr + totalMrrWithHardCoded
      },
      timestamp: new Date().toISOString()
    };

    console.log(`✅ [${requestId}] Supabase analytics data sent successfully`);
    res.json(analyticsData);

  } catch (error) {
    console.error(`❌ [${requestId}] Supabase analytics API error:`, error.message);
    res.status(500).json({
      error: 'Failed to fetch Supabase analytics data',
      details: error.message,
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// Weekly retention endpoint
app.get('/api/retention/weekly', async (req, res) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`📊 [${requestId}] Weekly retention API request`);

  try {
    if (!supabase) {
      return res.status(500).json({
        error: 'Supabase not configured',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    // Calculate specific dates for WoW retention (day-to-day comparison)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];

    console.log(`📈 [${requestId}] Calculating WoW retention (day-to-day):`);
    console.log(`   Today: ${todayStr}`);
    console.log(`   Week ago: ${weekAgoStr}`);

    // Get paying customers from today's snapshot
    const { data: todayCustomers, error: todayError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status')
      .eq('date', todayStr)
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing'); // Exclude trials

    if (todayError) {
      console.error(`❌ [${requestId}] Error fetching today's customers:`, todayError);
      throw todayError;
    }

    // Get paying customers from week ago snapshot
    const { data: weekAgoCustomers, error: weekAgoError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status')
      .eq('date', weekAgoStr)
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing'); // Exclude trials

    if (weekAgoError) {
      console.error(`❌ [${requestId}] Error fetching week ago customers:`, weekAgoError);
      throw weekAgoError;
    }

    // Convert to sets for easier comparison
    const todayCustomerIds = new Set(todayCustomers.map(c => c.stripe_customer_id));
    const weekAgoCustomerIds = new Set(weekAgoCustomers.map(c => c.stripe_customer_id));

    // Calculate retention metrics
    const retainedCustomerIds = [...weekAgoCustomerIds].filter(id => todayCustomerIds.has(id));
    const churnedCustomerIds = [...weekAgoCustomerIds].filter(id => !todayCustomerIds.has(id));
    const newCustomerIds = [...todayCustomerIds].filter(id => !weekAgoCustomerIds.has(id));

    const weekAgoCount = weekAgoCustomerIds.size;
    const todayCount = todayCustomerIds.size;
    const retainedCount = retainedCustomerIds.length;
    const churnedCount = churnedCustomerIds.length;
    const newCount = newCustomerIds.length;

    const retentionRate = weekAgoCount > 0 ? (retainedCount / weekAgoCount) * 100 : 0;

    // Create maps for easy lookup
    const weekAgoCustomerMap = new Map();
    weekAgoCustomers.forEach(c => weekAgoCustomerMap.set(c.stripe_customer_id, c));

    // Get detailed information about churned customers
    const churnedCustomersDetails = churnedCustomerIds.map(id => {
      const customer = weekAgoCustomerMap.get(id);
      return {
        stripe_customer_id: customer.stripe_customer_id,
        customer_email: customer.customer_email,
        customer_name: customer.customer_name,
        monthly_value: parseFloat(customer.monthly_value),
        previous_status: customer.subscription_status,
        churn_period: 'this_week'
      };
    });

    // Calculate churn value impact
    const churnedMRR = churnedCustomersDetails.reduce((sum, customer) =>
      sum + customer.monthly_value, 0
    );

    const responseData = {
      period: 'weekly',
      retention_rate: Math.round(retentionRate * 100) / 100, // Round to 2 decimal places
      metrics: {
        previous_period_customers: weekAgoCount,
        current_period_customers: todayCount,
        retained_customers: retainedCount,
        churned_customers: churnedCount,
        new_customers: newCount,
        churned_mrr: Math.round(churnedMRR * 100) / 100
      },
      period_labels: {
        previous: weekAgoStr,
        current: todayStr
      },
      churn_details: churnedCustomersDetails.sort((a, b) => b.monthly_value - a.monthly_value), // Sort by value desc
      requestId,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ [${requestId}] Weekly retention calculated: ${retentionRate.toFixed(2)}% retention rate`);
    console.log(`   Week ago (${weekAgoStr}): ${weekAgoCount} customers, Today (${todayStr}): ${todayCount} customers`);
    console.log(`   Retained: ${retainedCount}, Churned: ${churnedCount}, New: ${newCount}`);

    res.json(responseData);

  } catch (error) {
    console.error(`❌ [${requestId}] Weekly retention API error:`, error.message);
    res.status(500).json({
      error: 'Failed to calculate weekly retention',
      details: error.message,
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// Monthly retention endpoint
app.get('/api/retention/monthly', async (req, res) => {
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

    // Calculate specific dates for MoM retention (day-to-day comparison)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const monthAgo = new Date(today);
    monthAgo.setDate(today.getDate() - 30); // 30 days ago
    const monthAgoStr = monthAgo.toISOString().split('T')[0];

    console.log(`📈 [${requestId}] Calculating MoM retention (day-to-day):`);
    console.log(`   Today: ${todayStr}`);
    console.log(`   Month ago: ${monthAgoStr}`);

    // Get paying customers from today's snapshot
    const { data: todayCustomers, error: todayError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status')
      .eq('date', todayStr)
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing'); // Exclude trials

    if (todayError) {
      console.error(`❌ [${requestId}] Error fetching today's customers:`, todayError);
      throw todayError;
    }

    // Get paying customers from month ago snapshot
    const { data: monthAgoCustomers, error: monthAgoError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status')
      .eq('date', monthAgoStr)
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing'); // Exclude trials

    if (monthAgoError) {
      console.error(`❌ [${requestId}] Error fetching month ago customers:`, monthAgoError);
      throw monthAgoError;
    }

    // Convert to sets for easier comparison
    const todayCustomerIds = new Set(todayCustomers.map(c => c.stripe_customer_id));
    const monthAgoCustomerIds = new Set(monthAgoCustomers.map(c => c.stripe_customer_id));

    // Calculate retention metrics
    const retainedCustomerIds = [...monthAgoCustomerIds].filter(id => todayCustomerIds.has(id));
    const churnedCustomerIds = [...monthAgoCustomerIds].filter(id => !todayCustomerIds.has(id));
    const newCustomerIds = [...todayCustomerIds].filter(id => !monthAgoCustomerIds.has(id));

    const monthAgoCount = monthAgoCustomerIds.size;
    const todayCount = todayCustomerIds.size;
    const retainedCount = retainedCustomerIds.length;
    const churnedCount = churnedCustomerIds.length;
    const newCount = newCustomerIds.length;

    const retentionRate = monthAgoCount > 0 ? (retainedCount / monthAgoCount) * 100 : 0;

    // Create maps for easy lookup
    const monthAgoCustomerMap = new Map();
    monthAgoCustomers.forEach(c => monthAgoCustomerMap.set(c.stripe_customer_id, c));

    // Get detailed information about churned customers
    const churnedCustomersDetails = churnedCustomerIds.map(id => {
      const customer = monthAgoCustomerMap.get(id);
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

    const responseData = {
      period: 'monthly',
      retention_rate: Math.round(retentionRate * 100) / 100, // Round to 2 decimal places
      metrics: {
        previous_period_customers: monthAgoCount,
        current_period_customers: todayCount,
        retained_customers: retainedCount,
        churned_customers: churnedCount,
        new_customers: newCount,
        churned_mrr: Math.round(churnedMRR * 100) / 100
      },
      period_labels: {
        previous: monthAgoStr,
        current: todayStr
      },
      churn_details: churnedCustomersDetails.sort((a, b) => b.monthly_value - a.monthly_value), // Sort by value desc
      requestId,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ [${requestId}] Monthly retention calculated: ${retentionRate.toFixed(2)}% retention rate`);
    console.log(`   Month ago (${monthAgoStr}): ${monthAgoCount} customers, Today (${todayStr}): ${todayCount} customers`);
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
});

// Unified retention endpoint with period selection
app.get('/api/retention/calculate', async (req, res) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  const { period = '3' } = req.query; // Default to 3-day

  const daysMap = {
    '1': 1,
    '3': 3,
    '7': 7,
    '14': 14,
    '30': 30
  };

  const days = daysMap[period] || 3;

  console.log(`📊 [${requestId}] Retention API request for ${days}-day period`);

  try {
    if (!supabase) {
      return res.status(500).json({
        error: 'Supabase not configured',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const previousDate = new Date();
    previousDate.setDate(today.getDate() - days);
    const previousDateStr = previousDate.toISOString().split('T')[0];

    console.log(`📈 [${requestId}] Calculating ${days}-day retention:`);
    console.log(`   Today: ${todayStr}`);
    console.log(`   ${days} days ago: ${previousDateStr}`);

    // Get paying customers from previous date snapshot
    const { data: previousCustomers, error: previousError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status, stripe_subscription_id')
      .eq('date', previousDateStr)
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing');

    if (previousError) {
      console.error(`❌ [${requestId}] Error fetching previous customers:`, previousError);
      throw previousError;
    }

    // Get paying customers from today's snapshot
    const { data: todayCustomers, error: todayError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_customer_id, customer_email, customer_name, monthly_value, subscription_status, stripe_subscription_id')
      .eq('date', todayStr)
      .eq('is_counted', true)
      .neq('subscription_status', 'trialing');

    if (todayError) {
      console.error(`❌ [${requestId}] Error fetching today's customers:`, todayError);
      throw todayError;
    }

    // Create sets for comparison
    const todayCustomerIds = new Set(todayCustomers.map(c => c.stripe_customer_id));
    const previousCustomerIds = new Set(previousCustomers.map(c => c.stripe_customer_id));

    // Calculate retention metrics
    const retainedCustomerIds = [...previousCustomerIds].filter(id => todayCustomerIds.has(id));
    const churnedCustomerIds = [...previousCustomerIds].filter(id => !todayCustomerIds.has(id));
    const newCustomerIds = [...todayCustomers].filter(c => !previousCustomerIds.has(c.stripe_customer_id));

    const previousCount = previousCustomerIds.size;
    const todayCount = todayCustomerIds.size;
    const retainedCount = retainedCustomerIds.length;
    const churnedCount = churnedCustomerIds.length;
    const newCount = newCustomerIds.length;

    const retentionRate = previousCount > 0 ? (retainedCount / previousCount) * 100 : 0;

    // Create detailed subscription list with status
    const subscriptionDetails = previousCustomers.map(customer => {
      const isRetained = todayCustomerIds.has(customer.stripe_customer_id);
      return {
        stripe_subscription_id: customer.stripe_subscription_id,
        stripe_customer_id: customer.stripe_customer_id,
        customer_email: customer.customer_email,
        customer_name: customer.customer_name,
        monthly_value: parseFloat(customer.monthly_value),
        status: isRetained ? 'retained' : 'churned',
        customer_display: customer.customer_name || customer.customer_email || 'Unknown'
      };
    });

    // Sort: churned first, then by monthly value descending
    subscriptionDetails.sort((a, b) => {
      if (a.status === 'churned' && b.status === 'retained') return -1;
      if (a.status === 'retained' && b.status === 'churned') return 1;
      return b.monthly_value - a.monthly_value;
    });

    const responseData = {
      period: `${days}day`,
      period_days: days,
      retention_rate: Math.round(retentionRate * 100) / 100,
      metrics: {
        previous_period_customers: previousCount,
        current_period_customers: todayCount,
        retained_customers: retainedCount,
        churned_customers: churnedCount,
        new_customers: newCount
      },
      period_labels: {
        previous: previousDateStr,
        current: todayStr
      },
      subscription_details: subscriptionDetails,
      requestId,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ [${requestId}] ${days}-day retention calculated: ${retentionRate.toFixed(2)}% retention rate`);
    console.log(`   ${days} days ago (${previousDateStr}): ${previousCount} customers, Today (${todayStr}): ${todayCount} customers`);
    console.log(`   Retained: ${retainedCount}, Churned: ${churnedCount}, New: ${newCount}`);

    res.json(responseData);

  } catch (error) {
    console.error(`❌ [${requestId}] Retention API error:`, error.message);
    res.status(500).json({
      error: 'Failed to calculate retention',
      details: error.message,
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// Historical MRR endpoint
app.get('/api/historical/mrr', async (req, res) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`📊 [${requestId}] Historical MRR API request`);

  try {
    if (!supabase) {
      return res.status(500).json({
        error: 'Supabase not configured',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    // Get all historical MRR data (no limit to show full timeline)
    const { data: historicalData, error: histError } = await supabase
      .from('historical_mrr')
      .select('date, official_mrr, arr, paying_customers_count, trial_pipeline_mrr, active_trials_count, total_opportunity')
      .order('date', { ascending: true });

    if (histError) {
      console.error(`❌ [${requestId}] Error fetching historical data:`, histError);
      throw histError;
    }

    console.log(`✅ [${requestId}] Historical MRR data sent: ${historicalData.length} records`);

    res.json(historicalData || []);

  } catch (error) {
    console.error(`❌ [${requestId}] Historical MRR API error:`, error.message);
    res.status(500).json({
      error: 'Failed to fetch historical MRR data',
      details: error.message,
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// Enhanced health check endpoint
app.get('/api/health', async (req, res) => {
  const healthCheck = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    services: {
      stripe: { status: 'unknown', message: '' },
      database: { status: 'N/A', message: 'No database configured' },
      websocket: { status: 'OK', message: `${connectedClients.length} clients connected` }
    }
  };

  // Test Stripe connection
  try {
    await stripe.customers.list({ limit: 1 });
    healthCheck.services.stripe = { status: 'OK', message: 'Stripe API accessible' };
  } catch (error) {
    healthCheck.services.stripe = {
      status: 'ERROR',
      message: error.message.substring(0, 100) + (error.message.length > 100 ? '...' : '')
    };
    healthCheck.status = 'DEGRADED';
  }

  // Set appropriate HTTP status
  const httpStatus = healthCheck.status === 'OK' ? 200 :
                    healthCheck.status === 'DEGRADED' ? 503 : 500;

  console.log(`🏥 Health check request: ${healthCheck.status} (Stripe: ${healthCheck.services.stripe.status})`);
  res.status(httpStatus).json(healthCheck);
});

// Comprehensive customer data endpoint
app.get('/api/customers/all', async (req, res) => {
  try {
    console.log('👥 All customers data requested');

    // Fetch ALL customers (not just first 100) for complete view
    console.log('📊 Fetching all customers...');
    const allCustomers = [];
    let hasMoreCustomers = true;
    let customerStartingAfter = null;

    while (hasMoreCustomers) {
      const params = { limit: 100 };
      if (customerStartingAfter) {
        params.starting_after = customerStartingAfter;
      }

      const batch = await stripe.customers.list(params);
      allCustomers.push(...batch.data);

      hasMoreCustomers = batch.has_more;
      if (batch.data.length > 0) {
        customerStartingAfter = batch.data[batch.data.length - 1].id;
      }
    }

    console.log(`✅ Fetched ${allCustomers.length} total customers`);

    // Fetch ALL subscriptions (not just 100) for accurate payment status
    console.log('📊 Fetching all subscriptions for payment status calculation...');
    const allSubscriptions = [];
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
      const params = { limit: 100, status: 'all' };
      if (startingAfter) {
        params.starting_after = startingAfter;
      }

      const batch = await stripe.subscriptions.list(params);
      allSubscriptions.push(...batch.data);

      hasMore = batch.has_more;
      if (batch.data.length > 0) {
        startingAfter = batch.data[batch.data.length - 1].id;
      }
    }

    console.log(`✅ Fetched ${allSubscriptions.length} total subscriptions`);
    const customerSubscriptionMap = new Map();

    for (const subscription of allSubscriptions) {
      if (!customerSubscriptionMap.has(subscription.customer)) {
        customerSubscriptionMap.set(subscription.customer, []);
      }
      customerSubscriptionMap.get(subscription.customer).push(subscription);
    }

    const customerData = [];
    for (const customer of allCustomers) {
      const dbStatus = await customerDB.getCustomerStatus(customer.id);
      const isValid = await isValidCustomer(customer);

      // Efficient payment status calculation (aligned with MRR logic)
      const customerSubs = customerSubscriptionMap.get(customer.id) || [];

      // Calculate monthly payment amount for this customer
      let monthlyAmount = 0;
      let hasActiveNonZeroSubscription = false;

      for (const subscription of customerSubs) {
        if (subscription.status === 'active' || subscription.status === 'past_due') {
          // Calculate the monthly amount for this subscription
          const subAmount = subscription.items.data.reduce((sum, item) => {
            const price = item.price;
            let monthlyPrice = 0;

            if (price.recurring) {
              if (price.recurring.interval === 'month') {
                monthlyPrice = price.unit_amount / 100;
              } else if (price.recurring.interval === 'year') {
                monthlyPrice = (price.unit_amount / 100) / 12;
              }
            }

            return sum + (monthlyPrice * item.quantity);
          }, 0);

          monthlyAmount += subAmount;
          if (subAmount > 0) {
            hasActiveNonZeroSubscription = true;
          }
        }
      }

      const hasTrialingSubscription = customerSubs.some(sub => sub.status === 'trialing');

      // Updated payment status logic - only count as "paying" if they have non-zero active subscriptions
      let paymentStatus = 'signup_only';
      if (hasActiveNonZeroSubscription) {
        paymentStatus = 'paying';
      } else if (hasTrialingSubscription) {
        paymentStatus = 'trial';
      } else if (customer.invoice_settings?.default_payment_method || customer.default_source) {
        paymentStatus = 'payment_method_only';
      }

      customerData.push({
        id: customer.id,
        email: customer.email,
        name: customer.name || 'No name provided',
        created: new Date(customer.created * 1000),
        created_formatted: new Date(customer.created * 1000).toLocaleString(),
        isValid: isValid,
        description: customer.description,
        phone: customer.phone,
        address: customer.address,
        status: dbStatus ? dbStatus.status : (isValid ? 'included' : 'auto_excluded'),
        exclusion_reason: dbStatus ? dbStatus.exclusion_reason : null,
        last_modified: dbStatus ? dbStatus.last_modified : null,
        modified_by: dbStatus ? dbStatus.modified_by : null,
        payment_status: paymentStatus,
        monthly_amount: monthlyAmount
      });
    }

    const validCustomers = customerData.filter(c => c.isValid);
    const excludedCustomers = customerData.filter(c => !c.isValid);

    // Payment status segmentation
    const payingCustomers = customerData.filter(c => c.payment_status === 'paying');
    const trialCustomers = customerData.filter(c => c.payment_status === 'trial');
    const paymentMethodOnlyCustomers = customerData.filter(c => c.payment_status === 'payment_method_only');
    const signupOnlyCustomers = customerData.filter(c => c.payment_status === 'signup_only');

    // Log payment status summary
    console.log(`📊 Customer Management Payment Status Summary:
    - Total Customers: ${customerData.length}
    - Paying: ${payingCustomers.length}
    - Trial: ${trialCustomers.length}
    - Payment Method Only: ${paymentMethodOnlyCustomers.length}
    - Signup Only: ${signupOnlyCustomers.length}`);

    // Log details of paying customers for verification
    if (payingCustomers.length > 0) {
      const topPayingCustomers = payingCustomers
        .sort((a, b) => b.monthly_amount - a.monthly_amount)
        .slice(0, 10);

      console.log(`💳 Top paying customers (up to 10):`,
        topPayingCustomers.map(c => ({
          email: c.email,
          id: c.id,
          monthly: `$${c.monthly_amount.toFixed(2)}`
        }))
      );

      const totalMonthlyRevenue = payingCustomers.reduce((sum, c) => sum + c.monthly_amount, 0);
      console.log(`💰 Total monthly revenue from paying customers: $${totalMonthlyRevenue.toFixed(2)}`);
    }

    res.json({
      timestamp: new Date().toISOString(),
      total_customers: customerData.length,
      valid_customers: validCustomers.length,
      excluded_customers: excludedCustomers.length,
      payment_segmentation: {
        paying: payingCustomers.length,
        trial: trialCustomers.length,
        payment_method_only: paymentMethodOnlyCustomers.length,
        signup_only: signupOnlyCustomers.length
      },
      customers: customerData.sort((a, b) => new Date(b.created) - new Date(a.created))
    });
  } catch (error) {
    console.error('❌ Error fetching all customer data:', error.message);
    res.status(500).json({ error: 'Failed to fetch customer data' });
  }
});

// Customer management endpoints
app.post('/api/customers/:customerId/status', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status, reason } = req.body;

    if (!['included', 'excluded'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "included" or "excluded"' });
    }

    // Get customer details from Stripe
    const customer = await stripe.customers.retrieve(customerId);

    await customerDB.setCustomerStatus(
      customerId,
      customer.email,
      customer.name,
      status,
      reason,
      'manual'
    );

    console.log(`✅ Customer ${customer.email} status changed to ${status}`);
    res.json({
      success: true,
      message: `Customer status updated to ${status}`,
      customer: {
        id: customerId,
        email: customer.email,
        name: customer.name,
        status: status,
        reason: reason
      }
    });
  } catch (error) {
    console.error('❌ Error updating customer status:', error.message);
    res.status(500).json({ error: 'Failed to update customer status' });
  }
});

// Customer verification endpoint (enhanced)
app.get('/api/customers/verify', async (req, res) => {
  try {
    console.log('👥 Customer verification requested');
    const customers = await stripe.customers.list({ limit: 100 });

    const customerData = [];
    for (const customer of customers.data) {
      const isValid = await isValidCustomer(customer);
      customerData.push({
        id: customer.id,
        email: customer.email,
        name: customer.name,
        created: new Date(customer.created * 1000).toLocaleString(),
        isValid: isValid,
        description: customer.description
      });
    }

    const validCustomers = customerData.filter(c => c.isValid);
    const filteredCustomers = customerData.filter(c => !c.isValid);

    res.json({
      timestamp: new Date().toISOString(),
      total_customers: customerData.length,
      valid_customers: validCustomers.length,
      filtered_customers: filteredCustomers.length,
      filter_patterns: [
        'test@', 'testing@', '@example.', '@test.', '+test', 'usebear.ai'
      ],
      customers: {
        valid: validCustomers.slice(0, 20),
        filtered: filteredCustomers.slice(0, 10)
      }
    });
  } catch (error) {
    console.error('❌ Error fetching customer verification data:', error.message);
    res.status(500).json({ error: 'Failed to fetch customer data' });
  }
});

// Detailed debug endpoint (only in development)
app.get('/api/debug', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const debugInfo = {
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      CLIENT_ORIGIN: process.env.CLIENT_ORIGIN,
      stripe_key_configured: !!process.env.STRIPE_SECRET_KEY,
      stripe_key_format: process.env.STRIPE_SECRET_KEY?.startsWith('sk_') ? 'valid' : 'invalid'
    },
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid,
      platform: process.platform,
      node_version: process.version
    },
    websocket: {
      connected_clients: connectedClients.length,
      client_ids: connectedClients.map(client => client.id)
    }
  };

  console.log('🔧 Debug info requested');
  res.json(debugInfo);
});

// Advanced churn analytics endpoint
app.get('/api/analytics/churn', async (req, res) => {
  try {
    console.log('📈 Advanced churn analytics requested');
    const days = parseInt(req.query.days) || 30;

    // Get basic churn data from database
    const [churnAnalytics, detailedChurn] = await Promise.all([
      customerDB.getChurnAnalytics(days),
      customerDB.getDetailedChurnData(days)
    ]);

    // Get current subscription data for more detailed analysis
    const [activeSubscriptions, canceledSubscriptions] = await Promise.all([
      stripe.subscriptions.list({ status: 'active', limit: 100 }),
      stripe.subscriptions.list({
        status: 'canceled',
        created: { gte: Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000) },
        limit: 100
      })
    ]);

    // Calculate detailed metrics
    const totalActiveCustomers = activeSubscriptions.data.length;
    const totalChurnedCustomers = canceledSubscriptions.data.length;
    const churnRate = totalActiveCustomers > 0
      ? (totalChurnedCustomers / (totalActiveCustomers + totalChurnedCustomers)) * 100
      : 0;

    // Analyze churn patterns
    const churnByReason = {};
    const churnByDuration = { '<30days': 0, '30-90days': 0, '90days+': 0 };
    let totalLostRevenue = 0;

    for (const churn of detailedChurn) {
      // Group by reason
      const reason = churn.churn_reason || 'Unknown';
      churnByReason[reason] = (churnByReason[reason] || 0) + 1;

      // Group by subscription duration
      const duration = churn.subscription_duration_days || 0;
      if (duration < 30) churnByDuration['<30days']++;
      else if (duration < 90) churnByDuration['30-90days']++;
      else churnByDuration['90days+']++;

      // Sum lost revenue
      totalLostRevenue += churn.total_revenue_lifetime || 0;
    }

    // Calculate cohort retention (simplified)
    const cohortData = [];
    for (let i = 0; i < 6; i++) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i);
      monthStart.setDate(1);

      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);

      // This is a simplified cohort analysis - in production you'd want more sophisticated tracking
      cohortData.push({
        month: monthStart.toLocaleDateString('en-US', { year: 'numeric', month: 'short' }),
        new_customers: Math.floor(Math.random() * 20) + 5, // Placeholder - replace with real data
        retained_customers: Math.floor(Math.random() * 15) + 3,
        retention_rate: Math.random() * 30 + 70 // Placeholder percentage
      });
    }

    res.json({
      timestamp: new Date().toISOString(),
      period_days: days,
      summary: {
        total_active_customers: totalActiveCustomers,
        total_churned_customers: totalChurnedCustomers,
        churn_rate: parseFloat(churnRate.toFixed(2)),
        total_lost_revenue: totalLostRevenue,
        average_customer_lifetime: detailedChurn.length > 0
          ? detailedChurn.reduce((sum, c) => sum + (c.subscription_duration_days || 0), 0) / detailedChurn.length
          : 0
      },
      churn_breakdown: {
        by_reason: churnByReason,
        by_duration: churnByDuration,
        by_type: churnAnalytics.reduce((acc, item) => {
          acc[item.churn_type] = item.count_by_type;
          return acc;
        }, {})
      },
      cohort_analysis: cohortData,
      recent_churned_customers: detailedChurn.slice(0, 10).map(customer => ({
        email: customer.email,
        name: customer.name,
        churned_date: customer.churned_date,
        reason: customer.churn_reason,
        duration_days: customer.subscription_duration_days,
        lifetime_revenue: customer.total_revenue_lifetime
      }))
    });

  } catch (error) {
    console.error('❌ Error fetching churn analytics:', error.message);
    res.status(500).json({ error: 'Failed to fetch churn analytics' });
  }
});

// Export data endpoint
app.get('/api/export/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const format = req.query.format || 'json';

    console.log(`📤 Export requested: ${type} in ${format} format`);

    let data;
    let filename;

    switch (type) {
      case 'customers':
        const customers = await stripe.customers.list({ limit: 100 });
        data = [];
        for (const customer of customers.data) {
          const isValid = await isValidCustomer(customer);
          const dbStatus = await customerDB.getCustomerStatus(customer.id);

          data.push({
            id: customer.id,
            email: customer.email,
            name: customer.name || 'No name provided',
            created: new Date(customer.created * 1000).toISOString(),
            status: dbStatus ? dbStatus.status : (isValid ? 'included' : 'auto_excluded'),
            exclusion_reason: dbStatus ? dbStatus.exclusion_reason : null,
            phone: customer.phone,
            description: customer.description
          });
        }
        filename = `customers_${new Date().toISOString().split('T')[0]}.json`;
        break;

      case 'churn':
        const churnData = await customerDB.getDetailedChurnData(90);
        data = churnData.map(item => ({
          customer_id: item.stripe_customer_id,
          email: item.email,
          name: item.name,
          churned_date: item.churned_date,
          churn_reason: item.churn_reason,
          subscription_duration_days: item.subscription_duration_days,
          lifetime_revenue: item.total_revenue_lifetime,
          churn_type: item.churn_type
        }));
        filename = `churn_data_${new Date().toISOString().split('T')[0]}.json`;
        break;

      default:
        return res.status(400).json({ error: 'Invalid export type' });
    }

    if (format === 'csv') {
      // Convert to CSV
      if (data.length === 0) {
        return res.status(404).json({ error: 'No data to export' });
      }

      const headers = Object.keys(data[0]);
      const csvRows = [
        headers.join(','),
        ...data.map(row => headers.map(header =>
          JSON.stringify(row[header] || '')
        ).join(','))
      ];

      filename = filename.replace('.json', '.csv');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvRows.join('\n'));
    } else {
      // JSON format
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json({
        exported_at: new Date().toISOString(),
        type: type,
        count: data.length,
        data: data
      });
    }

  } catch (error) {
    console.error('❌ Error exporting data:', error.message);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Real-time data updates every 30 seconds
cron.schedule('*/30 * * * * *', async () => {
  if (connectedClients.length > 0) {
    console.log('⏰ Running scheduled dashboard update...');
    const data = await fetchDashboardData();
    if (data) {
      let successCount = 0;
      let errorCount = 0;

      connectedClients.forEach(client => {
        try {
          client.emit('dashboard_update', data);
          successCount++;
        } catch (error) {
          console.error(`❌ Failed to send update to client ${client.id}:`, error.message);
          errorCount++;
        }
      });

      console.log(`📡 Real-time update sent: ${successCount} success, ${errorCount} errors`);
    } else {
      console.warn('⚠️ Skipping real-time update - no data available');
    }
  } else {
    console.log('⏰ Scheduled update skipped - no connected clients');
  }
});

server.listen(PORT, () => {
  console.log('\n🚀 Stripe Dashboard Server Started Successfully!');
  console.log('==========================================');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌐 Dashboard API: http://localhost:${PORT}/api/dashboard`);
  console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔧 Debug info: http://localhost:${PORT}/api/debug`);
  console.log(`👥 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🎯 Client origin allowed: ${CLIENT_ORIGIN}`);
  console.log('==========================================\n');

  // Perform initial health check
  setTimeout(async () => {
    try {
      console.log('🏥 Performing initial health check...');
      await stripe.customers.list({ limit: 1 });
      console.log('✅ Stripe connection verified successfully');
    } catch (error) {
      console.error('❌ Initial Stripe connection failed:', error.message);
      console.error('⚠️ Server is running but Stripe integration may not work properly');
    }
  }, 1000);
});