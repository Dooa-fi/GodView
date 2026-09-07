import type { AnalyticsFilter, FunnelData, FunnelStep, LiveVisitor, MetricRow, OverviewData, RangeKey, TrafficPoint } from "./types";

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

export function defaultSiteId(): string {
  return process.env.GODVIEW_SITE_ID || process.env.OPENPULSE_SITE_ID || "site_primary";
}

export function resolveSiteId(requested?: string | null): string {
  if (requested) {
    const trimmed = requested.trim();
    if (/^[A-Za-z0-9_.-]{1,64}$/.test(trimmed)) return trimmed;
  }
  return defaultSiteId();
}

export function rangeLabel(range: RangeKey) { return RANGES[range].label; }

export function sanitizeFilterValue(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  if (!trimmed || trimmed.length > 100) return undefined;
  if (/^[a-zA-Z0-9 _./:-]{1,100}$/.test(trimmed)) return trimmed;
  return undefined;
}

export function parseFilters(params: URLSearchParams | Record<string, string | undefined>): AnalyticsFilter {
  const get = (key: string) => params instanceof URLSearchParams ? params.get(key) : params[key];
  const filter: AnalyticsFilter = {};
  const country = sanitizeFilterValue(get("country"));
  const device = sanitizeFilterValue(get("device"));
  const browser = sanitizeFilterValue(get("browser"));
  const os = sanitizeFilterValue(get("os"));
  const source = sanitizeFilterValue(get("source"));
  const page = sanitizeFilterValue(get("page"));

  if (country) filter.country = country;
  if (device) filter.device = device;
  if (browser) filter.browser = browser;
  if (os) filter.os = os;
  if (source) filter.source = source;
  if (page) filter.page = page;

  return filter;
}

export async function getOverview(
  range: RangeKey,
  requestedSiteId?: string | null,
  filters?: AnalyticsFilter
): Promise<OverviewData> {
  const siteId = resolveSiteId(requestedSiteId);
  if (isDemoMode()) return demoOverview(range, filters);
  const where = whereFor(range, siteId, filters);
  const timeInterval = range === "24h" ? "toStartOfInterval(timestamp, INTERVAL 1 HOUR)" : "toStartOfInterval(timestamp, INTERVAL 1 DAY)";

  const [summaryRows, trafficRows, sourceRows, deviceRows, browserRows, osRows, countryRows, liveRows] = await Promise.all([
    sql(`SELECT SUM(_sample_interval) AS pageviews, uniqExact(blob3) AS visitors, uniqExact(blob4) AS sessions FROM ${dataset()} WHERE ${where} AND blob1 = 'page_view'`),
    sql(`SELECT ${timeInterval} AS date, SUM(_sample_interval) AS pageviews, uniqExact(blob3) AS visitors FROM ${dataset()} WHERE ${where} AND blob1 = 'page_view' GROUP BY date ORDER BY date`),
    sql(`SELECT if(blob10 != '', blob10, if(blob5 != '', blob5, 'Direct')) AS label, SUM(_sample_interval) AS value FROM ${dataset()} WHERE ${where} AND blob1 = 'page_view' GROUP BY label ORDER BY value DESC LIMIT 8`),
    sql(`SELECT if(blob6 = '', 'Unknown', blob6) AS label, SUM(_sample_interval) AS value FROM ${dataset()} WHERE ${where} AND blob1 = 'page_view' GROUP BY label ORDER BY value DESC LIMIT 8`),
    sql(`SELECT if(blob7 = '', 'Unknown', blob7) AS label, SUM(_sample_interval) AS value FROM ${dataset()} WHERE ${where} AND blob1 = 'page_view' GROUP BY label ORDER BY value DESC LIMIT 8`),
    sql(`SELECT if(blob8 = '', 'Unknown', blob8) AS label, SUM(_sample_interval) AS value FROM ${dataset()} WHERE ${where} AND blob1 = 'page_view' GROUP BY label ORDER BY value DESC LIMIT 8`),
    sql(`SELECT if(blob9 = '', 'Unknown', blob9) AS label, SUM(_sample_interval) AS value FROM ${dataset()} WHERE ${where} AND blob1 = 'page_view' GROUP BY label ORDER BY value DESC LIMIT 8`),
    sql(`SELECT uniqExact(blob4) AS value FROM ${dataset()} WHERE index1 = ${stringLiteral(siteId)} AND timestamp >= NOW() - INTERVAL 10 MINUTE`),
  ]);

  const summary = summaryRows[0] ?? {};
  const pageviews = numberValue(summary.pageviews);
  const visitors = numberValue(summary.visitors);
  const sessions = numberValue(summary.sessions);
  const pagesPerSession = sessions > 0 ? Number((pageviews / sessions).toFixed(1)) : 0;
  const bounceRate = sessions > 0 ? Math.max(0, Math.min(100, Math.round(((sessions - Math.min(sessions, Math.max(0, pageviews - sessions))) / sessions) * 100))) : 0;

  return {
    range,
    pageviews,
    visitors,
    sessions,
    bounceRate,
    pagesPerSession,
    liveVisitors: numberValue(liveRows[0]?.value),
    traffic: trafficRows.map((row) => ({ date: dateValue(row.date), pageviews: numberValue(row.pageviews), visitors: numberValue(row.visitors) })),
    sources: metrics(sourceRows),
    devices: metrics(deviceRows),
    browsers: metrics(browserRows),
    os: metrics(osRows),
    countries: metrics(countryRows),
  };
}

export async function getPages(
  range: RangeKey,
  requestedSiteId?: string | null,
  filters?: AnalyticsFilter
): Promise<MetricRow[]> {
  const siteId = resolveSiteId(requestedSiteId);
  if (isDemoMode()) return demoPages;
  return metrics(await sql(`SELECT blob2 AS label, SUM(_sample_interval) AS value FROM ${dataset()} WHERE ${whereFor(range, siteId, filters)} AND blob1 = 'page_view' GROUP BY label ORDER BY value DESC LIMIT 20`));
}

export async function getEvents(
  range: RangeKey,
  requestedSiteId?: string | null,
  filters?: AnalyticsFilter
): Promise<MetricRow[]> {
  const siteId = resolveSiteId(requestedSiteId);
  if (isDemoMode()) return demoEvents;
  return metrics(await sql(`SELECT blob1 AS label, SUM(_sample_interval) AS value FROM ${dataset()} WHERE ${whereFor(range, siteId, filters)} GROUP BY label ORDER BY value DESC LIMIT 20`));
}

export async function getFunnel(
  range: RangeKey,
  requestedSiteId?: string | null,
  stepNames?: string[],
  filters?: AnalyticsFilter
): Promise<FunnelData> {
  const steps = stepNames && stepNames.length >= 2 ? stepNames : ["page_view", "signup_started", "signup_completed"];
  const siteId = resolveSiteId(requestedSiteId);

  if (isDemoMode()) return demoFunnel(range, steps);

  const where = whereFor(range, siteId, filters);
  const inList = steps.map((s) => stringLiteral(s)).join(", ");
  const rows = await sql(`SELECT blob1 AS step_name, uniqExact(blob3) AS count FROM ${dataset()} WHERE ${where} AND blob1 IN (${inList}) GROUP BY step_name`);

  const countsByName = new Map<string, number>();
  for (const row of rows) {
    countsByName.set(stringValue(row.step_name), numberValue(row.count));
  }

  const baseCount = countsByName.get(steps[0]) ?? 0;
  const resultSteps: FunnelStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const name = steps[i];
    const count = countsByName.get(name) ?? 0;
    const conversionRate = baseCount > 0 ? Math.round((count / baseCount) * 100) : 0;
    const prevCount = i > 0 ? (countsByName.get(steps[i - 1]) ?? 0) : count;
    const dropoffRate = prevCount > 0 && prevCount >= count ? Math.round(((prevCount - count) / prevCount) * 100) : 0;

    resultSteps.push({
      name,
      count,
      conversionRate,
      dropoffRate,
    });
  }

  return { range, steps: resultSteps };
}

export async function getLiveVisitors(requestedSiteId?: string | null): Promise<LiveVisitor[]> {
  const siteId = resolveSiteId(requestedSiteId);
  if (isDemoMode()) return demoLive;
  const rows = await sql(`SELECT if(blob9 = '', 'Unknown', blob9) AS country, if(blob6 = '', 'Unknown', blob6) AS device, if(blob7 = '', 'Unknown', blob7) AS browser, blob2 AS page, max(timestamp) AS lastSeen FROM ${dataset()} WHERE index1 = ${stringLiteral(siteId)} AND timestamp >= NOW() - INTERVAL 10 MINUTE GROUP BY country, device, browser, page, blob4 ORDER BY lastSeen DESC LIMIT 50`);
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

function whereFor(range: RangeKey, siteId: string, filters?: AnalyticsFilter) {
  let where = `index1 = ${stringLiteral(siteId)} AND timestamp >= NOW() - INTERVAL ${RANGES[range].interval}`;
  if (!filters) return where;

  if (filters.country) where += ` AND blob9 = ${stringLiteral(filters.country)}`;
  if (filters.device) where += ` AND blob6 = ${stringLiteral(filters.device)}`;
  if (filters.browser) where += ` AND blob7 = ${stringLiteral(filters.browser)}`;
  if (filters.os) where += ` AND blob8 = ${stringLiteral(filters.os)}`;
  if (filters.page) where += ` AND blob2 = ${stringLiteral(filters.page)}`;
  if (filters.source) {
    if (filters.source === "Direct") {
      where += ` AND (blob10 = 'Direct' OR (blob10 = '' AND blob5 = ''))`;
    } else {
      where += ` AND if(blob10 != '', blob10, if(blob5 != '', blob5, 'Direct')) = ${stringLiteral(filters.source)}`;
    }
  }
  return where;
}

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

const demoOverview = (range: RangeKey, filters?: AnalyticsFilter): OverviewData => {
  const isFiltered = Boolean(filters && Object.keys(filters).length > 0);
  const factor = isFiltered ? 0.35 : 1.0;

  const traffic24h: TrafficPoint[] = [
    { date: "00:00", pageviews: Math.round(180 * factor), visitors: Math.round(110 * factor) },
    { date: "03:00", pageviews: Math.round(95 * factor), visitors: Math.round(60 * factor) },
    { date: "06:00", pageviews: Math.round(240 * factor), visitors: Math.round(145 * factor) },
    { date: "09:00", pageviews: Math.round(620 * factor), visitors: Math.round(390 * factor) },
    { date: "12:00", pageviews: Math.round(840 * factor), visitors: Math.round(520 * factor) },
    { date: "15:00", pageviews: Math.round(920 * factor), visitors: Math.round(580 * factor) },
    { date: "18:00", pageviews: Math.round(780 * factor), visitors: Math.round(460 * factor) },
    { date: "21:00", pageviews: Math.round(410 * factor), visitors: Math.round(260 * factor) },
  ];

  const trafficDays: TrafficPoint[] = [
    { date: "2026-09-01", pageviews: Math.round(1241 * factor), visitors: Math.round(720 * factor) },
    { date: "2026-09-02", pageviews: Math.round(1690 * factor), visitors: Math.round(923 * factor) },
    { date: "2026-09-03", pageviews: Math.round(1432 * factor), visitors: Math.round(801 * factor) },
    { date: "2026-09-04", pageviews: Math.round(2110 * factor), visitors: Math.round(1210 * factor) },
    { date: "2026-09-05", pageviews: Math.round(1894 * factor), visitors: Math.round(1005 * factor) },
    { date: "2026-09-06", pageviews: Math.round(2476 * factor), visitors: Math.round(1392 * factor) },
    { date: "2026-09-07", pageviews: Math.round(1998 * factor), visitors: Math.round(1151 * factor) },
  ];

  return {
    range,
    pageviews: Math.round(12_841 * factor),
    visitors: Math.round(7_202 * factor),
    sessions: Math.round(8_116 * factor),
    bounceRate: 34.2,
    pagesPerSession: 2.1,
    liveVisitors: Math.max(1, Math.round(27 * factor)),
    traffic: range === "24h" ? traffic24h : trafficDays,
    sources: [
      { label: "Google", value: Math.round(41 * factor) },
      { label: "Direct", value: Math.round(25 * factor) },
      { label: "ChatGPT", value: Math.round(14 * factor) },
      { label: "Reddit", value: Math.round(8 * factor) },
      { label: "LinkedIn", value: Math.round(5 * factor) },
    ],
    devices: [
      { label: "Mobile", value: 62 },
      { label: "Desktop", value: 33 },
      { label: "Tablet", value: 5 },
    ],
    browsers: [
      { label: "Chrome", value: 64 },
      { label: "Safari", value: 23 },
      { label: "Firefox", value: 7 },
      { label: "Edge", value: 6 },
    ],
    os: [
      { label: "macOS", value: 42 },
      { label: "Windows", value: 28 },
      { label: "iOS", value: 18 },
      { label: "Android", value: 9 },
      { label: "Linux", value: 3 },
    ],
    countries: [
      { label: "India", value: Math.round(41 * factor) },
      { label: "United States", value: Math.round(27 * factor) },
      { label: "United Kingdom", value: Math.round(9 * factor) },
      { label: "Germany", value: Math.round(6 * factor) },
    ],
  };
};

const demoFunnel = (range: RangeKey, steps: string[]): FunnelData => {
  const counts = [7202, 1842, 614, 381, 192];
  const resultSteps: FunnelStep[] = [];
  const base = counts[0];

  for (let i = 0; i < steps.length; i++) {
    const count = counts[i] ?? Math.round(counts[counts.length - 1] / (i + 1));
    const conversionRate = Math.round((count / base) * 100);
    const prevCount = i > 0 ? (counts[i - 1] ?? count) : count;
    const dropoffRate = prevCount > 0 ? Math.round(((prevCount - count) / prevCount) * 100) : 0;
    resultSteps.push({
      name: steps[i],
      count,
      conversionRate,
      dropoffRate,
    });
  }

  return { range, steps: resultSteps };
};

const demoPages = [
  { label: "/", value: 8231 },
  { label: "/pricing", value: 5842 },
  { label: "/features", value: 3219 },
  { label: "/signup", value: 1842 },
  { label: "/blog/how-ai-works", value: 921 },
];

const demoEvents = [
  { label: "page_view", value: 12_841 },
  { label: "start_trial_clicked", value: 821 },
  { label: "signup_started", value: 614 },
  { label: "signup_completed", value: 381 },
  { label: "pricing_toggle", value: 293 },
];

const demoLive = [
  { country: "India", device: "Mobile", browser: "Chrome", page: "/pricing", lastSeen: "now" },
  { country: "United States", device: "Desktop", browser: "Safari", page: "/features", lastSeen: "now" },
  { country: "India", device: "Mobile", browser: "Chrome", page: "/signup", lastSeen: "now" },
];
