const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function getPacificDate() {
  // Get current date in Pacific timezone (America/Los_Angeles)
  const now = new Date();
  const pacificDateStr = now.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  // Parse MM/DD/YYYY format and convert to YYYY-MM-DD
  const [month, day, year] = pacificDateStr.split(/[,/\s]+/).filter(Boolean);
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function getPacificDateDaysAgo(days) {
  // Get a date X days ago in Pacific timezone
  const now = new Date();
  const pacificDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  pacificDate.setDate(pacificDate.getDate() - days);

  const year = pacificDate.getFullYear();
  const month = String(pacificDate.getMonth() + 1).padStart(2, '0');
  const day = String(pacificDate.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substr(2, 9);
  const { period = '7' } = req.query; // Default to 7-day

  const daysMap = {
    '7': 7,
    '14': 14,
    '30': 30
  };

  const days = daysMap[period] || 7;
  const lookbackDays = days + 1; // Add 1 day as per requirement

  console.log(`📊 [${requestId}] Trial Conversion API request for ${days}-day period (lookback: ${lookbackDays} days)`);

  try {
    if (!supabase) {
      return res.status(500).json({
        error: 'Supabase not configured',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    const todayStr = getPacificDate();
    const lookbackDateStr = getPacificDateDaysAgo(lookbackDays);

    console.log(`📈 [${requestId}] Calculating ${days}-day trial conversion:`);
    console.log(`   Today: ${todayStr}`);
    console.log(`   Lookback period: ${lookbackDateStr} to ${todayStr} (${lookbackDays} days)`);

    // Check if we have snapshots for the lookback date
    const { data: lookbackCheck, error: lookbackError } = await supabase
      .from('customer_retention_snapshots')
      .select('date')
      .eq('date', lookbackDateStr)
      .limit(1);

    if (lookbackError) {
      console.error(`❌ [${requestId}] Error checking lookback date:`, lookbackError);
      throw lookbackError;
    }

    // If no data exists for the lookback date, return no data
    if (!lookbackCheck || lookbackCheck.length === 0) {
      console.log(`   ⚠️ No snapshots found for ${lookbackDateStr} - insufficient historical data`);
      return res.json({
        period: `${days}day`,
        period_days: days,
        lookback_days: lookbackDays,
        conversion_rate: 0,
        metrics: {
          total_trials: 0,
          converted_trials: 0,
          unconverted_trials: 0
        },
        period_labels: {
          start: lookbackDateStr,
          end: todayStr
        },
        trial_details: [],
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    // Step 1: Find all distinct subscription_ids where is_trial_counted = true in the last x+1 days
    const { data: trialSnapshots, error: trialError } = await supabase
      .from('customer_retention_snapshots')
      .select('stripe_subscription_id, customer_email, customer_name, monthly_value, date')
      .eq('is_trial_counted', true)
      .gte('date', lookbackDateStr)
      .lte('date', todayStr);

    if (trialError) {
      console.error(`❌ [${requestId}] Error fetching trial snapshots:`, trialError);
      throw trialError;
    }

    // Get unique subscription IDs
    const uniqueTrialSubscriptions = {};
    trialSnapshots.forEach(snapshot => {
      if (!uniqueTrialSubscriptions[snapshot.stripe_subscription_id]) {
        uniqueTrialSubscriptions[snapshot.stripe_subscription_id] = {
          stripe_subscription_id: snapshot.stripe_subscription_id,
          customer_email: snapshot.customer_email,
          customer_name: snapshot.customer_name,
          customer_display: snapshot.customer_name || snapshot.customer_email || 'Unknown',
          monthly_value: parseFloat(snapshot.monthly_value),
          first_trial_date: snapshot.date
        };
      } else {
        // Keep the earliest trial date
        if (snapshot.date < uniqueTrialSubscriptions[snapshot.stripe_subscription_id].first_trial_date) {
          uniqueTrialSubscriptions[snapshot.stripe_subscription_id].first_trial_date = snapshot.date;
        }
      }
    });

    const trialSubscriptionIds = Object.keys(uniqueTrialSubscriptions);
    const totalTrials = trialSubscriptionIds.length;

    console.log(`   Found ${totalTrials} unique trials in period`);

    if (totalTrials === 0) {
      return res.json({
        period: `${days}day`,
        period_days: days,
        lookback_days: lookbackDays,
        conversion_rate: 0,
        metrics: {
          total_trials: 0,
          converted_trials: 0,
          unconverted_trials: 0
        },
        period_labels: {
          start: lookbackDateStr,
          end: todayStr
        },
        trial_details: [],
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    // Step 2: For each trial subscription, check if is_counted ever became true AFTER they were a trial
    // Exclude trials that are still currently active (trialing status)
    const conversions = [];
    const unconverted = [];

    for (const subscriptionId of trialSubscriptionIds) {
      const trialInfo = uniqueTrialSubscriptions[subscriptionId];
      const firstTrialDate = trialInfo.first_trial_date;

      // Check if subscription is still in trial status today
      const { data: currentStatus, error: statusError } = await supabase
        .from('customer_retention_snapshots')
        .select('subscription_status')
        .eq('stripe_subscription_id', subscriptionId)
        .eq('date', todayStr)
        .eq('subscription_status', 'trialing')
        .limit(1);

      if (statusError) {
        console.error(`❌ [${requestId}] Error checking current status for ${subscriptionId}:`, statusError);
        continue;
      }

      // Skip if subscription is still in trial today
      if (currentStatus && currentStatus.length > 0) {
        console.log(`   Skipping ${subscriptionId} - still in trial`);
        continue;
      }

      // Check if this subscription ever had is_counted = true after the trial date
      const { data: conversionSnapshots, error: conversionError } = await supabase
        .from('customer_retention_snapshots')
        .select('date, is_counted')
        .eq('stripe_subscription_id', subscriptionId)
        .eq('is_counted', true)
        .gte('date', firstTrialDate)
        .order('date', { ascending: true })
        .limit(1);

      if (conversionError) {
        console.error(`❌ [${requestId}] Error checking conversion for ${subscriptionId}:`, conversionError);
        continue;
      }

      const converted = conversionSnapshots && conversionSnapshots.length > 0;

      const subscriptionDetail = {
        ...trialInfo,
        converted: converted,
        conversion_date: converted ? conversionSnapshots[0].date : null
      };

      if (converted) {
        conversions.push(subscriptionDetail);
      } else {
        unconverted.push(subscriptionDetail);
      }
    }

    const convertedCount = conversions.length;
    const unconvertedCount = unconverted.length;
    const conversionRate = totalTrials > 0 ? (convertedCount / totalTrials) * 100 : 0;

    // Sort by monthly value descending
    conversions.sort((a, b) => b.monthly_value - a.monthly_value);
    unconverted.sort((a, b) => b.monthly_value - a.monthly_value);

    const responseData = {
      period: `${days}day`,
      period_days: days,
      lookback_days: lookbackDays,
      conversion_rate: Math.round(conversionRate * 100) / 100,
      metrics: {
        total_trials: totalTrials,
        converted_trials: convertedCount,
        unconverted_trials: unconvertedCount
      },
      period_labels: {
        start: lookbackDateStr,
        end: todayStr
      },
      trial_details: [...conversions, ...unconverted],
      requestId,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ [${requestId}] ${days}-day trial conversion calculated: ${conversionRate.toFixed(2)}% conversion rate`);
    console.log(`   Total Trials: ${totalTrials}, Converted: ${convertedCount}, Unconverted: ${unconvertedCount}`);

    res.json(responseData);

  } catch (error) {
    console.error(`❌ [${requestId}] Trial Conversion API error:`, error.message);
    res.status(500).json({
      error: 'Failed to calculate trial conversion',
      details: error.message,
      requestId,
      timestamp: new Date().toISOString()
    });
  }
}