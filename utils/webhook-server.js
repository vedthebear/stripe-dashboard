const express = require('express');
const cors = require('cors');
const { handleWebhook } = require('../server/webhooks');
require('dotenv').config();

const app = express();
const PORT = process.env.WEBHOOK_PORT || 3001;

// Initialize Stripe with the secret key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Environment validation
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY not found in environment variables');
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ Supabase credentials not found in environment variables');
  process.exit(1);
}

// Middleware
app.use(cors());

// Webhook endpoint - MUST be before express.json() to get raw body
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify webhook signature (we'll add the endpoint secret later)
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
      console.log('✅ Webhook signature verified');
    } else {
      // For testing without signature verification
      event = JSON.parse(req.body.toString());
      console.log('⚠️ Webhook running without signature verification (add STRIPE_WEBHOOK_SECRET for production)');
    }

    // Handle the webhook event
    await handleWebhook(event, stripe);

    // Respond to Stripe that we received the webhook
    res.status(200).json({ received: true });

  } catch (err) {
    console.error('❌ Webhook error:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Other middleware for JSON parsing (after webhook endpoint)
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Stripe Webhook Server is running',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Stripe Webhook Server',
    endpoints: {
      webhook: '/webhook',
      health: '/health'
    },
    status: 'Running'
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n🚀 Stripe Webhook Server Started Successfully!');
  console.log('==============================================');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🪝 Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`🔑 Stripe key configured: ${!!process.env.STRIPE_SECRET_KEY}`);
  console.log(`🗄️ Supabase configured: ${!!process.env.SUPABASE_URL}`);
  console.log('==============================================');

  // Test Supabase connection
  setTimeout(async () => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

      const { count, error } = await supabase
        .from('subscriptions')
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.error('❌ Supabase connection test failed:', error.message);
      } else {
        console.log(`✅ Supabase connected successfully (${count} subscriptions in database)`);
      }
    } catch (error) {
      console.error('❌ Supabase test error:', error.message);
    }
  }, 1000);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Webhook server shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Webhook server shutting down gracefully...');
  process.exit(0);
});