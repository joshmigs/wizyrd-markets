# Market Fantasy MVP

Fantasy-style weekly leagues for financial markets. No real money or execution.

## Stack
- Next.js App Router + TypeScript
- Tailwind CSS
- Supabase Auth + Postgres

## Setup
1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor.
2. Copy `.env.example` to `.env.local` and fill in the values.
3. Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

## Notes
- The ticker allowlist lives in `src/lib/assets.ts`. Replace with the full S&P 500 list or a DB-backed asset table as needed.
- Weekly price data should be loaded into `weekly_prices` before running scoring.
- API routes are implemented under `src/app/api`.
