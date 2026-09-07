# Contributing to GodView

First off, thank you for considering contributing to GodView! We want to build the most transparent, privacy-first, lightweight product analytics platform, and contributions from the community are welcome.

## Code of Conduct

Please be respectful, constructive, and collaborative in all discussions and pull requests.

## Monorepo Structure

GodView uses npm workspaces:

- `apps/collector`: Edge-native Cloudflare Worker event ingestion and site provisioning API.
- `apps/dashboard`: Next.js standalone web analytics dashboard and query API.
- `packages/sdk`: Lightweight (<11 KB), zero-cookie browser tracking SDK.
- `packages/shared`: Shared event schemas, types, and constants.

## Getting Started

### Prerequisites

- Node.js `22.16.x`
- npm `11.15.x`

### Setup

```bash
# Clone the repository
git clone https://github.com/Dooa-fi/GodView.git
cd GodView

# Install all dependencies across all workspaces
npm ci

# Start the dashboard locally with demo data
cp apps/dashboard/.env.example apps/dashboard/.env.local
npm run dev:dashboard
```

## Quality Checklist

Before submitting a pull request, ensure all checks pass:

```bash
# 1. Type check
npm run check

# 2. Run unit tests
npm test

# 3. Production build
npm run build
```

## Commit Guidelines

We prefer clean, human-written, lowercase commit messages without AI fluff or generic marketing phrases:

- `feat: add custom funnel step reordering`
- `fix: prevent duplicate event flush on rapid navigation`
- `docs: update cloudflare kv setup instructions`

## Submitting Pull Requests

1. Fork the repo and create your branch from `main`.
2. Keep PRs focused on a single change or feature.
3. Add unit tests for new logic or bug fixes.
4. Ensure all quality checks pass.
5. Open a pull request against `main`.
