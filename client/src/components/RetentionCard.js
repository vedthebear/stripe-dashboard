import React, { useState, useEffect } from 'react';
import './RetentionCard.css';

const RetentionCard = () => {
  const [retentionData, setRetentionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState('3'); // Default to 3-day
  const [isExpanded, setIsExpanded] = useState(false);

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

  const retentionRate = retentionData.retention_rate || 0;
  const churned = retentionData.subscription_details?.filter(s => s.status === 'churned') || [];
  const retained = retentionData.subscription_details?.filter(s => s.status === 'retained') || [];

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
            style={{ color: getRetentionColor(retentionRate) }}
          >
            {retentionRate.toFixed(1)}%
          </div>
          <div className="retention-icon-large">
            {getRetentionIcon(retentionRate)}
          </div>
        </div>
        <div className="retention-rate-subtitle">
          {retentionData.metrics.retained_customers} of {retentionData.metrics.previous_period_customers} retained
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
                    </tr>
                  </thead>
                  <tbody>
                    {churned.map((sub, index) => (
                      <tr key={index} className="churned-row">
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
                      </tr>
                    ))}
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
                    </tr>
                  </thead>
                  <tbody>
                    {retained.map((sub, index) => (
                      <tr key={index} className="retained-row">
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Summary Stats */}
          <div className="retention-summary">
            <div className="summary-stat">
              <div className="summary-label">Previous Period</div>
              <div className="summary-value">{retentionData.metrics.previous_period_customers}</div>
            </div>
            <div className="summary-stat success">
              <div className="summary-label">Retained</div>
              <div className="summary-value">{retentionData.metrics.retained_customers}</div>
            </div>
            <div className="summary-stat danger">
              <div className="summary-label">Churned</div>
              <div className="summary-value">{retentionData.metrics.churned_customers}</div>
            </div>
            <div className="summary-stat info">
              <div className="summary-label">New</div>
              <div className="summary-value">{retentionData.metrics.new_customers}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RetentionCard;