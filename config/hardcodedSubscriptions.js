/**
 * Hardcoded customer subscriptions
 *
 * These are manual customers not currently in Stripe that should be included in analytics.
 *
 * To add a new hardcoded subscription, add an object with the following structure:
 * {
 *   stripe_subscription_id: 'manual_unique_identifier',
 *   customer_email: 'email@example.com',
 *   customer_name: 'Customer Name',
 *   subscription_status: 'active',
 *   monthly_total: 500,
 *   date_created: '2024-01-01T00:00:00Z',
 *   trial_end_date: null,
 *   is_active: true,
 *   is_counted: true,
 *   customer_display: 'Display Name',
 *   created_formatted: '1/1/2024'
 * }
 */

const hardcodedSubscriptions = [
  {
    stripe_subscription_id: 'manual_steph_moccio',
    customer_email: 'steph@peerspace.com',
    customer_name: 'Steph Moccio',
    subscription_status: 'active',
    monthly_total: 500,
    date_created: '2024-09-02T00:00:00Z',
    trial_end_date: null,
    is_active: true,
    is_counted: true,
    customer_display: 'Steph Moccio',
    created_formatted: '9/2/2024'
  },
  {
    stripe_subscription_id: 'manual_nick_scott',
    customer_email: 'nick@dabble.com',
    customer_name: 'Nick Scott',
    subscription_status: 'active',
    monthly_total: 1000,
    date_created: '2024-07-01T00:00:00Z',
    trial_end_date: null,
    is_active: true,
    is_counted: true,
    customer_display: 'Nick Scott',
    created_formatted: '7/1/2024'
  },
  {
    stripe_subscription_id: 'manual_moody',
    customer_email: 'moody@klarify.com',
    customer_name: 'Moody Abdul',
    subscription_status: 'active',
    monthly_total: 1100,
    date_created: '2024-07-01T00:00:00Z',
    trial_end_date: null,
    is_active: true,
    is_counted: true,
    customer_display: 'Moody Abdul',
    created_formatted: '7/1/2024'
  },
  {
    stripe_subscription_id: 'manual_speakers',
    customer_email: 'tim@speakerscorner.com',
    customer_name: 'Tim',
    subscription_status: 'active',
    monthly_total: 2500,
    date_created: '2024-07-01T00:00:00Z',
    trial_end_date: null,
    is_active: true,
    is_counted: true,
    customer_display: 'Tim',
    created_formatted: '7/1/2024'
  },
  {
    stripe_subscription_id: 'ken',
    customer_email: 'ken.colton@medal.tv',
    customer_name: 'Ken',
    subscription_status: 'active',
    monthly_total: 2000,
    date_created: '2024-07-01T00:00:00Z',
    trial_end_date: null,
    is_active: true,
    is_counted: true,
    customer_display: 'Michael',
    created_formatted: '7/1/2024'
  }
];

module.exports = hardcodedSubscriptions;