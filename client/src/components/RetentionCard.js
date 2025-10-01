import React, { useState, useEffect } from 'react';
import './RetentionCard.css';

const RetentionCard = () => {
  const [retentionData, setRetentionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState('3'); // Default to 3-day
  const [isExpanded, setIsExpanded] = useState(false);
  const [ignoredSubscriptions, setIgnoredSubscriptions] = useState(new Set());

  const periods = [
    { value: '1', label: '1-Day' },
    { value: '3', label: '3-Day' },
    { value: '7', label: 'Weekly' },
    { value: '14', label: 'Bi-Weekly' },
    { value: '30', label: 'Monthly' }
  ];

  useEffect(() => {
    fetchRetentionData(selectedPeriod);
  }, [selectedPeriod]);

  const fetchRetentionData = async (period) => {
    try {
      setLoading(true);
      const apiUrl = process.env.NODE_ENV === 'production'
        ? ''
        : (process.env.REACT_APP_API_URL || 'http://localhost:5050');

      const response = await fetch(`${apiUrl}/api/retention/calculate?period=${period}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setRetentionData(data);
      setError(null);
    } catch (error) {
      console.error('Error fetching retention data:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getRetentionColor = (rate) => {
    if (rate >= 95) return '#16a34a'; // Green for excellent
    if (rate >= 90) return '#22c55e'; // Light green for good
    if (rate >= 85) return '#eab308'; // Yellow for okay
    if (rate >= 80) return '#f59e0b'; // Orange for concerning
    return '#dc2626'; // Red for poor
  };

  const getRetentionIcon = (rate) => {
    if (rate >= 90) return '✅';
    if (rate >= 80) return '⚠️';
    return '🚨';
  };

  const handlePeriodChange = (period) => {
    setSelectedPeriod(period);
    setIsExpanded(false); // Collapse when changing periods
    setIgnoredSubscriptions(new Set()); // Reset ignored subscriptions when changing periods
  };

  const toggleIgnoreSubscription = (subscriptionId) => {
    setIgnoredSubscriptions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(subscriptionId)) {
        newSet.delete(subscriptionId);
      } else {
        newSet.add(subscriptionId);
      }
      return newSet;
    });
  };

  if (loading) {
    return (
      <div className="retention-card loading">
        <div className="retention-skeleton">
          <div className="skeleton-header"></div>
          <div className="skeleton-metrics"></div>
        </div>
        <div className="loading-text">Loading retention data...</div>
      </div>
    );
  }

  if (error) {
    // Check if error indicates no historical data available
    if (error.includes('no data') || error.includes('No snapshots found') ||
        (retentionData && retentionData.metrics && retentionData.metrics.previous_period_customers === 0)) {
      return (
        <div className="retention-card">
          <div className="retention-header">
            <h3>🔄 Customer Retention</h3>
            <div className="retention-subtitle">Track subscription retention over time</div>
          </div>
          <div className="period-toggle">
            {periods.map(period => (
              <button
                key={period.value}
                className={`period-button ${selectedPeriod === period.value ? 'active' : ''}`}
                onClick={() => handlePeriodChange(period.value)}
              >
                {period.label}
              </button>
            ))}
          </div>
          <div className="no-data-message">
            <div className="no-data-icon">📊</div>
            <div className="no-data-title">No Data Yet</div>
            <div className="no-data-subtitle">Backfill in Progress<br />(I will get to it shortly I swear)</div>
          </div>
        </div>
      );
    }

    return (
      <div className="retention-card error">
        <div className="error-content">
          <span className="error-icon">⚠️</span>
          <h3>Error Loading Retention</h3>
          <p>{error}</p>
          <button onClick={() => fetchRetentionData(selectedPeriod)} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!retentionData) {
    return (
      <div className="retention-card">
        <p>No retention data available</p>
      </div>
    );
  }

  // Check if we have no historical data for the selected period
  if (retentionData.metrics && retentionData.metrics.previous_period_customers === 0) {
    return (
      <div className="retention-card">
        <div className="retention-header">
          <h3>🔄 Customer Retention</h3>
          <div className="retention-subtitle">Track subscription retention over time</div>
        </div>
        <div className="period-toggle">
          {periods.map(period => (
            <button
              key={period.value}
              className={`period-button ${selectedPeriod === period.value ? 'active' : ''}`}
              onClick={() => handlePeriodChange(period.value)}
            >
              {period.label}
            </button>
          ))}
        </div>
        <div className="no-data-message">
          <div className="no-data-icon">📊</div>
          <div className="no-data-title">No Data Yet</div>
          <div className="no-data-subtitle">Backfill in Progress<br />(I will get to it shortly I swear)</div>
        </div>
      </div>
    );
  }

  // Filter out ignored subscriptions and recalculate metrics
  const retained = retentionData.subscription_details?.filter(s => s.status === 'retained' && !ignoredSubscriptions.has(s.stripe_subscription_id)) || [];
  const churned = retentionData.subscription_details?.filter(s => s.status === 'churned' && !ignoredSubscriptions.has(s.stripe_subscription_id)) || [];

  const adjustedTotalSubscriptions = retained.length + churned.length;
  const adjustedRetentionRate = adjustedTotalSubscriptions > 0 ? (retained.length / adjustedTotalSubscriptions) * 100 : 0;

  return (
    <div className="retention-card">
      {/* Header */}
      <div className="retention-header">
        <h3>🔄 Customer Retention</h3>
        <div className="retention-subtitle">Track subscription retention over time</div>
      </div>

      {/* Period Toggle */}
      <div className="period-toggle">
        {periods.map(period => (
          <button
            key={period.value}
            className={`period-button ${selectedPeriod === period.value ? 'active' : ''}`}
            onClick={() => handlePeriodChange(period.value)}
          >
            {period.label}
          </button>
        ))}
      </div>

      {/* Retention Rate Display */}
      <div
        className="retention-rate-display"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="retention-rate-main">
          <div
            className="retention-rate-number"
            style={{ color: getRetentionColor(adjustedRetentionRate) }}
          >
            {adjustedRetentionRate.toFixed(1)}%
          </div>
          <div className="retention-icon-large">
            {getRetentionIcon(adjustedRetentionRate)}
          </div>
        </div>
        <div className="retention-rate-subtitle">
          {retained.length} of {adjustedTotalSubscriptions} retained
          {churned.length > 0 && ` • ${churned.length} churned`}
        </div>
        <div className="expand-hint">
          Click to {isExpanded ? 'hide' : 'show'} details {isExpanded ? '▲' : '▼'}
        </div>
      </div>

      {/* Expandable Subscription List */}
      {isExpanded && (
        <div className="subscription-details">
          <div className="details-period">
            Comparing {retentionData.period_labels.previous} to {retentionData.period_labels.current}
          </div>

          {/* Churned Customers */}
          {churned.length > 0 && (
            <div className="subscription-section">
              <div className="section-header churned">
                <span className="section-icon">❌</span>
                <span className="section-title">Churned ({churned.length})</span>
                <span className="section-total">{formatCurrency(churned.reduce((sum, s) => sum + s.monthly_value, 0))}</span>
              </div>
              <div className="table-container">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Status</th>
                      <th>Monthly Value</th>
                      <th>Include</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retentionData.subscription_details?.filter(s => s.status === 'churned').map((sub, index) => {
                      const isIgnored = ignoredSubscriptions.has(sub.stripe_subscription_id);
                      return (
                        <tr key={index} className={`churned-row ${isIgnored ? 'ignored-row' : ''}`}>
                          <td>
                            <div className="customer-info">
                              <div className="customer-name">{sub.customer_display}</div>
                              <div className="customer-email">{sub.customer_email}</div>
                            </div>
                          </td>
                          <td>
                            <span className="status-badge churned">❌ Churned</span>
                          </td>
                          <td className="amount churned-amount">
                            {formatCurrency(sub.monthly_value)}
                          </td>
                          <td>
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={!isIgnored}
                                onChange={() => toggleIgnoreSubscription(sub.stripe_subscription_id)}
                              />
                              <span className="toggle-slider"></span>
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Retained Customers */}
          {retained.length > 0 && (
            <div className="subscription-section">
              <div className="section-header retained">
                <span className="section-icon">✅</span>
                <span className="section-title">Retained ({retained.length})</span>
                <span className="section-total">{formatCurrency(retained.reduce((sum, s) => sum + s.monthly_value, 0))}</span>
              </div>
              <div className="table-container">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Status</th>
                      <th>Monthly Value</th>
                      <th>Include</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retentionData.subscription_details?.filter(s => s.status === 'retained').map((sub, index) => {
                      const isIgnored = ignoredSubscriptions.has(sub.stripe_subscription_id);
                      return (
                        <tr key={index} className={`retained-row ${isIgnored ? 'ignored-row' : ''}`}>
                          <td>
                            <div className="customer-info">
                              <div className="customer-name">{sub.customer_display}</div>
                              <div className="customer-email">{sub.customer_email}</div>
                            </div>
                          </td>
                          <td>
                            <span className="status-badge retained">✅ Retained</span>
                          </td>
                          <td className="amount retained-amount">
                            {formatCurrency(sub.monthly_value)}
                          </td>
                          <td>
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={!isIgnored}
                                onChange={() => toggleIgnoreSubscription(sub.stripe_subscription_id)}
                              />
                              <span className="toggle-slider"></span>
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Summary Stats */}
          <div className="retention-summary">
            <div className="summary-stat">
              <div className="summary-label">Previous Period</div>
              <div className="summary-value">{adjustedTotalSubscriptions}</div>
            </div>
            <div className="summary-stat success">
              <div className="summary-label">Retained</div>
              <div className="summary-value">{retained.length}</div>
            </div>
            <div className="summary-stat danger">
              <div className="summary-label">Churned</div>
              <div className="summary-value">{churned.length}</div>
            </div>
            <div className="summary-stat info">
              <div className="summary-label">Retention Rate</div>
              <div className="summary-value">{adjustedRetentionRate.toFixed(0)}%</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RetentionCard;