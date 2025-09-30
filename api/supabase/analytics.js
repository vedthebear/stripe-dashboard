const { createClient } = require('@supabase/supabase-js');
const hardcodedSubscriptions = require('../../config/hardcodedSubscriptions');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`📊 [${requestId}] Supabase Analytics API request`);

  try {
    if (!supabase) {
      return res.status(500).json({
        error: 'Supabase not configured',
        requestId,
        timestamp: new Date().toISOString()
      });
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
}