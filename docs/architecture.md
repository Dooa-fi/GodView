# GodView Architecture

```text
Website → GodView SDK (godview.js) → Cloudflare Worker Collector → Analytics Engine → SQL API → Railway Dashboard
```

The browser SDK collects normalized events and sends small batches to the Cloudflare Worker. The Worker rejects malformed requests, enforces the configured browser-origin allowlist, enriches each event with Cloudflare's country-level IP signal, and writes dimensions to Analytics Engine.

Analytics Engine uses one sampling index: `index1 = siteId`. Blob dimensions are deterministic:
- `blob1`: event name
- `blob2`: page path
- `blob3`: visitor ID
- `blob4`: session ID
- `blob5`: referrer URL
- `blob6`: device type (`mobile`, `tablet`, `desktop`)
- `blob7`: browser
- `blob8`: operating system
- `blob9`: country
- `blob10`: UTM source
- `blob11`: UTM medium
- `blob12`: UTM campaign
- `blob13`: compact custom properties JSON (up to 1,024 bytes)
- `double1`: timestamp (epoch ms)
- `double2`: screen width
- `double3`: screen height

The dashboard Query API executes server-side, parameterized query templates against those fields, with the configured site and fixed date-range options permitted.

## Roadmap Milestones

1. **Phase 1 (Completed)**: Unified GodView branding, Railway standalone deployment fix, direct script delivery (`godview.js`), and edge security.
2. **Phase 2 (Next)**: Multi-site management in the dashboard UI and 1-click snippet generator modal.
3. **Phase 3**: Cross-dimensional dashboard filtering, OS/Browser breakdowns, and journey/funnel conversion pipelines.
4. **Phase 4**: Open-source community readiness, 1-click deploy templates, and automated CI/CD.
