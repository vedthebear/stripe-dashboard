require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function updateTrialCounted() {
  console.log('🔄 Fetching trial subscriptions...');

  const { data: trials, error } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id, customer_email, subscription_status, percent_off, date_canceled')
    .eq('subscription_status', 'trialing');

  if (error) {
    console.error('❌ Error fetching trials:', error.message);
    return;
  }

  console.log(`📋 Found ${trials.length} trial subscriptions`);

  for (const trial of trials) {
    const shouldCount = (
      trial.subscription_status === 'trialing' &&
      (trial.percent_off === null || trial.percent_off !== 100) &&
      (trial.customer_email === null || !trial.customer_email.endsWith('usebear.ai')) &&
      trial.date_canceled === null
    );

    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({ is_trial_counted: shouldCount })
      .eq('stripe_subscription_id', trial.stripe_subscription_id);

    if (updateError) {
      console.error(`❌ Error updating ${trial.customer_email}:`, updateError.message);
    } else {
      console.log(`✅ ${trial.customer_email}: counted=${shouldCount} (percent_off=${trial.percent_off})`);
    }
  }

  // Final count
  const { count, error: countError } = await supabase
    .from('subscriptions')
    .select('*', { count: 'exact', head: true })
    .eq('is_trial_counted', true);

  if (!countError) {
    console.log(`\n📊 Total trial subscriptions that should be counted: ${count}`);
  }
}

updateTrialCounted();