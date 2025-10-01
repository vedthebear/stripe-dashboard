import React, { useState, useEffect } from 'react';
import './TrialConversionCard.css';

const TrialConversionCard = () => {
  const [conversionData, setConversionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState('7'); // Default to 7-day
  const [isExpanded, setIsExpanded] = useState(false);

  const periods = [
    { value: '7', label: '7-Day' },
    { value: '14', label: '14-Day' },
    { value: '30', label: '30-Day' }
  ];

  useEffect(() => {
    fetchConversionData(selectedPeriod);
  }, [selectedPeriod]);

  const fetchConversionData = async (period) => {
    try {
      setLoading(true);
      const apiUrl = process.env.NODE_ENV === 'production'
        ? ''
        : (process.env.REACT_APP_API_URL || 'http://localhost:5050');

      const response = await fetch(`${apiUrl}/api/trial-conversion/calculate?period=${period}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setConversionData(data);
      setError(null);
    } catch (error) {
      console.error('Error fetching trial conversion data:', error);
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

  const getConversionColor = (rate) => {
    if (rate >= 80) return '#16a34a'; // Green for excellent
    if (rate >= 60) return '#22c55e'; // Light green for good
    if (rate >= 40) return '#eab308'; // Yellow for okay
    if (rate >= 20) return '#f59e0b'; // Orange for concerning
    return '#dc2626'; // Red for poor
  };

  const getConversionIcon = (rate) => {
    if (rate >= 60) return '✅';
    if (rate >= 40) return '⚠️';
    return '🚨';
  };

  const handlePeriodChange = (period) => {
    setSelectedPeriod(period);
    setIsExpanded(false); // Collapse when changing periods
  };

  if (loading) {
    return (
      <div className="trial-conversion-card loading">
        <div className="conversion-skeleton">
          <div className="skeleton-header"></div>
          <div className="skeleton-metrics"></div>
        </div>
        <div className="loading-text">Loading trial conversion data...</div>
      </div>
    );
  }

  if (error) {
    // Check if error indicates no historical data available
    if (error.includes('no data') || error.includes('No snapshots found') ||
        (conversionData && conversionData.metrics && conversionData.metrics.total_trials === 0)) {
      return (
        <div className="trial-conversion-card">
          <div className="conversion-header">
            <h3>🎯 Trial Conversion</h3>
            <div className="conversion-subtitle">Track trial-to-paid conversion rate</div>
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
      <div className="trial-conversion-card error">
        <div className="error-content">
          <span className="error-icon">⚠️</span>
          <h3>Error Loading Trial Conversion</h3>
          <p>{error}</p>
          <button onClick={() => fetchConversionData(selectedPeriod)} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!conversionData) {
    return (
      <div className="trial-conversion-card">
        <p>No trial conversion data available</p>
      </div>
    );
  }

  // Check if we have no historical data for the selected period
  if (conversionData.metrics && conversionData.metrics.total_trials === 0) {
    return (
      <div className="trial-conversion-card">
        <div className="conversion-header">
          <h3>🎯 Trial Conversion</h3>
          <div className="conversion-subtitle">Track trial-to-paid conversion rate</div>
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

  const conversionRate = conversionData.conversion_rate || 0;
  const converted = conversionData.trial_details?.filter(t => t.converted) || [];
  const unconverted = conversionData.trial_details?.filter(t => !t.converted) || [];

  return (
    <div className="trial-conversion-card">
      {/* Header */}
      <div className="conversion-header">
        <h3>🎯 Trial Conversion</h3>
        <div className="conversion-subtitle">Track trial-to-paid conversion rate</div>
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

      {/* Conversion Rate Display */}
      <div
        className="conversion-rate-display"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="conversion-rate-main">
          <div
            className="conversion-rate-number"
            style={{ color: getConversionColor(conversionRate) }}
          >
            {conversionRate.toFixed(1)}%
          </div>
          <div className="conversion-icon-large">
            {getConversionIcon(conversionRate)}
          </div>
        </div>
        <div className="conversion-rate-subtitle">
          {conversionData.metrics.converted_trials} of {conversionData.metrics.total_trials} trials converted
          {unconverted.length > 0 && ` • ${unconverted.length} canceled`}
        </div>
        <div className="expand-hint">
          Click to {isExpanded ? 'hide' : 'show'} details {isExpanded ? '▲' : '▼'}
        </div>
      </div>

      {/* Expandable Trial List */}
      {isExpanded && (
        <div className="trial-details">
          <div className="details-period">
            Trials from {conversionData.period_labels.start} to {conversionData.period_labels.end}
          </div>

          {/* Converted Trials */}
          {converted.length > 0 && (
            <div className="trial-section">
              <div className="section-header converted">
                <span className="section-icon">✅</span>
                <span className="section-title">Converted ({converted.length})</span>
                <span className="section-total">{formatCurrency(converted.reduce((sum, t) => sum + t.monthly_value, 0))}/mo</span>
              </div>
              <div className="table-container">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Status</th>
                      <th>Monthly Value</th>
                      <th>Converted On</th>
                    </tr>
                  </thead>
                  <tbody>
                    {converted.map((trial, index) => (
                      <tr key={index} className="converted-row">
                        <td>
                          <div className="customer-info">
                            <div className="customer-name">{trial.customer_display}</div>
                            <div className="customer-email">{trial.customer_email}</div>
                          </div>
                        </td>
                        <td>
                          <span className="status-badge converted">✅ Converted</span>
                        </td>
                        <td className="amount converted-amount">
                          {formatCurrency(trial.monthly_value)}
                        </td>
                        <td className="date">
                          {trial.conversion_date}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Canceled Trials (didn't convert) */}
          {unconverted.length > 0 && (
            <div className="trial-section">
              <div className="section-header unconverted">
                <span className="section-icon">❌</span>
                <span className="section-title">Canceled ({unconverted.length})</span>
                <span className="section-total">{formatCurrency(unconverted.reduce((sum, t) => sum + t.monthly_value, 0))}/mo lost</span>
              </div>
              <div className="table-container">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Status</th>
                      <th>Potential Value</th>
                      <th>Trial Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unconverted.map((trial, index) => (
                      <tr key={index} className="unconverted-row">
                        <td>
                          <div className="customer-info">
                            <div className="customer-name">{trial.customer_display}</div>
                            <div className="customer-email">{trial.customer_email}</div>
                          </div>
                        </td>
                        <td>
                          <span className="status-badge unconverted">❌ Canceled</span>
                        </td>
                        <td className="amount unconverted-amount">
                          {formatCurrency(trial.monthly_value)}
                        </td>
                        <td className="date">
                          {trial.first_trial_date}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Summary Stats */}
          <div className="conversion-summary">
            <div className="summary-stat">
              <div className="summary-label">Total Trials</div>
              <div className="summary-value">{conversionData.metrics.total_trials}</div>
            </div>
            <div className="summary-stat success">
              <div className="summary-label">Converted</div>
              <div className="summary-value">{conversionData.metrics.converted_trials}</div>
            </div>
            <div className="summary-stat warning">
              <div className="summary-label">Canceled</div>
              <div className="summary-value">{conversionData.metrics.unconverted_trials}</div>
            </div>
            <div className="summary-stat info">
              <div className="summary-label">Conversion Rate</div>
              <div className="summary-value">{conversionRate.toFixed(0)}%</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrialConversionCard;