import React, { useState, useEffect } from 'react';
import './RetentionCard.css';

const RetentionCard = () => {
  const [weeklyData, setWeeklyData] = useState(null);
  const [monthlyData, setMonthlyData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedSection, setExpandedSection] = useState(null); // 'weekly' or 'monthly'

  useEffect(() => {
    fetchRetentionData();
  }, []);

  const fetchRetentionData = async () => {
    try {
      const apiUrl = process.env.NODE_ENV === 'production'
        ? ''
        : (process.env.REACT_APP_API_URL || 'http://localhost:5050');

      // Fetch both weekly and monthly retention data in parallel
      const [weeklyResponse, monthlyResponse] = await Promise.all([
        fetch(`${apiUrl}/api/retention/weekly`),
        fetch(`${apiUrl}/api/retention/monthly`)
      ]);

      if (!weeklyResponse.ok || !monthlyResponse.ok) {
        throw new Error('Failed to fetch retention data');
      }

      const weekly = await weeklyResponse.json();
      const monthly = await monthlyResponse.json();

      setWeeklyData(weekly);
      setMonthlyData(monthly);
      setError(null);
    } catch (error) {
      console.error('Error fetching retention data:', error);
      setError(error.message);

      // Set mock data for demo when API fails
      setWeeklyData({
        retention_rate: 92.5,
        metrics: { churned_customers: 3, previous_period_customers: 40, new_customers: 5 },
        churn_details: [
          { customer_name: 'Demo Customer 1', customer_email: 'demo1@example.com', monthly_value: 49.99 },
          { customer_name: 'Demo Customer 2', customer_email: 'demo2@example.com', monthly_value: 29.99 }
        ]
      });
      setMonthlyData({
        retention_rate: 88.2,
        metrics: { churned_customers: 8, previous_period_customers: 68, new_customers: 12 },
        churn_details: [
          { customer_name: 'Demo Customer 3', customer_email: 'demo3@example.com', monthly_value: 99.99 },
          { customer_name: 'Demo Customer 4', customer_email: 'demo4@example.com', monthly_value: 49.99 }
        ]
      });
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

  const toggleExpandedSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  if (loading) {
    return (
      <div className="retention-card loading">
        <div className="retention-skeleton">
          <div className="skeleton-header"></div>
          <div className="skeleton-metrics"></div>
          <div className="skeleton-metrics"></div>
        </div>
        <div className="loading-text">Loading retention data...</div>
      </div>
    );
  }

  return (
    <div className="retention-card">
      <div className="retention-header">
        <h3>🔄 Customer Retention</h3>
        <div className="retention-subtitle">Weekly & Monthly trends</div>
      </div>

      {error && (
        <div className="retention-error">
          <span className="error-icon">⚠️</span>
          <span>Using demo data - API unavailable</span>
        </div>
      )}

      <div className="retention-metrics">
        {/* Weekly Retention */}
        <div className="retention-metric-card" onClick={() => toggleExpandedSection('weekly')}>
          <div className="metric-header">
            <div className="metric-icon">📅</div>
            <div className="metric-info">
              <div className="metric-label">Week-over-Week</div>
              <div className="metric-period">Last 7 days vs previous 7 days</div>
            </div>
          </div>
          <div className="metric-value-container">
            <div
              className="retention-rate"
              style={{ color: getRetentionColor(weeklyData?.retention_rate || 0) }}
            >
              {getRetentionIcon(weeklyData?.retention_rate || 0)} {weeklyData?.retention_rate?.toFixed(1) || '0.0'}%
            </div>
            <div className="metric-summary">
              {weeklyData?.metrics?.churned_customers || 0} churned
              {weeklyData?.metrics?.churned_customers > 0 && (
                <span className="churn-indicator">
                  {weeklyData.metrics.churned_customers === 1 ? ' customer' : ' customers'}
                </span>
              )}
            </div>
          </div>
          <div className="expand-indicator">
            {expandedSection === 'weekly' ? '▼' : '▶'}
          </div>
        </div>

        {/* Weekly Details */}
        {expandedSection === 'weekly' && weeklyData && (
          <div className="retention-details">
            <div className="details-header">
              <h4>Weekly Churn Details</h4>
              <div className="details-stats">
                Previous: {weeklyData.metrics.previous_period_customers} •
                Churned: {weeklyData.metrics.churned_customers} •
                New: {weeklyData.metrics.new_customers}
              </div>
            </div>
            {weeklyData.churn_details.length > 0 ? (
              <div className="churn-list">
                {weeklyData.churn_details.slice(0, 5).map((customer, index) => (
                  <div key={index} className="churn-item">
                    <div className="customer-info">
                      <div className="customer-name">{customer.customer_name || 'Unknown'}</div>
                      <div className="customer-email">{customer.customer_email}</div>
                    </div>
                    <div className="churn-value">
                      {formatCurrency(customer.monthly_value)}
                    </div>
                  </div>
                ))}
                {weeklyData.churn_details.length > 5 && (
                  <div className="churn-more">
                    +{weeklyData.churn_details.length - 5} more customers
                  </div>
                )}
              </div>
            ) : (
              <div className="no-churn">🎉 No customers churned this week!</div>
            )}
          </div>
        )}

        {/* Monthly Retention */}
        <div className="retention-metric-card" onClick={() => toggleExpandedSection('monthly')}>
          <div className="metric-header">
            <div className="metric-icon">📊</div>
            <div className="metric-info">
              <div className="metric-label">Month-over-Month</div>
              <div className="metric-period">This month vs last month</div>
            </div>
          </div>
          <div className="metric-value-container">
            <div
              className="retention-rate"
              style={{ color: getRetentionColor(monthlyData?.retention_rate || 0) }}
            >
              {getRetentionIcon(monthlyData?.retention_rate || 0)} {monthlyData?.retention_rate?.toFixed(1) || '0.0'}%
            </div>
            <div className="metric-summary">
              {monthlyData?.metrics?.churned_customers || 0} churned
              {monthlyData?.metrics?.churned_customers > 0 && (
                <span className="churn-indicator">
                  {monthlyData.metrics.churned_customers === 1 ? ' customer' : ' customers'}
                </span>
              )}
            </div>
          </div>
          <div className="expand-indicator">
            {expandedSection === 'monthly' ? '▼' : '▶'}
          </div>
        </div>

        {/* Monthly Details */}
        {expandedSection === 'monthly' && monthlyData && (
          <div className="retention-details">
            <div className="details-header">
              <h4>Monthly Churn Details</h4>
              <div className="details-stats">
                Previous: {monthlyData.metrics.previous_period_customers} •
                Churned: {monthlyData.metrics.churned_customers} •
                New: {monthlyData.metrics.new_customers}
              </div>
            </div>
            {monthlyData.churn_details.length > 0 ? (
              <div className="churn-list">
                {monthlyData.churn_details.slice(0, 5).map((customer, index) => (
                  <div key={index} className="churn-item">
                    <div className="customer-info">
                      <div className="customer-name">{customer.customer_name || 'Unknown'}</div>
                      <div className="customer-email">{customer.customer_email}</div>
                    </div>
                    <div className="churn-value">
                      {formatCurrency(customer.monthly_value)}
                    </div>
                  </div>
                ))}
                {monthlyData.churn_details.length > 5 && (
                  <div className="churn-more">
                    +{monthlyData.churn_details.length - 5} more customers
                  </div>
                )}
              </div>
            ) : (
              <div className="no-churn">🎉 No customers churned this month!</div>
            )}
          </div>
        )}
      </div>

      <div className="retention-footer">
        <div className="data-source">
          {error ? (
            <span className="demo-data">⚠️ Demo data - API unavailable</span>
          ) : (
            <span className="live-data">✅ Live retention analysis</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default RetentionCard;