const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class CustomerDatabase {
  constructor() {
    this.dbPath = path.join(__dirname, 'customers.db');
    this.db = null;
    this.initDatabase();
  }

  initDatabase() {
    console.log('🗄️ Initializing customer management database...');
    this.db = new sqlite3.Database(this.dbPath, (err) => {
      if (err) {
        console.error('❌ Error opening database:', err.message);
        return;
      }
      console.log('✅ Connected to SQLite customer database');
      this.createTables();
    });
  }

  createTables() {
    console.log('🏗️ Creating database tables...');

    // Customer management table
    const createCustomerManagementTable = `
      CREATE TABLE IF NOT EXISTS customer_management (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stripe_customer_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'included', -- 'included', 'excluded', 'auto_excluded'
        exclusion_reason TEXT,
        last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
        modified_by TEXT DEFAULT 'system',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Churn analysis table
    const createChurnAnalysisTable = `
      CREATE TABLE IF NOT EXISTS churn_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stripe_customer_id TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        churned_date DATETIME NOT NULL,
        churn_reason TEXT,
        subscription_duration_days INTEGER,
        total_revenue_lifetime DECIMAL(10,2),
        last_payment_date DATETIME,
        churn_type TEXT DEFAULT 'voluntary', -- 'voluntary', 'involuntary', 'trial_expired'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (stripe_customer_id) REFERENCES customer_management (stripe_customer_id)
      )
    `;

    // Historical metrics table
    const createHistoricalMetricsTable = `
      CREATE TABLE IF NOT EXISTS historical_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        total_customers INTEGER,
        active_subscriptions INTEGER,
        total_mrr DECIMAL(10,2),
        trial_mrr DECIMAL(10,2),
        churn_rate DECIMAL(5,2),
        daily_revenue DECIMAL(10,2),
        new_customers INTEGER,
        churned_customers INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Execute table creation
    this.db.serialize(() => {
      this.db.run(createCustomerManagementTable, (err) => {
        if (err) {
          console.error('❌ Error creating customer_management table:', err.message);
        } else {
          console.log('✅ Customer management table ready');
        }
      });

      this.db.run(createChurnAnalysisTable, (err) => {
        if (err) {
          console.error('❌ Error creating churn_analysis table:', err.message);
        } else {
          console.log('✅ Churn analysis table ready');
        }
      });

      this.db.run(createHistoricalMetricsTable, (err) => {
        if (err) {
          console.error('❌ Error creating historical_metrics table:', err.message);
        } else {
          console.log('✅ Historical metrics table ready');
        }
      });
    });
  }

  // Customer Management Methods
  async setCustomerStatus(stripeCustomerId, email, name, status, reason = null, modifiedBy = 'manual') {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO customer_management
        (stripe_customer_id, email, name, status, exclusion_reason, last_modified, modified_by)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `;

      this.db.run(sql, [stripeCustomerId, email, name, status, reason, modifiedBy], function(err) {
        if (err) {
          console.error('❌ Error setting customer status:', err.message);
          reject(err);
        } else {
          console.log(`✅ Customer ${email} status set to ${status}`);
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async getCustomerStatus(stripeCustomerId) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM customer_management WHERE stripe_customer_id = ?';

      this.db.get(sql, [stripeCustomerId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async getAllCustomerStatuses() {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM customer_management ORDER BY last_modified DESC';

      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getExcludedCustomers() {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM customer_management WHERE status = "excluded" ORDER BY last_modified DESC';

      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Churn Analysis Methods
  async recordChurn(customerData) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO churn_analysis
        (stripe_customer_id, email, name, churned_date, churn_reason,
         subscription_duration_days, total_revenue_lifetime, last_payment_date, churn_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        customerData.stripeCustomerId,
        customerData.email,
        customerData.name,
        customerData.churnedDate,
        customerData.churnReason,
        customerData.subscriptionDurationDays,
        customerData.totalRevenueLifetime,
        customerData.lastPaymentDate,
        customerData.churnType
      ];

      this.db.run(sql, params, function(err) {
        if (err) {
          console.error('❌ Error recording churn:', err.message);
          reject(err);
        } else {
          console.log(`✅ Churn recorded for ${customerData.email}`);
          resolve({ id: this.lastID });
        }
      });
    });
  }

  async getChurnAnalytics(days = 30) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT
          COUNT(*) as total_churned,
          AVG(subscription_duration_days) as avg_subscription_duration,
          SUM(total_revenue_lifetime) as total_lost_revenue,
          churn_type,
          COUNT(*) as count_by_type
        FROM churn_analysis
        WHERE churned_date >= date('now', '-${days} days')
        GROUP BY churn_type
      `;

      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getDetailedChurnData(days = 30) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM churn_analysis
        WHERE churned_date >= date('now', '-${days} days')
        ORDER BY churned_date DESC
      `;

      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Historical Metrics Methods
  async saveHistoricalMetrics(metrics) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO historical_metrics
        (date, total_customers, active_subscriptions, total_mrr, trial_mrr,
         churn_rate, daily_revenue, new_customers, churned_customers)
        VALUES (date('now'), ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        metrics.totalCustomers,
        metrics.activeSubscriptions,
        metrics.totalMrr,
        metrics.trialMrr,
        metrics.churnRate,
        metrics.dailyRevenue,
        metrics.newCustomers,
        metrics.churnedCustomers
      ];

      this.db.run(sql, params, function(err) {
        if (err) {
          console.error('❌ Error saving historical metrics:', err.message);
          reject(err);
        } else {
          console.log('✅ Historical metrics saved');
          resolve({ id: this.lastID });
        }
      });
    });
  }

  async getHistoricalMetrics(days = 30) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM historical_metrics
        WHERE date >= date('now', '-${days} days')
        ORDER BY date DESC
      `;

      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Utility Methods
  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('❌ Error closing database:', err.message);
        } else {
          console.log('✅ Database connection closed');
        }
      });
    }
  }

  // Initialize customer data from Stripe (one-time setup)
  async initializeFromStripe(stripeCustomers) {
    console.log(`🔄 Initializing database with ${stripeCustomers.length} Stripe customers...`);

    for (const customer of stripeCustomers) {
      try {
        await this.setCustomerStatus(
          customer.id,
          customer.email,
          customer.name,
          'included', // Default to included
          null,
          'auto_import'
        );
      } catch (error) {
        console.error(`❌ Error initializing customer ${customer.email}:`, error.message);
      }
    }

    console.log('✅ Customer data initialization complete');
  }
}

module.exports = CustomerDatabase;