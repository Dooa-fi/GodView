"use client";

import { useCallback, useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LiveVisitor, MetricRow, OverviewData, RangeKey } from "@/lib/types";
import type { SiteRecord } from "@godview/shared";

const ranges: Array<{ value: RangeKey; label: string }> = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];
const number = new Intl.NumberFormat("en-US");

export function Dashboard() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [collectorEndpoint, setCollectorEndpoint] = useState<string>("");
  const [overview, setOverview] = useState<OverviewData>();
  const [pages, setPages] = useState<MetricRow[]>([]);
  const [events, setEvents] = useState<MetricRow[]>([]);
  const [live, setLive] = useState<LiveVisitor[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  // Modals
  const [showSnippet, setShowSnippet] = useState(false);
  const [showAddSite, setShowAddSite] = useState(false);
  const [snippetTab, setSnippetTab] = useState<"script" | "npm">("script");
  const [copied, setCopied] = useState(false);

  // Form State
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteOrigins, setNewSiteOrigins] = useState("");
  const [addSiteLoading, setAddSiteLoading] = useState(false);
  const [addSiteError, setAddSiteError] = useState<string>();

  // Fetch site list on mount
  useEffect(() => {
    async function loadSites() {
      try {
        const res = await fetch("/api/sites", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { sites?: SiteRecord[]; collectorUrl?: string };
          if (data.sites && data.sites.length > 0) {
            setSites(data.sites);
            const saved = typeof window !== "undefined" ? localStorage.getItem("godview:active_site") : null;
            const initial = saved && data.sites.some((s) => s.id === saved) ? saved : data.sites[0].id;
            setSelectedSiteId(initial);
          }
          if (data.collectorUrl) {
            setCollectorEndpoint(data.collectorUrl);
          }
        }
      } catch {
        // Fallback gracefully
      }
    }
    void loadSites();
  }, []);

  const handleSelectSite = (siteId: string) => {
    setSelectedSiteId(siteId);
    try {
      localStorage.setItem("godview:active_site", siteId);
    } catch {
      // ignore
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const siteParam = selectedSiteId ? `&siteId=${encodeURIComponent(selectedSiteId)}` : "";
      const siteParamOnly = selectedSiteId ? `?siteId=${encodeURIComponent(selectedSiteId)}` : "";

      const [summary, pageData, eventData, liveData] = await Promise.all([
        fetch(`/api/analytics/overview?range=${range}${siteParam}`, { cache: "no-store" }),
        fetch(`/api/analytics/pages?range=${range}${siteParam}`, { cache: "no-store" }),
        fetch(`/api/analytics/events?range=${range}${siteParam}`, { cache: "no-store" }),
        fetch(`/api/analytics/live${siteParamOnly}`, { cache: "no-store" }),
      ]);

      const payloads = await Promise.all([summary.json(), pageData.json(), eventData.json(), liveData.json()]);

      if (![summary, pageData, eventData, liveData].every((response) => response.ok)) {
        throw new Error(payloads.find((payload) => payload.error)?.error ?? "Analytics data is unavailable.");
      }

      setOverview(payloads[0]);
      setPages(payloads[1].pages ?? []);
      setEvents(payloads[2].events ?? []);
      setLive(payloads[3].visitors ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Analytics data is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [range, selectedSiteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddSiteLoading(true);
    setAddSiteError(undefined);

    const origins = newSiteOrigins
      .split(/[\n,]/)
      .map((o) => o.trim())
      .filter(Boolean);

    if (!newSiteName.trim()) {
      setAddSiteError("Please enter a site name.");
      setAddSiteLoading(false);
      return;
    }
    if (origins.length === 0) {
      setAddSiteError("Please provide at least one origin like https://example.com");
      setAddSiteLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newSiteName.trim(), origins }),
      });
      const data = await res.json();
      if (!res.ok || !data.site) {
        throw new Error(data.error || "Failed to create site.");
      }

      setSites((prev) => [...prev, data.site]);
      setSelectedSiteId(data.site.id);
      setNewSiteName("");
      setNewSiteOrigins("");
      setShowAddSite(false);
      setShowSnippet(true);
    } catch (err) {
      setAddSiteError(err instanceof Error ? err.message : "Failed to create site.");
    } finally {
      setAddSiteLoading(false);
    }
  };

  const currentSite = sites.find((s) => s.id === selectedSiteId);
  const endpointUrl = collectorEndpoint
    ? `${collectorEndpoint}/v1/events`
    : typeof window !== "undefined"
    ? `${window.location.origin}/v1/events`
    : "https://your-collector/v1/events";

  const snippetCode = `<script defer
  src="${typeof window !== "undefined" ? window.location.origin : "https://your-domain"}/godview.js"
  data-site-id="${selectedSiteId || "YOUR_SITE_ID"}"
  data-endpoint="${endpointUrl}">
</script>`;

  const npmCode = `npm install @godview/sdk

// In your app entrypoint:
import { createTracker } from "@godview/sdk";

const analytics = createTracker({
  endpoint: "${endpointUrl}",
  siteId: "${selectedSiteId || "YOUR_SITE_ID"}",
});

analytics.start();`;

  const copyToClipboard = (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <main className="shell">
      <header>
        <div>
          <div className="brand-badge-row">
            <p className="eyebrow">GODVIEW // INTELLIGENCE</p>
            {currentSite ? <span className="site-badge">{currentSite.name}</span> : null}
          </div>
          <h1>Product analytics</h1>
          <p className="subtle">A privacy-conscious, real-time view of how people use your product.</p>
        </div>

        <div className="header-actions">
          {/* Site Selector Dropdown */}
          <div className="site-selector-container">
            <select
              className="site-select"
              value={selectedSiteId}
              onChange={(e) => {
                if (e.target.value === "__add_new__") {
                  setShowAddSite(true);
                } else {
                  handleSelectSite(e.target.value);
                }
              }}
              aria-label="Select Site"
            >
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} ({site.id})
                </option>
              ))}
              <option value="__add_new__">+ Add New Site...</option>
            </select>
          </div>

          <button className="snippet-btn" onClick={() => setShowSnippet((prev) => !prev)}>
            {showSnippet ? "Hide Snippet" : "Tracking Code"}
          </button>

          <div className="range" aria-label="Date range">
            {ranges.map((item) => (
              <button
                className={item.value === range ? "active" : ""}
                key={item.value}
                onClick={() => setRange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Snippet Drawer */}
      {showSnippet ? (
        <section className="snippet-box">
          <div className="snippet-header">
            <div>
              <strong>Tracking Snippet for {currentSite?.name || selectedSiteId || "Your Site"}</strong>
              <span>Fast, privacy-safe script with zero cookies and edge telemetry.</span>
            </div>
            <div className="snippet-tabs">
              <button
                className={snippetTab === "script" ? "active" : ""}
                onClick={() => setSnippetTab("script")}
              >
                Script Tag
              </button>
              <button
                className={snippetTab === "npm" ? "active" : ""}
                onClick={() => setSnippetTab("npm")}
              >
                NPM Package
              </button>
              <button
                className="copy-btn"
                onClick={() => copyToClipboard(snippetTab === "script" ? snippetCode : npmCode)}
              >
                {copied ? "Copied!" : "Copy Code"}
              </button>
            </div>
          </div>
          <pre>
            <code>{snippetTab === "script" ? snippetCode : npmCode}</code>
          </pre>
        </section>
      ) : null}

      {/* Add Site Modal */}
      {showAddSite ? (
        <div className="modal-backdrop" onClick={() => setShowAddSite(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add New Site to GodView</h2>
              <button className="modal-close" onClick={() => setShowAddSite(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateSite}>
              <div className="form-group">
                <label htmlFor="site-name">Site Name</label>
                <input
                  id="site-name"
                  type="text"
                  placeholder="e.g. My SaaS Production"
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="site-origins">Allowed Origins (comma or newline separated)</label>
                <textarea
                  id="site-origins"
                  rows={3}
                  placeholder="https://example.com, https://app.example.com"
                  value={newSiteOrigins}
                  onChange={(e) => setNewSiteOrigins(e.target.value)}
                  required
                />
                <small className="form-hint">
                  Origin allowlisting protects your site against spoofed analytics and cross-site injection.
                </small>
              </div>
              {addSiteError ? <p className="form-error">{addSiteError}</p> : null}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowAddSite(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={addSiteLoading}>
                  {addSiteLoading ? "Creating Site..." : "Create Site"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {error ? (
        <section className="notice">
          <strong>Connect your analytics account</strong>
          <p>{error}</p>
          <p>
            Add the Cloudflare variables shown in the README, then refresh. You can set{" "}
            <code>GODVIEW_DEMO_MODE=true</code> to explore this dashboard with sample data.
          </p>
        </section>
      ) : null}

      {loading && !overview ? <section className="loading">Loading analytics…</section> : null}

      {overview ? (
        <>
          <section className="metrics">
            <Metric label="Live now" value={overview.liveVisitors} live />
            <Metric label="Page views" value={overview.pageviews} />
            <Metric label="Visitors" value={overview.visitors} />
            <Metric label="Sessions" value={overview.sessions} />
          </section>

          <section className="panel traffic">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">TRAFFIC</p>
                <h2>Visitors over time</h2>
              </div>
              <span>{ranges.find((item) => item.value === range)?.label}</span>
            </div>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={overview.traffic}>
                  <defs>
                    <linearGradient id="visitors" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#87f5c1" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#87f5c1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#93a1ad", fontSize: 12 }}
                  />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ background: "#16202a", border: "1px solid #283643", borderRadius: 10 }}
                    labelStyle={{ color: "#dce5eb" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="visitors"
                    stroke="#87f5c1"
                    strokeWidth={2}
                    fill="url(#visitors)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="grid three">
            <Breakdown title="Traffic sources" items={overview.sources} />
            <Breakdown title="Devices" items={overview.devices} />
            <Breakdown title="Countries" items={overview.countries} />
          </section>

          <section className="grid two">
            <Ranked title="Top pages" items={pages} />
            <Ranked title="Events" items={events} />
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">LIVE</p>
                <h2>Visitors active in the last 10 minutes</h2>
              </div>
              <span className="live-dot">updates every 30s</span>
            </div>
            <div className="live-list">
              {live.length ? (
                live.map((visitor, index) => (
                  <div className="live-row" key={`${visitor.page}-${visitor.lastSeen}-${index}`}>
                    <span>
                      {flag(visitor.country)} {visitor.country}
                    </span>
                    <span>
                      {visitor.device} · {visitor.browser}
                    </span>
                    <strong>{visitor.page}</strong>
                  </div>
                ))
              ) : (
                <p className="empty">No active visitors yet.</p>
              )}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function Metric({ label, value, live = false }: { label: string; value: number; live?: boolean }) {
  return (
    <article className="metric">
      <p>
        {live ? <span className="pulse" /> : null}
        {label}
      </p>
      <strong>{number.format(value)}</strong>
    </article>
  );
}

function Breakdown({ title, items }: { title: string; items: MetricRow[] }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className="panel breakdown">
      <h2>{title}</h2>
      {items.length ? (
        items.map((item) => (
          <div className="bar-row" key={item.label}>
            <span>{item.label}</span>
            <div>
              <i style={{ width: `${total ? Math.max((item.value / total) * 100, 3) : 0}%` }} />
            </div>
            <b>{total ? `${Math.round((item.value / total) * 100)}%` : "0%"}</b>
          </div>
        ))
      ) : (
        <p className="empty">No data yet.</p>
      )}
    </section>
  );
}

function Ranked({ title, items }: { title: string; items: MetricRow[] }) {
  return (
    <section className="panel ranked">
      <h2>{title}</h2>
      {items.length ? (
        <ol>
          {items.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <b>{number.format(item.value)}</b>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">No data yet.</p>
      )}
    </section>
  );
}

function flag(country: string) {
  return (
    ({
      India: "🇮🇳",
      "United States": "🇺🇸",
      "United Kingdom": "🇬🇧",
      Germany: "🇩🇪",
      France: "🇫🇷",
      Canada: "🇨🇦",
      Australia: "🇦🇺",
      Japan: "🇯🇵",
      Brazil: "🇧🇷",
      Singapore: "🇸🇬",
    } as Record<string, string>)[country] ?? "🌐"
  );
}
