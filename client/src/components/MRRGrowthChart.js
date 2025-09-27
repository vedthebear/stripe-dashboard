import React, { useState, useEffect, useCallback } from 'react';
import './MRRGrowthChart.css';

const MRRGrowthChart = () => {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHistoricalData = useCallback(async () => {
    try {
      const apiUrl = process.env.NODE_ENV === 'production'
        ? ''
        : (process.env.REACT_APP_API_URL || 'http://localhost:5050');

      const response = await fetch(`${apiUrl}/api/historical/mrr`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setChartData(data);
      setError(null);
    } catch (error) {
      console.error('Error fetching historical data:', error);
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
    const currentMRR = 9375; // Updated to actual current MRR
    const today = new Date();

    for (let i = 59; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);

      // Create realistic growth pattern matching actual data
      let value;
      if (i > 50) {
        // Early period: $1,947 - $2,500 range
        value = 1947 + (i - 50) * 50 + (Math.random() - 0.5) * 100;
      } else if (i > 40) {
        // Mid period: $2,500 - $4,500 range
        value = 2500 + (50 - i) * 200 + (Math.random() - 0.5) * 200;
      } else if (i > 10) {
        // Growth period: $4,500 - $7,000 range
        value = 4500 + (40 - i) * 80 + (Math.random() - 0.5) * 300;
      } else {
        // Recent explosive growth: $7,000 - $9,375
        value = 7000 + (10 - i) * 237 + (Math.random() - 0.5) * 200;
      }

      data.push({
        date: date.toISOString().split('T')[0],
        official_mrr: Math.max(1900, Math.round(value)),
        arr: Math.round(Math.max(1900, value) * 12)
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
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="mrr-chart-loading">
        <div className="chart-skeleton"></div>
        <div className="loading-text">Loading MRR history...</div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="mrr-chart-empty">
        <div className="empty-icon">📈</div>
        <div className="empty-text">No historical data yet</div>
        <div className="empty-subtitle">Data will appear after tomorrow's sync</div>
      </div>
    );
  }

  // Chart calculations
  const width = 400;
  const height = 200;
  const padding = 40;

  const maxMRR = Math.max(...chartData.map(d => d.official_mrr));
  const minMRR = Math.min(...chartData.map(d => d.official_mrr));
  const mrrRange = maxMRR - minMRR || 1;

  // Generate SVG path
  const generatePath = () => {
    const points = chartData.map((d, i) => {
      const x = padding + (i / (chartData.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((d.official_mrr - minMRR) / mrrRange) * (height - 2 * padding);
      return `${x},${y}`;
    });
    return `M${points.join('L')}`;
  };

  // Generate area path
  const generateAreaPath = () => {
    const points = chartData.map((d, i) => {
      const x = padding + (i / (chartData.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((d.official_mrr - minMRR) / mrrRange) * (height - 2 * padding);
      return `${x},${y}`;
    });

    const firstPoint = points[0].split(',');
    const lastPoint = points[points.length - 1].split(',');

    return `M${firstPoint[0]},${height - padding}L${points.join('L')}L${lastPoint[0]},${height - padding}Z`;
  };

  // Calculate growth metrics
  const currentMRR = chartData[chartData.length - 1]?.official_mrr || 0;
  const previousMRR = chartData[Math.max(0, chartData.length - 8)]?.official_mrr || currentMRR;
  const growth = currentMRR - previousMRR;
  const growthPercent = previousMRR > 0 ? ((growth / previousMRR) * 100) : 0;

  return (
    <div className="mrr-growth-chart">
      <div className="chart-header">
        <div className="chart-title">
          <span className="chart-icon">📈</span>
          <div>
            <h3>MRR Growth</h3>
            <p className="chart-subtitle">
              {chartData.length > 1 ? `Last ${chartData.length} days` : 'Historical tracking'}
            </p>
          </div>
        </div>
        <div className="growth-indicator">
          <div className={`growth-badge ${growth >= 0 ? 'positive' : 'negative'}`}>
            {growth >= 0 ? '↗️' : '↘️'} {formatCurrency(Math.abs(growth))}
          </div>
          <div className="growth-percent">
            {growthPercent >= 0 ? '+' : ''}{growthPercent.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="chart-container">
        <svg width={width} height={height} className="growth-chart-svg">
          <defs>
            <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(34, 197, 94, 0.3)" />
              <stop offset="100%" stopColor="rgba(34, 197, 94, 0.05)" />
            </linearGradient>
          </defs>

          {/* Y-axis grid lines and labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
            <g key={i}>
              <line
                x1={padding}
                y1={height - padding - ratio * (height - 2 * padding)}
                x2={width - padding}
                y2={height - padding - ratio * (height - 2 * padding)}
                stroke="rgba(156, 163, 175, 0.2)"
                strokeWidth="1"
              />
              <text
                x={padding - 10}
                y={height - padding - ratio * (height - 2 * padding) + 4}
                fontSize="11"
                fill="#9CA3AF"
                textAnchor="end"
              >
                {formatCurrency(minMRR + ratio * mrrRange)}
              </text>
            </g>
          ))}

          {/* Area fill */}
          <path
            d={generateAreaPath()}
            fill="url(#areaGradient)"
          />

          {/* Main line */}
          <path
            d={generatePath()}
            stroke="#22C55E"
            strokeWidth="3"
            fill="none"
            className="growth-line"
          />

          {/* Data points */}
          {chartData.map((d, i) => {
            if (i % Math.max(1, Math.floor(chartData.length / 6)) !== 0 && i !== chartData.length - 1) return null;

            const x = padding + (i / (chartData.length - 1)) * (width - 2 * padding);
            const y = height - padding - ((d.official_mrr - minMRR) / mrrRange) * (height - 2 * padding);

            return (
              <g key={i}>
                <circle
                  cx={x}
                  cy={y}
                  r="4"
                  fill="#22C55E"
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
                  <title>{formatDate(d.date)}: {formatCurrency(d.official_mrr)}</title>
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

export default MRRGrowthChart;