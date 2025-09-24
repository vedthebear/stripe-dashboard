const axios = require('axios');

async function getWebhookUrl() {
  try {
    console.log('🔍 Getting ngrok webhook URL...');

    // Get ngrok tunnels
    const response = await axios.get('http://localhost:4040/api/tunnels');
    const tunnels = response.data.tunnels;

    // Find the HTTPS tunnel
    const httpsTunnel = tunnels.find(tunnel =>
      tunnel.proto === 'https' && tunnel.config.addr === 'localhost:3001'
    );

    if (!httpsTunnel) {
      console.error('❌ No HTTPS tunnel found for port 3001');
      console.log('Make sure ngrok is running: ngrok http 3001');
      return;
    }

    const webhookUrl = httpsTunnel.public_url + '/webhook';
    const healthUrl = httpsTunnel.public_url + '/health';

    console.log('\n🎉 Webhook URLs Ready!');
    console.log('========================');
    console.log(`🪝 Webhook URL: ${webhookUrl}`);
    console.log(`🏥 Health Check: ${healthUrl}`);
    console.log('========================');

    // Test the webhook endpoint
    console.log('\n🧪 Testing webhook endpoint...');
    try {
      const healthResponse = await axios.get(healthUrl);
      console.log('✅ Webhook server is responding:', healthResponse.data.message);
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
    }

    console.log('\n📋 Next Steps:');
    console.log('1. Copy the webhook URL above');
    console.log('2. Go to Stripe Dashboard → Developers → Webhooks');
    console.log('3. Click "Add endpoint"');
    console.log('4. Paste the webhook URL');
    console.log('5. Select these events:');
    console.log('   - customer.subscription.created');
    console.log('   - customer.subscription.updated');
    console.log('   - customer.subscription.deleted');
    console.log('   - customer.updated');
    console.log('   - invoice.payment_succeeded');
    console.log('   - invoice.payment_failed');
    console.log('6. Click "Add endpoint"');
    console.log('7. Copy the webhook signing secret and add it to your .env file');

    return webhookUrl;

  } catch (error) {
    console.error('❌ Error getting webhook URL:', error.message);
    console.log('Make sure ngrok is running: ngrok http 3001');
  }
}

// Run if called directly
if (require.main === module) {
  getWebhookUrl();
}

module.exports = { getWebhookUrl };