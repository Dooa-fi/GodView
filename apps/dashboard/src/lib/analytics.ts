import type { LiveVisitor, MetricRow, OverviewData, RangeKey, TrafficPoint } from "./types";

const API_ROOT = "https://api.cloudflare.com/client/v4";
const RANGES: Record<RangeKey, { interval: string; label: string }> = {
  "24h": { interval: "24 HOUR", label: "Last 24 hours" },
  "7d": { interval: "7 DAY", label: "Last 7 days" },
  "30d": { interval: "30 DAY", label: "Last 30 days" },
};

export class AnalyticsConfigurationError extends Error {}
export class AnalyticsUpstreamError extends Error {}

interface Config { accountId: string; apiToken: string; dataset: string; siteId: string; }
interface CloudflareResponse { success?: boolean; errors?: Array<{ message?: string }>; result?: unknown; }
type Row = Record<string, unknown>;

export function parseRange(value: string | null | undefined): RangeKey {
  return value === "24h" || value === "30d" || value === "7d" ? value : "7d";
}

export function rangeLabel(range: RangeKey) { return RANGES[range].label; }

export async function getOverview(range: RangeKey): Promise<OverviewData> {
  if (isDemoMode()) return demoOverview(range);
  const where = whereFor(range);
  const [summaryRows, trafficRows, sourceRows, deviceRows, countryRows, liveRows] = await Promise.all([
    sql(`SELECT SUM(_sample_interval) AS pageviews, uniqExact(blob3) AS visitors, uniqExact(blob4) AS sessions FROM ${dataset()} WHERE ${where} AND blob1 = 'page_view'`),
    sql(`SELECT toStartOfInterval(timestamp, INTERVAL 1 DAY) AS date, SUM(_sample_interval) AS pageviews, uniqExact(blob3) AS visitors FROM ${dataset()} WHERE ${where} AND blob1 = 'page_view' GROUP BY date ORDER BY date`),
    sql(`SELECT if(blob10 != '', blob10, if(blob5 != '', blob5, 'Direct')) AS label, SUM(_sample_interval) AS value FROM ${dataset()} WHERE ${where} AND blob1 = 'page_view' GROUP BY label ORDER BY value DESC LIMIT 8`),
    sql(`SELECT if(blob6 = '', 'Unknown', blob6) AS label, SUM(_sample_interval) AS value FROM ${dataset()} WHERE ${where} AND blob1 = 'page_view' GROUP BY label ORDER BY value DESC LIMIT 8`),
    sql(`SELECT if(blob9 = '', 'Unknown', blob9) AS label, SUM(_sample_interval) AS value FROM ${dataset()} WHERE ${where} AND blob1 = 'page_view' GROUP BY label ORDER BY value DESC LIMIT 8`),
    sql(`SELECT uniqExact(blob4) AS value FROM ${dataset()} WHERE index1 = ${stringLiteral(config().siteId)} AND timestamp >= NOW() - INTERVAL 10 MINUTE`),
  ]);
  const summary = summaryRows[0] ?? {};
  return {
    range,
    pageviews: numberValue(summary.pageviews),
    visitors: numberValue(summary.visitors),
    sessions: numberValue(summary.sessions),
    liveVisitors: numberValue(liveRows[0]?.value),
    traffic: trafficRows.map((row) => ({ date: dateValue(row.date), pageviews: numberValue(row.pageviews), visitors: numberValue(row.visitors) })),
    sources: metrics(sourceRows),
    devices: metrics(deviceRows),
    countries: metrics(countryRows),
  };
}

export async function getPages(range: RangeKey): Promise<MetricRow[]> {
  if (isDemoMode()) return demoPages;
  return metrics(await sql(`SELECT blob2 AS label, SUM(_sample_interval) AS value FROM ${dataset()} WHERE ${whereFor(range)} AND blob1 = 'page_view' GROUP BY label ORDER BY value DESC LIMIT 20`));
}

export async function getEvents(range: RangeKey): Promise<MetricRow[]> {
  if (isDemoMode()) return demoEvents;
  return metrics(await sql(`SELECT blob1 AS label, SUM(_sample_interval) AS value FROM ${dataset()} WHERE ${whereFor(range)} GROUP BY label ORDER BY value DESC LIMIT 20`));
}

export async function getLiveVisitors(): Promise<LiveVisitor[]> {
  if (isDemoMode()) return demoLive;
  const rows = await sql(`SELECT if(blob9 = '', 'Unknown', blob9) AS country, if(blob6 = '', 'Unknown', blob6) AS device, if(blob7 = '', 'Unknown', blob7) AS browser, blob2 AS page, max(timestamp) AS lastSeen FROM ${dataset()} WHERE index1 = ${stringLiteral(config().siteId)} AND timestamp >= NOW() - INTERVAL 10 MINUTE GROUP BY country, device, browser, page, blob4 ORDER BY lastSeen DESC LIMIT 50`);
  return rows.map((row) => ({ country: stringValue(row.country, "Unknown"), device: stringValue(row.device, "Unknown"), browser: stringValue(row.browser, "Unknown"), page: stringValue(row.page, "/"), lastSeen: dateValue(row.lastSeen) }));
}

function config(): Config {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_ANALYTICS_TOKEN;
  const dataset = process.env.CLOUDFLARE_ANALYTICS_DATASET || "GODVIEW_EVENTS";
  const siteId = process.env.GODVIEW_SITE_ID || process.env.OPENPULSE_SITE_ID;
  if (!accountId || !apiToken || !dataset || !siteId) throw new AnalyticsConfigurationError("Cloudflare analytics variables are not configured: set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ANALYTICS_TOKEN, CLOUDFLARE_ANALYTICS_DATASET, and GODVIEW_SITE_ID.");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dataset)) throw new AnalyticsConfigurationError("CLOUDFLARE_ANALYTICS_DATASET must be a valid SQL identifier.");
  return { accountId, apiToken, dataset, siteId };
}

function dataset() { return config().dataset; }
function whereFor(range: RangeKey) { return `index1 = ${stringLiteral(config().siteId)} AND timestamp >= NOW() - INTERVAL ${RANGES[range].interval}`; }
function stringLiteral(value: string) { return `'${value.replaceAll("'", "''")}'`; }

async function sql(query: string): Promise<Row[]> {
  const { accountId, apiToken } = config();
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}/accounts/${accountId}/analytics_engine/sql`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken}`, "content-type": "text/plain" },
      body: query,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AnalyticsUpstreamError("Cloudflare Analytics could not be reached.");
  }
  const payload = await response.json().catch(() => null) as CloudflareResponse | null;
  if (!response.ok || !payload?.success) throw new AnalyticsUpstreamError(payload?.errors?.[0]?.message ?? "Cloudflare Analytics query failed.");
  return rowsFromResult(payload.result);
}

export function rowsFromResult(result: unknown): Row[] {
  if (Array.isArray(result)) return result.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  if (result && typeof result === "object" && Array.isArray((result as { data?: unknown }).data)) return rowsFromResult((result as { data: unknown }).data);
  return [];
}

function metrics(rows: Row[]): MetricRow[] { return rows.map((row) => ({ label: stringValue(row.label, "Unknown"), value: numberValue(row.value) })); }
function stringValue(value: unknown, fallback = "") { return typeof value === "string" ? value : value == null ? fallback : String(value); }
function numberValue(value: unknown) { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function dateValue(value: unknown) { return typeof value === "string" ? value : ""; }
function isDemoMode() { return process.env.GODVIEW_DEMO_MODE === "true" || process.env.OPENPULSE_DEMO_MODE === "true"; }

const demoOverview = (range: RangeKey): OverviewData => ({
  range, pageviews: 12_841, visitors: 7_202, sessions: 8_116, liveVisitors: 27,
  traffic: [{ date: "2026-09-01", pageviews: 1241, visitors: 720 }, { date: "2026-09-02", pageviews: 1690, visitors: 923 }, { date: "2026-09-03", pageviews: 1432, visitors: 801 }, { date: "2026-09-04", pageviews: 2110, visitors: 1210 }, { date: "2026-09-05", pageviews: 1894, visitors: 1005 }, { date: "2026-09-06", pageviews: 2476, visitors: 1392 }, { date: "2026-09-07", pageviews: 1998, visitors: 1151 }],
  sources: [{ label: "Google", value: 41 }, { label: "Direct", value: 25 }, { label: "ChatGPT", value: 14 }, { label: "Reddit", value: 8 }, { label: "LinkedIn", value: 5 }],
  devices: [{ label: "Mobile", value: 62 }, { label: "Desktop", value: 33 }, { label: "Tablet", value: 5 }],
  countries: [{ label: "India", value: 41 }, { label: "United States", value: 27 }, { label: "United Kingdom", value: 9 }, { label: "Germany", value: 6 }],
});
const demoPages = [{ label: "/", value: 8231 }, { label: "/pricing", value: 5842 }, { label: "/features", value: 3219 }, { label: "/signup", value: 1842 }, { label: "/blog/how-ai-works", value: 921 }];
const demoEvents = [{ label: "page_view", value: 12_841 }, { label: "start_trial_clicked", value: 821 }, { label: "signup_started", value: 614 }, { label: "signup_completed", value: 381 }, { label: "pricing_toggle", value: 293 }];
const demoLive = [{ country: "India", device: "Mobile", browser: "Chrome", page: "/pricing", lastSeen: "now" }, { country: "United States", device: "Desktop", browser: "Safari", page: "/features", lastSeen: "now" }, { country: "India", device: "Mobile", browser: "Chrome", page: "/signup", lastSeen: "now" }];
