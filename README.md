# GodView

Privacy-conscious, real-time product analytics at the edge.

GodView provides a lightweight, open-source alternative to Google Analytics, Plausible, and PostHog. Built on Cloudflare Workers, Workers Analytics Engine, and Next.js on Railway, GodView delivers sub-millisecond edge event ingestion and real-time live visitor intelligence with zero cookies and zero personal data storage.

GodView implements the complete V1 path: **collect → validate → store → query → visualize**.

- **@godview/sdk**: Framework-independent browser tracker (<11 KB bundled), zero cookies, automatic SPA route tracking, scroll milestones, click heat, and privacy-safe form metrics.
- **@godview/collector**: Edge-native Cloudflare Worker event ingestion API with CORS, payload validation, and origin allowlists.
- **Cloudflare Analytics Engine**: Hyper-scalable time-series SQL storage at the edge.
- **@godview/dashboard**: Railway-ready Next.js dashboard with live visitor pulse (30s polling), interactive traffic charts, breakdown matrices, and built-in query APIs.
- **@godview/shared**: Shared event contract, schemas, and type definitions.

---

## How It Works

```text
Your Website / Web App
  └─ GodView Tracker (<script src="/godview.js"> or npm)
       └─ Cloudflare Worker Collector (/v1/events)
            └─ Workers Analytics Engine (Edge ClickHouse-backed SQL)
                 └─ Cloudflare Analytics SQL API (Server-side token query)
                      └─ Railway-hosted Next.js Dashboard (/api/analytics/*)
```

1. **Edge-First Collection**: Your website loads `godview.js` (or imports `@godview/sdk`). It batches user interactions (page views, clicks, scrolls, form interactions) and flushes small JSON batches via `fetch` (or `sendBeacon` on unload).
2. **Zero-PII Enrichment**: The Cloudflare Worker collector inspects the origin, enforces domain allowlists, validates schema limits, and extracts country metadata from Cloudflare's network IP header (`request.cf.country`). **It never writes IP addresses, user-typed form values, or tracking cookies.**
3. **Hyper-Efficient Time-Series Storage**: Events are written directly into Cloudflare Workers Analytics Engine with `siteId` as the sampling key (`index1`).
4. **Server-Side SQL Queries**: The Railway-hosted Next.js dashboard queries Analytics Engine through Cloudflare's server-side SQL API using read-only tokens. The API token is never exposed to browser clients.
5. **Real-Time Visualization**: The dashboard presents live active visitors (last 10 minutes), daily traffic curves, top traffic sources, devices, top pages, and custom event counts.

---

## Project Layout

```text
apps/collector/       Cloudflare Worker event ingestion & site provisioning API
apps/dashboard/       Next.js 16 standalone dashboard & query API (Railway ready)
packages/sdk/         Framework-independent browser tracking SDK (IIFE & ESM)
packages/shared/      Shared schemas, types, and event contracts
docs/                 Architecture decisions and privacy guardrails
```

---

## Required External Accounts & Services

GodView is designed to run on generous free/low-cost tiers:

1. **Cloudflare Account**:
   - Cloudflare Worker for `@godview/collector`.
   - Cloudflare Analytics Engine dataset (`GODVIEW_EVENTS`).
   - Cloudflare Read-Only Analytics API Token (**Account → Account Analytics → Read**).
   - Optional: Cloudflare KV for dynamic multi-site provisioning.
2. **Railway Account**:
   - Hosts the Next.js `@godview/dashboard` standalone service with built-in health monitoring.
3. **GitHub Account**:
   - For version control and Railway continuous deployment.

*No external SQL database instance is required: Cloudflare Workers Analytics Engine acts as the serverless time-series store.*

---

## Local Development

Requirements: Node.js **22.16+** and npm **11.15+**.

```bash
# 1. Install dependencies across all workspaces
npm ci

# 2. Run the Cloudflare Worker collector locally
npm run dev:collector

# 3. In a second terminal, configure and launch the dashboard
cp apps/dashboard/.env.example apps/dashboard/.env.local
# Set GODVIEW_DEMO_MODE=true to explore with realistic mock data
npm run dev:dashboard
```

- Worker endpoints: `POST /v1/events`, `GET /health`, `GET /v1/sites`
- Dashboard endpoints: `GET /api/health`, `/api/analytics/overview`, `/pages`, `/events`, `/live`, `/api/sites`

---

## Deploying the Collector (Cloudflare Worker)

1. Enable Analytics Engine on your Cloudflare account.
2. In `apps/collector/wrangler.toml`, confirm the dataset binding:
   ```toml
   name = "godview-collector"
   main = "src/index.ts"
   compatibility_date = "2026-09-07"

   [[analytics_engine_datasets]]
   binding = "EVENTS"
   dataset = "GODVIEW_EVENTS"
   ```
3. Set your authorized site origins:
   ```bash
   npx wrangler secret put GODVIEW_ALLOWED_ORIGINS_JSON
   # Enter: ["https://yourdomain.com", "https://app.yourdomain.com"]
   ```
4. Deploy the worker:
   ```bash
   npm run deploy:collector
   ```

---

## Deploying the Dashboard to Railway

Railway deploys the repository root as a standalone service using [`railway.toml`](railway.toml).

1. Push this repository to GitHub and connect it in Railway.
2. Set the following environment variables in Railway:

| Variable | Description | Example |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Your 32-character Cloudflare account ID | `abc123def456...` |
| `CLOUDFLARE_ANALYTICS_TOKEN` | Read-only Account Analytics API Token | `bearer_token_here` |
| `CLOUDFLARE_ANALYTICS_DATASET` | Dataset name | `GODVIEW_EVENTS` |
| `GODVIEW_SITE_ID` | Site ID to display | `site_123` |
| `GODVIEW_DEMO_MODE` | Mock data mode | `false` (or `true` to test) |

3. Deploy. Railway automatically runs `npm run build --workspace=@godview/dashboard`, polls `/api/health`, and marks the service healthy.

---

## Integrating GodView with Your Website

### Option 1: Standalone Script Tag (Recommended)

Embed the script before `</head>`:

```html
<script defer
  src="https://your-dashboard-domain.com/godview.js"
  data-site-id="site_123"
  data-endpoint="https://your-collector-domain.workers.dev/v1/events">
</script>
```

### Option 2: NPM Package (`@godview/sdk`)

```ts
import { createTracker } from "@godview/sdk";

const analytics = createTracker({
  endpoint: "https://your-collector-domain.workers.dev/v1/events",
  siteId: "site_123",
});

analytics.start();

// Custom conversion / business events
analytics.track("signup_completed", { plan: "enterprise" });
```

---

## Features

- **Privacy-First**: No cookies, no local storage fingerprinting, no raw IP storage. 100% GDPR, PECR, and CCPA compliant.
- **Edge-Powered Ingestion**: Sub-millisecond latency on Cloudflare's global edge network.
- **Real-Time Live Intelligence**: 30-second polling pulse showing visitors active in the last 10 minutes with device, browser, and country indicators.
- **Multi-Site Management**: Add and manage multiple web properties with dynamic origin allowlists directly from the dashboard.
- **Interactive Multi-Dimensional Filtering**: Click any referrer, country, device, browser, operating system, or page to filter all charts and metrics.
- **Technology Breakdowns**: Tabbed insights for Devices, Browsers (`Chrome`, `Safari`, `Firefox`, `Edge`), and Operating Systems (`macOS`, `Windows`, `iOS`, `Android`, `Linux`).
- **Conversion Funnels**: Track multi-step user journeys (e.g. `page_view` → `signup_started` → `signup_completed`) with conversion rates and drop-off percentages.
- **Engagement Metrics**: Bounce rate and pages per session analytics.
- **Dual SDK Distribution**: Embedded `<script>` tag served directly or modular `@godview/sdk` npm package.
- **Turnkey Deployment**: Standalone Next.js container on Railway and Cloudflare Worker via Wrangler.

---

## Contributing

Contributions are welcome! Please check out [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, testing guidelines, and pull request procedures.

---

## Security

Please review [SECURITY.md](SECURITY.md) for vulnerability disclosure guidelines and our privacy architecture.

---

## License

GodView is open-source software licensed under the [MIT License](LICENSE).

