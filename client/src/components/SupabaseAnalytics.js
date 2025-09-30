import React, { useState, useEffect } from 'react';
import './SupabaseAnalytics.css';
import MRRGrowthChart from './MRRGrowthChart';
import RetentionCard from './RetentionCard';

const SupabaseAnalytics = () => {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchAnalyticsData = async () => {
    try {
      // Use relative URL in production, localhost in development
      const apiUrl = process.env.NODE_ENV === 'production'
        ? '' // Use relative URLs in production (same domain)
        : (process.env.REACT_APP_API_URL || 'http://localhost:5050');
      const response = await fetch(`${apiUrl}/api/supabase/analytics`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setAnalyticsData(data);
      setLastUpdate(new Date());
      setError(null);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching analytics data:', error);
      setError(error.message);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalyticsData();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchAnalyticsData, 30000);

    return () => clearInterval(interval);
  }, []);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  if (loading) {
    return (
      <div className="supabase-analytics loading">
        <div className="loading-spinner"></div>
        <p>Loading Supabase Analytics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="supabase-analytics error">
        <div className="error-content">
          <span className="error-icon">⚠️</span>
          <h3>Error Loading Analytics</h3>
          <p>{error}</p>
          <button onClick={fetchAnalyticsData} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!analyticsData) {
    return (
      <div className="supabase-analytics">
        <p>No analytics data available</p>
      </div>
    );
  }

  return (
    <div className="supabase-analytics">
      {/* Header */}
      <div className="analytics-header">
        <h2>📊 Supabase Analytics</h2>
        <div className="header-meta">
          <div className="live-indicator">
            <span className="live-dot"></span>
            LIVE
          </div>
          {lastUpdate && (
            <span className="last-update">
              Last updated: {formatTime(lastUpdate)}
            </span>
          )}
        </div>
      </div>

      {/* Giant ARR Card */}
      <div className="arr-hero-card">
        <div className="arr-content">
          <div className="arr-icon">🚀</div>
          <div className="arr-value">
            {formatCurrency(analyticsData.official_mrr.total * 12)}
          </div>
          <div className="arr-label">Annual Recurring Revenue (ARR)</div>
          <div className="arr-subtitle">
            Based on {formatCurrency(analyticsData.official_mrr.total)} MRR
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="key-metrics">
        <div className="metric-card primary">
          <div className="metric-icon">💎</div>
          <div className="metric-content">
            <div className="metric-value">
              {formatCurrency(analyticsData.official_mrr.total)}
            </div>
            <div className="metric-label">Official MRR</div>
            <div className="metric-subtitle">
              {analyticsData.official_mrr.subscriptions_count} paying customers
            </div>
          </div>
        </div>

        <div className="metric-card secondary">
          <div className="metric-icon">🔄</div>
          <div className="metric-content">
            <div className="metric-value">
              {formatCurrency(analyticsData.trial_pipeline.potential_mrr)}
            </div>
            <div className="metric-label">Trial Pipeline</div>
            <div className="metric-subtitle">
              {analyticsData.trial_pipeline.active_trials} active trials
            </div>
          </div>
        </div>

        <div className="metric-card tertiary">
          <div className="metric-icon">🎯</div>
          <div className="metric-content">
            <div className="metric-value">
              {formatCurrency(analyticsData.summary.conversion_opportunity)}
            </div>
            <div className="metric-label">Total Opportunity</div>
            <div className="metric-subtitle">
              MRR + Trial Potential
            </div>
          </div>
        </div>

        <div className="metric-card info">
          <div className="metric-icon">📈</div>
          <div className="metric-content">
            <div className="metric-value">
              {formatCurrency(analyticsData.official_mrr.average_per_customer)}
            </div>
            <div className="metric-label">Avg. Customer Value</div>
            <div className="metric-subtitle">
              Monthly per customer
            </div>
          </div>
        </div>
      </div>

      {/* Data Tables */}
      <div className="analytics-tables">
        {/* Paying Subscriptions */}
        <div className="table-section">
          <div className="table-header">
            <h3>💳 Paying Customers ({analyticsData.paying_subscriptions.length})</h3>
            <div className="table-summary">
              Total: {formatCurrency(analyticsData.official_mrr.total)}
            </div>
          </div>
          <div className="table-container">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Monthly Value</th>
                  <th>Start Date</th>
                </tr>
              </thead>
              <tbody>
                {analyticsData.paying_subscriptions.map((subscription, index) => (
                  <tr key={subscription.stripe_subscription_id}>
                    <td>
                      <div className="customer-info">
                        <div className="customer-name">
                          {subscription.customer_display}
                        </div>
                        <div className="customer-email">
                          {subscription.customer_email}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${subscription.subscription_status}`}>
                        {subscription.subscription_status === 'active' && '✅'}
                        {subscription.subscription_status === 'past_due' && '⚠️'}
                        {subscription.subscription_status}
                      </span>
                    </td>
                    <td className="amount">
                      {formatCurrency(subscription.monthly_total)}
                    </td>
                    <td className="date">
                      {subscription.created_formatted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trial Subscriptions */}
        <div className="table-section">
          <div className="table-header">
            <h3>🔄 Trial Customers ({analyticsData.trial_subscriptions.length})</h3>
            <div className="table-summary">
              Potential: {formatCurrency(analyticsData.trial_pipeline.potential_mrr)}
            </div>
          </div>
          <div className="table-container">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Trial Status</th>
                  <th>Potential Value</th>
                  <th>Trial Ends</th>
                  <th>Days Left</th>
                </tr>
              </thead>
              <tbody>
                {analyticsData.trial_subscriptions.map((trial, index) => (
                  <tr key={trial.stripe_subscription_id} className={trial.is_expired ? 'expired' : ''}>
                    <td>
                      <div className="customer-info">
                        <div className="customer-name">
                          {trial.customer_display}
                        </div>
                        <div className="customer-email">
                          {trial.customer_email}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${trial.is_expired ? 'expired' : 'trialing'}`}>
                        {trial.is_expired ? '❌ Expired' : '🔄 Active'}
                      </span>
                    </td>
                    <td className="amount">
                      {formatCurrency(trial.monthly_total)}
                    </td>
                    <td className="date">
                      {trial.trial_end_formatted}
                    </td>
                    <td className={`days-remaining ${trial.days_remaining <= 1 ? 'urgent' : trial.days_remaining <= 3 ? 'warning' : 'normal'}`}>
                      {trial.is_expired ? 'Expired' : `${trial.days_remaining} days`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {analyticsData.trial_subscriptions.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">🎉</div>
                <p>No active trials</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Analytics Charts Section */}
      <div className="analytics-charts-section">
        <div className="chart-container">
          <MRRGrowthChart />
        </div>
        <div className="retention-container">
          <RetentionCard />
        </div>
      </div>

      {/* Summary Stats */}
      <div className="summary-stats">
        <div className="stat-item">
          <span className="stat-label">Active Trials:</span>
          <span className="stat-value">{analyticsData.trial_pipeline.active_trials}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Expired Trials:</span>
          <span className="stat-value">{analyticsData.trial_pipeline.expired_trials}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Total Active Subscriptions:</span>
          <span className="stat-value">{analyticsData.summary.total_active_subscriptions}</span>
        </div>
      </div>
    </div>
  );
};

export default SupabaseAnalytics;