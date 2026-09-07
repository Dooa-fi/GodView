"use client";

import { useCallback, useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LiveVisitor, MetricRow, OverviewData, RangeKey } from "@/lib/types";

const ranges: Array<{ value: RangeKey; label: string }> = [{ value: "24h", label: "24 hours" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }];
const number = new Intl.NumberFormat("en-US");

export function Dashboard() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [overview, setOverview] = useState<OverviewData>();
  const [pages, setPages] = useState<MetricRow[]>([]);
  const [events, setEvents] = useState<MetricRow[]>([]);
  const [live, setLive] = useState<LiveVisitor[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const [summary, pageData, eventData, liveData] = await Promise.all([
        fetch(`/api/analytics/overview?range=${range}`, { cache: "no-store" }), fetch(`/api/analytics/pages?range=${range}`, { cache: "no-store" }), fetch(`/api/analytics/events?range=${range}`, { cache: "no-store" }), fetch("/api/analytics/live", { cache: "no-store" }),
      ]);
      const payloads = await Promise.all([summary.json(), pageData.json(), eventData.json(), liveData.json()]);
      if (![summary, pageData, eventData, liveData].every((response) => response.ok)) throw new Error(payloads.find((payload) => payload.error)?.error ?? "Analytics data is unavailable.");
      setOverview(payloads[0]); setPages(payloads[1].pages); setEvents(payloads[2].events); setLive(payloads[3].visitors);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Analytics data is unavailable."); }
    finally { setLoading(false); }
  }, [range]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const id = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(id); }, [load]);

  const [showSnippet, setShowSnippet] = useState(false);
  return <main className="shell">
    <header>
      <div>
        <p className="eyebrow">GODVIEW // INTELLIGENCE</p>
        <h1>Product analytics</h1>
        <p className="subtle">A privacy-conscious, real-time view of how people use your product.</p>
      </div>
      <div className="header-actions">
        <button className="snippet-btn" onClick={() => setShowSnippet((prev) => !prev)}>
          {showSnippet ? "Hide Snippet" : "Get Tracking Snippet"}
        </button>
        <div className="range" aria-label="Date range">
          {ranges.map((item) => (
            <button className={item.value === range ? "active" : ""} key={item.value} onClick={() => setRange(item.value)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </header>
    {showSnippet ? (
      <section className="snippet-box">
        <div className="snippet-header">
          <strong>Embed GodView Tracker</strong>
          <span>Add this snippet inside the <code>&lt;head&gt;</code> of your website:</span>
        </div>
        <pre><code>{`<script defer src="/godview.js" data-site-id="YOUR_SITE_ID" data-endpoint="https://YOUR_COLLECTOR_URL/v1/events"></script>`}</code></pre>
      </section>
    ) : null}
    {error ? <section className="notice"><strong>Connect your analytics account</strong><p>{error}</p><p>Add the Cloudflare variables shown in the README, then refresh. You can set <code>GODVIEW_DEMO_MODE=true</code> to explore this dashboard with sample data.</p></section> : null}
    {loading && !overview ? <section className="loading">Loading analytics…</section> : null}
    {overview ? <><section className="metrics"><Metric label="Live now" value={overview.liveVisitors} live /><Metric label="Page views" value={overview.pageviews} /><Metric label="Visitors" value={overview.visitors} /><Metric label="Sessions" value={overview.sessions} /></section>
      <section className="panel traffic"><div className="panel-heading"><div><p className="eyebrow">TRAFFIC</p><h2>Visitors over time</h2></div><span>{ranges.find((item) => item.value === range)?.label}</span></div><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={overview.traffic}><defs><linearGradient id="visitors" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#87f5c1" stopOpacity={0.35}/><stop offset="100%" stopColor="#87f5c1" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#93a1ad", fontSize: 12 }}/><YAxis hide/><Tooltip contentStyle={{ background: "#16202a", border: "1px solid #283643", borderRadius: 10 }} labelStyle={{ color: "#dce5eb" }}/><Area type="monotone" dataKey="visitors" stroke="#87f5c1" strokeWidth={2} fill="url(#visitors)" /></AreaChart></ResponsiveContainer></div></section>
      <section className="grid three"><Breakdown title="Traffic sources" items={overview.sources} /><Breakdown title="Devices" items={overview.devices} /><Breakdown title="Countries" items={overview.countries} /></section>
      <section className="grid two"><Ranked title="Top pages" items={pages} /><Ranked title="Events" items={events} /></section>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">LIVE</p><h2>Visitors active in the last 10 minutes</h2></div><span className="live-dot">updates every 30s</span></div><div className="live-list">{live.length ? live.map((visitor, index) => <div className="live-row" key={`${visitor.page}-${visitor.lastSeen}-${index}`}><span>{flag(visitor.country)} {visitor.country}</span><span>{visitor.device} · {visitor.browser}</span><strong>{visitor.page}</strong></div>) : <p className="empty">No active visitors yet.</p>}</div></section>
    </> : null}
  </main>;
}

function Metric({ label, value, live = false }: { label: string; value: number; live?: boolean }) { return <article className="metric"><p>{live ? <span className="pulse"/> : null}{label}</p><strong>{number.format(value)}</strong></article>; }
function Breakdown({ title, items }: { title: string; items: MetricRow[] }) { const total = items.reduce((sum, item) => sum + item.value, 0); return <section className="panel breakdown"><h2>{title}</h2>{items.length ? items.map((item) => <div className="bar-row" key={item.label}><span>{item.label}</span><div><i style={{ width: `${total ? Math.max((item.value / total) * 100, 3) : 0}%` }}/></div><b>{total ? `${Math.round((item.value / total) * 100)}%` : "0%"}</b></div>) : <p className="empty">No data yet.</p>}</section>; }
function Ranked({ title, items }: { title: string; items: MetricRow[] }) { return <section className="panel ranked"><h2>{title}</h2>{items.length ? <ol>{items.map((item) => <li key={item.label}><span>{item.label}</span><b>{number.format(item.value)}</b></li>)}</ol> : <p className="empty">No data yet.</p>}</section>; }
function flag(country: string) { return ({ India: "🇮🇳", "United States": "🇺🇸", "United Kingdom": "🇬🇧", Germany: "🇩🇪" } as Record<string, string>)[country] ?? "🌐"; }
