# Stripe Dashboard

A real-time dashboard for visualizing Stripe payment data with analytics and customer management features.

## Features

- **Real-time Updates**: Live data refresh every 30 seconds via WebSocket
- **MRR Analytics**: Monthly Recurring Revenue tracking with trial and active subscriptions
- **Customer Segmentation**: Payment status categorization and management
- **Revenue Metrics**: Daily, weekly, and monthly revenue tracking
- **Supabase Integration**: Enhanced analytics and data storage
- **Customer Management**: Manual override controls for customer filtering

## Quick Start

1. **Install dependencies**:
   ```bash
   npm run install-all
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your Stripe API keys
   ```

3. **Start development servers**:
   ```bash
   npm run dev
   ```

Access the dashboard at `http://localhost:3000`

## Tech Stack

- **Backend**: Node.js, Express, Socket.io, Stripe API, Supabase
- **Frontend**: React, Recharts, Socket.io Client
- **Database**: SQLite (local), Supabase (cloud analytics)

## Environment Variables

```env
STRIPE_SECRET_KEY=sk_test_your_key_here
PORT=5050
CLIENT_ORIGIN=http://localhost:3000
SUPABASE_URL=your_supabase_url (optional)
SUPABASE_ANON_KEY=your_supabase_key (optional)
```

## License

MIT
