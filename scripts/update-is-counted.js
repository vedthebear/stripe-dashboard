require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

// Check if environment variables are loaded
console.log('🔑 Checking environment variables...');
console.log('Supabase URL loaded:', !!process.env.SUPABASE_URL);
console.log('Supabase key loaded:', !!process.env.SUPABASE_ANON_KEY);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ Supabase credentials not found in environment variables');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Update is_counted field based on exclusion criteria
 */
async function updateIsCountedField() {
  console.log('🚀 Starting is_counted field update...');

  try {
    // Get current counts before update
    console.log('📊 Getting current subscription counts...');
    const { count: totalBefore, error: countError } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true });

    const { count: countedBefore, error: countedError } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('is_counted', true);

    if (countError || countedError) {
      console.error('❌ Error getting initial counts:', countError || countedError);
      return;
    }

    console.log(`📋 Before update: ${totalBefore} total, ${countedBefore} counted`);

    // Update subscriptions that meet exclusion criteria
    console.log('🔄 Updating is_counted field...');

    // Condition 1: Status is canceled or trialing
    const { count: statusUpdated, error: statusError } = await supabase
      .from('subscriptions')
      .update({ is_counted: false })
      .in('subscription_status', ['canceled', 'trialing'])
      .select('*', { count: 'exact', head: true });

    if (statusError) {
      console.error('❌ Error updating status-based exclusions:', statusError);
    } else {
      console.log(`✅ Updated ${statusUpdated} subscriptions (canceled/trialing status)`);
    }

    // Condition 2: 100% discount
    const { count: discountUpdated, error: discountError } = await supabase
      .from('subscriptions')
      .update({ is_counted: false })
      .eq('percent_off', 100)
      .select('*', { count: 'exact', head: true });

    if (discountError) {
      console.error('❌ Error updating discount-based exclusions:', discountError);
    } else {
      console.log(`✅ Updated ${discountUpdated} subscriptions (100% discount)`);
    }

    // Condition 3: Email ends with "usebear.ai"
    const { count: emailUpdated, error: emailError } = await supabase
      .from('subscriptions')
      .update({ is_counted: false })
      .like('customer_email', '%usebear.ai')
      .select('*', { count: 'exact', head: true });

    if (emailError) {
      console.error('❌ Error updating email-based exclusions:', emailError);
    } else {
      console.log(`✅ Updated ${emailUpdated} subscriptions (usebear.ai emails)`);
    }

    // Get final counts
    console.log('📊 Getting updated subscription counts...');
    const { count: countedAfter, error: finalCountError } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('is_counted', true);

    const { count: excludedAfter, error: excludedError } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('is_counted', false);

    if (finalCountError || excludedError) {
      console.error('❌ Error getting final counts:', finalCountError || excludedError);
      return;
    }

    console.log(`📋 After update: ${totalBefore} total, ${countedAfter} counted, ${excludedAfter} excluded`);

    // Get detailed breakdown of exclusions
    await getExclusionBreakdown();

    // Get updated MRR summary
    await getMrrSummary();

  } catch (error) {
    console.error('❌ Error during is_counted update:', error.message);
  }
}

/**
 * Get breakdown of excluded subscriptions
 */
async function getExclusionBreakdown() {
  console.log('\n📋 Exclusion Breakdown:');

  try {
    // Get excluded by status
    const { data: excludedStatus, error: statusError } = await supabase
      .from('subscriptions')
      .select('subscription_status, monthly_total')
      .eq('is_counted', false)
      .in('subscription_status', ['canceled', 'trialing']);

    if (!statusError && excludedStatus.length > 0) {
      const statusBreakdown = {};
      excludedStatus.forEach(sub => {
        if (!statusBreakdown[sub.subscription_status]) {
          statusBreakdown[sub.subscription_status] = { count: 0, mrr: 0 };
        }
        statusBreakdown[sub.subscription_status].count++;
        statusBreakdown[sub.subscription_status].mrr += parseFloat(sub.monthly_total);
      });

      Object.entries(statusBreakdown).forEach(([status, data]) => {
        console.log(`  - ${status}: ${data.count} subscriptions ($${data.mrr.toFixed(2)} MRR)`);
      });
    }

    // Get excluded by 100% discount
    const { count: discountCount, error: discountError } = await supabase
      .from('subscriptions')
      .select('monthly_total', { count: 'exact' })
      .eq('is_counted', false)
      .eq('percent_off', 100);

    if (!discountError && discountCount > 0) {
      console.log(`  - 100% discount: ${discountCount} subscriptions`);
    }

    // Get excluded by usebear.ai email
    const { data: emailExcluded, error: emailError } = await supabase
      .from('subscriptions')
      .select('monthly_total')
      .eq('is_counted', false)
      .like('customer_email', '%usebear.ai');

    if (!emailError && emailExcluded.length > 0) {
      const emailMrr = emailExcluded.reduce((sum, sub) => sum + parseFloat(sub.monthly_total), 0);
      console.log(`  - usebear.ai emails: ${emailExcluded.length} subscriptions ($${emailMrr.toFixed(2)} MRR)`);
    }

  } catch (error) {
    console.error('❌ Error getting exclusion breakdown:', error.message);
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

    // Get trial pipeline
    const { data: trialData, error: trialError } = await supabase
      .from('trial_pipeline')
      .select('*');

    if (officialError || activeError || trialError) {
      console.error('❌ Error getting MRR summary:', officialError || activeError || trialError);
      return;
    }

    console.log(`  - Official MRR (counted): $${officialMrr[0]?.total_mrr || 0}`);
    console.log(`  - Total Active MRR: $${activeMrr[0]?.total_mrr || 0}`);
    console.log(`  - Counted subscriptions: ${officialMrr[0]?.counted_subscriptions || 0}`);
    console.log(`  - Total active subscriptions: ${activeMrr[0]?.active_subscriptions || 0}`);
    console.log(`  - Trial pipeline (counted): $${trialData[0]?.counted_trial_mrr || 0}`);

    const exclusionSavings = (activeMrr[0]?.total_mrr || 0) - (officialMrr[0]?.total_mrr || 0);
    console.log(`  - MRR excluded from official count: $${exclusionSavings.toFixed(2)}`);

  } catch (error) {
    console.error('❌ Error getting MRR summary:', error.message);
  }
}

// Run the update
if (require.main === module) {
  updateIsCountedField()
    .then(() => {
      console.log('\n✅ is_counted field update completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ is_counted field update failed:', error);
      process.exit(1);
    });
}

module.exports = {
  updateIsCountedField,
  getExclusionBreakdown,
  getMrrSummary
};