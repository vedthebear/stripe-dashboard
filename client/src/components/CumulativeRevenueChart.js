import React, { useState, useEffect, useCallback } from 'react';
import './CumulativeRevenueChart.css';

const CumulativeRevenueChart = () => {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHistoricalData = useCallback(async () => {
    try {
      const apiUrl = process.env.NODE_ENV === 'production'
        ? ''
        : (process.env.REACT_APP_API_URL || 'http://localhost:5050');

      const response = await fetch(`${apiUrl}/api/historical/cumulative-revenue`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setChartData(data);
      setError(null);
    } catch (error) {
      console.error('Error fetching cumulative revenue data:', error);
      setError(error.message);

      // Generate mock data for demo if API fails
      setChartData(generateMockData());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistoricalData();
  }, [fetchHistoricalData]);

  // Generate mock data for demo purposes
  const generateMockData = () => {
    const data = [];
    const today = new Date();
    let cumulative = 0;

    for (let i = 59; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);

      // Simulate daily revenue growth
      const dailyRevenue = 100 + Math.random() * 200;
      cumulative += dailyRevenue;

      data.push({
        date: date.toISOString().split('T')[0],
        cumulative_revenue: Math.round(cumulative),
        daily_revenue: Math.round(dailyRevenue)
      });
    }
    return data;
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="cumulative-chart-loading">
        <div className="chart-skeleton"></div>
        <div className="loading-text">Loading cumulative revenue...</div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="cumulative-chart-empty">
        <div className="empty-icon">💰</div>
        <div className="empty-text">No revenue data yet</div>
        <div className="empty-subtitle">Data will appear after tomorrow's sync</div>
      </div>
    );
  }

  // Chart calculations
  const width = 400;
  const height = 200;
  const padding = 40;
  const leftPadding = 60; // Extra padding for y-axis labels

  const maxRevenue = Math.max(...chartData.map(d => d.cumulative_revenue));
  const minRevenue = 0; // Always start from 0
  const revenueRange = maxRevenue || 1;

  // Generate SVG path
  const generatePath = () => {
    const points = chartData.map((d, i) => {
      const x = leftPadding + (i / (chartData.length - 1)) * (width - leftPadding - padding);
      const y = height - padding - ((d.cumulative_revenue - minRevenue) / revenueRange) * (height - 2 * padding);
      return `${x},${y}`;
    });
    return `M${points.join('L')}`;
  };

  // Generate area path
  const generateAreaPath = () => {
    const points = chartData.map((d, i) => {
      const x = leftPadding + (i / (chartData.length - 1)) * (width - leftPadding - padding);
      const y = height - padding - ((d.cumulative_revenue - minRevenue) / revenueRange) * (height - 2 * padding);
      return `${x},${y}`;
    });

    const firstPoint = points[0].split(',');
    const lastPoint = points[points.length - 1].split(',');

    return `M${firstPoint[0]},${height - padding}L${points.join('L')}L${lastPoint[0]},${height - padding}Z`;
  };

  // Calculate growth metrics
  const currentRevenue = chartData[chartData.length - 1]?.cumulative_revenue || 0;
  const previousRevenue = chartData[Math.max(0, chartData.length - 8)]?.cumulative_revenue || 0;
  const growth = currentRevenue - previousRevenue;

  return (
    <div className="cumulative-revenue-chart">
      <div className="chart-header">
        <div className="chart-title">
          <span className="chart-icon">💰</span>
          <div>
            <h3>Cumulative Revenue</h3>
            <p className="chart-subtitle">
              {chartData.length > 1 ? `Last ${chartData.length} days` : 'Historical tracking'}
            </p>
          </div>
        </div>
        <div className="growth-indicator">
          <div className="growth-badge positive">
            ↗️ {formatCurrency(Math.abs(growth))}
          </div>
          <div className="growth-percent">
            Last 7 days
          </div>
        </div>
      </div>

      <div className="chart-container">
        <svg width={width} height={height} className="growth-chart-svg">
          <defs>
            <linearGradient id="revenueGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(59, 130, 246, 0.3)" />
              <stop offset="100%" stopColor="rgba(59, 130, 246, 0.05)" />
            </linearGradient>
          </defs>

          {/* Y-axis grid lines and labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
            <g key={i}>
              <line
                x1={leftPadding}
                y1={height - padding - ratio * (height - 2 * padding)}
                x2={width - padding}
                y2={height - padding - ratio * (height - 2 * padding)}
                stroke="rgba(156, 163, 175, 0.2)"
                strokeWidth="1"
              />
              <text
                x={leftPadding - 10}
                y={height - padding - ratio * (height - 2 * padding) + 4}
                fontSize="11"
                fill="#9CA3AF"
                textAnchor="end"
              >
                {formatCurrency(minRevenue + ratio * revenueRange)}
              </text>
            </g>
          ))}

          {/* Area fill */}
          <path
            d={generateAreaPath()}
            fill="url(#revenueGradient)"
          />

          {/* Main line */}
          <path
            d={generatePath()}
            stroke="#3B82F6"
            strokeWidth="3"
            fill="none"
            className="growth-line"
          />

          {/* Data points */}
          {chartData.map((d, i) => {
            if (i % Math.max(1, Math.floor(chartData.length / 6)) !== 0 && i !== chartData.length - 1) return null;

            const x = leftPadding + (i / (chartData.length - 1)) * (width - leftPadding - padding);
            const y = height - padding - ((d.cumulative_revenue - minRevenue) / revenueRange) * (height - 2 * padding);

            return (
              <g key={i}>
                <circle
                  cx={x}
                  cy={y}
                  r="4"
                  fill="#3B82F6"
                  stroke="white"
                  strokeWidth="2"
                />
                <circle
                  cx={x}
                  cy={y}
                  r="12"
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                >
                  <title>{formatDate(d.date)}: {formatCurrency(d.cumulative_revenue)}</title>
                </circle>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="chart-footer">
        <div className="data-source">
          {error ? (
            <span className="error-notice">⚠️ Using demo data - API unavailable</span>
          ) : (
            <span className="live-data">✅ Live data from Supabase</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default CumulativeRevenueChart;
