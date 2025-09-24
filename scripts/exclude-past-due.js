require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Exclude past_due subscriptions from official MRR count
 */
async function excludePastDueSubscriptions() {
  console.log('🚀 Excluding past_due subscriptions from official MRR...');

  try {
    // Get current past_due subscriptions that are counted
    const { data: pastDueSubscriptions, error: fetchError } = await supabase
      .from('subscriptions')
      .select('stripe_subscription_id, customer_email, monthly_total')
      .eq('subscription_status', 'past_due')
      .eq('is_counted', true);

    if (fetchError) {
      console.error('❌ Error fetching past_due subscriptions:', fetchError);
      return;
    }

    console.log(`📋 Found ${pastDueSubscriptions.length} past_due subscriptions currently counted`);

    if (pastDueSubscriptions.length === 0) {
      console.log('✅ No past_due subscriptions to exclude');
      return;
    }

    // Show what will be excluded
    const totalPastDueMrr = pastDueSubscriptions.reduce((sum, sub) => sum + parseFloat(sub.monthly_total), 0);
    console.log(`💰 Total MRR to be excluded: $${totalPastDueMrr.toFixed(2)}`);

    // Update past_due subscriptions to not be counted
    const { count: updatedCount, error: updateError } = await supabase
      .from('subscriptions')
      .update({ is_counted: false })
      .eq('subscription_status', 'past_due')
      .eq('is_counted', true)
      .select('*', { count: 'exact', head: true });

    if (updateError) {
      console.error('❌ Error updating past_due subscriptions:', updateError);
      return;
    }

    console.log(`✅ Successfully excluded ${updatedCount} past_due subscriptions`);

    // Get updated MRR summary
    await getMrrSummary();

  } catch (error) {
    console.error('❌ Error excluding past_due subscriptions:', error.message);
  }
}

/**
 * Get updated MRR summary
 */
async function getMrrSummary() {
  console.log('\n💰 Updated MRR Summary:');

  try {
    // Get official MRR (counted subscriptions only)
    const { data: officialMrr, error: officialError } = await supabase
      .from('official_mrr')
      .select('*');

    // Get total active MRR (all active subscriptions)
    const { data: activeMrr, error: activeError } = await supabase
      .from('active_mrr')
      .select('*');

    if (officialError || activeError) {
      console.error('❌ Error getting MRR summary:', officialError || activeError);
      return;
    }

    console.log(`  - Official MRR (counted): $${officialMrr[0]?.total_mrr || 0}`);
    console.log(`  - Total Active MRR: $${activeMrr[0]?.total_mrr || 0}`);
    console.log(`  - Counted subscriptions: ${officialMrr[0]?.counted_subscriptions || 0}`);
    console.log(`  - Total active subscriptions: ${activeMrr[0]?.active_subscriptions || 0}`);

    const exclusionAmount = (activeMrr[0]?.total_mrr || 0) - (officialMrr[0]?.total_mrr || 0);
    console.log(`  - Total MRR excluded from official count: $${exclusionAmount.toFixed(2)}`);

    // Show breakdown by status
    const { data: statusBreakdown, error: statusError } = await supabase
      .from('subscription_status_breakdown')
      .select('*');

    if (!statusError) {
      console.log('\n📋 Status Breakdown:');
      statusBreakdown.forEach(status => {
        console.log(`  - ${status.subscription_status}: ${status.counted_subscriptions} counted ($${status.counted_mrr} MRR) | ${status.count} total ($${status.total_mrr} MRR)`);
      });
    }

  } catch (error) {
    console.error('❌ Error getting MRR summary:', error.message);
  }
}

// Run the exclusion
if (require.main === module) {
  excludePastDueSubscriptions()
    .then(() => {
      console.log('\n✅ Past due exclusion completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Past due exclusion failed:', error);
      process.exit(1);
    });
}

module.exports = {
  excludePastDueSubscriptions
};