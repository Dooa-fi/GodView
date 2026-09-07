import { isAutomaticEventName, type AnalyticsEvent, type EventBatch, type SiteRecord } from "@godview/shared";

interface Env {
  EVENTS: AnalyticsEngineDataset;
  SITES?: KVNamespace;
  GODVIEW_ADMIN_TOKEN?: string;
  ADMIN_TOKEN?: string;
  GODVIEW_ALLOWED_ORIGINS_JSON?: string;
  ALLOWED_ORIGINS_JSON?: string;
  GODVIEW_ALLOWED_CUSTOM_EVENTS_JSON?: string;
  ALLOWED_CUSTOM_EVENTS_JSON?: string;
}

const MAX_BODY_BYTES = 64_000;
const MAX_EVENTS_PER_REQUEST = 20;
const MAX_ORIGINS_PER_SITE = 20;
const SITE_KEY_PREFIX = "site:";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (url.pathname === "/health") return json({ ok: true }, cors);
    if (url.pathname === "/v1/sites") return handleSites(request, env, cors);
    if (url.pathname !== "/v1/events" || request.method !== "POST") return json({ error: "Not found" }, cors, 404);
    return handleEvents(request, env, origin, cors);
  },
};

async function handleEvents(request: Request, env: Env, origin: string | null, cors: Headers): Promise<Response> {
  if (!origin) return json({ error: "Origin required" }, cors, 403);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: "Payload too large" }, cors, 413);

  let body: unknown;
  try {
    body = await request.json<unknown>();
  } catch {
    return json({ error: "Invalid JSON" }, cors, 400);
  }
  if (!isEventBatch(body) || body.events.length === 0 || body.events.length > MAX_EVENTS_PER_REQUEST) {
    return json({ error: "Expected 1–20 events" }, cors, 400);
  }

  const validEvents = body.events.filter(isValidEvent);
  if (validEvents.length !== body.events.length) return json({ error: "Invalid event payload" }, cors, 400);
  if (!(await originsAllowed(env, validEvents, origin))) return json({ error: "Origin not allowed" }, cors, 403);
  const allowedCustomEvents = getAllowedCustomEvents(env);
  const blocked = validEvents.find((event) => !isAutomaticEventName(event.event) && !allowedCustomEvents.includes(event.event));
  if (blocked) return json({ error: `Event not allowed: ${blocked.event}` }, cors, 400);
  const country = typeof request.cf?.country === "string" ? request.cf.country : undefined;
  for (const event of validEvents) writeEvent(env.EVENTS, event, country);
  return json({ accepted: validEvents.length }, cors, 202);
}

async function originsAllowed(env: Env, events: AnalyticsEvent[], origin: string): Promise<boolean> {
  const globalOrigins = getAllowedOrigins(env);
  for (const siteId of new Set(events.map((event) => event.siteId))) {
    const site = env.SITES ? await getSite(env.SITES, siteId) : undefined;
    if (site ? !site.origins.includes(origin) : !globalOrigins.includes(origin)) return false;
  }
  return true;
}

async function getSite(sites: KVNamespace, siteId: string): Promise<SiteRecord | undefined> {
  const stored = await sites.get(`${SITE_KEY_PREFIX}${siteId}`, { cacheTtl: 60 });
  return stored ? parseSite(stored) : undefined;
}

function parseSite(value: string): SiteRecord | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<SiteRecord>;
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string" || !Array.isArray(parsed.origins)) return undefined;
    return { id: parsed.id, name: parsed.name, origins: parsed.origins, createdAt: parsed.createdAt ?? "" };
  } catch {
    return undefined;
  }
}

async function handleSites(request: Request, env: Env, cors: Headers): Promise<Response> {
  const sites = env.SITES;
  const adminToken = getAdminToken(env);
  if (!sites || !adminToken) return json({ error: "Site provisioning is not configured" }, cors, 503);
  if (request.headers.get("authorization") !== `Bearer ${adminToken}`) return json({ error: "Unauthorized" }, cors, 401);

  if (request.method === "GET") {
    const list = await sites.list({ prefix: SITE_KEY_PREFIX });
    const values = await Promise.all(list.keys.map((key) => sites.get(key.name)));
    return json({ sites: values.flatMap((value) => (value ? [parseSite(value)] : [])) }, cors);
  }

  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json<unknown>();
    } catch {
      return json({ error: "Invalid JSON" }, cors, 400);
    }
    const { name, origins } = (body ?? {}) as { name?: unknown; origins?: unknown };
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
      return json({ error: "Expected a site name of 1–100 characters" }, cors, 400);
    }
    if (!Array.isArray(origins) || origins.length === 0 || origins.length > MAX_ORIGINS_PER_SITE
      || !origins.every((item) => typeof item === "string" && isOrigin(item))) {
      return json({ error: `Expected 1–${MAX_ORIGINS_PER_SITE} allowed origins like https://example.com` }, cors, 400);
    }
    const site: SiteRecord = {
      id: `site_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
      name: name.trim(),
      origins: origins as string[],
      createdAt: new Date().toISOString(),
    };
    await sites.put(`${SITE_KEY_PREFIX}${site.id}`, JSON.stringify(site));
    return json({ site }, cors, 201);
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const siteId = url.searchParams.get("id");
    if (!siteId || siteId.length > 64) return json({ error: "Valid site id required" }, cors, 400);
    await sites.delete(`${SITE_KEY_PREFIX}${siteId}`);
    return json({ ok: true, deleted: siteId }, cors);
  }

  return json({ error: "Not found" }, cors, 404);
}

function isOrigin(value: string) {
  return /^https?:\/\/[^\s/]+$/i.test(value);
}

function writeEvent(dataset: AnalyticsEngineDataset, event: AnalyticsEvent, country?: string) {
  const properties = event.properties ?? {};
  dataset.writeDataPoint({
    // Analytics Engine uses exactly one index as its sampling key. All other
    // dimensions belong in blobs and are queried through the SQL API.
    indexes: [event.siteId],
    blobs: [
      event.event,
      event.context.page,
      event.visitorId,
      event.sessionId,
      event.context.referrer ?? "",
      event.context.device ?? "",
      event.context.browser ?? "",
      event.context.os ?? "",
      country ?? "",
      event.context.utmSource ?? "",
      event.context.utmMedium ?? "",
      event.context.utmCampaign ?? "",
      JSON.stringify(properties).slice(0, 1_024),
    ],
    doubles: [Date.parse(event.timestamp), event.context.screenWidth ?? 0, event.context.screenHeight ?? 0],
  });
}

function isValidEvent(value: unknown): value is AnalyticsEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<AnalyticsEvent>;
  const context = event.context;
  if (!context) return false;
  return typeof event.event === "string" && event.event.length <= 80
    && typeof event.siteId === "string" && event.siteId.length > 0 && event.siteId.length <= 64
    && typeof event.sessionId === "string" && event.sessionId.length <= 64
    && typeof event.visitorId === "string" && event.visitorId.length <= 64
    && typeof event.timestamp === "string" && !Number.isNaN(Date.parse(event.timestamp))
    && typeof context.page === "string" && context.page.length <= 512
    && typeof context.url === "string" && context.url.length <= 2_048;
}

function isEventBatch(value: unknown): value is EventBatch {
  return Boolean(value) && typeof value === "object" && Array.isArray((value as Partial<EventBatch>).events);
}

function getAdminToken(env: Env): string | undefined {
  return env.GODVIEW_ADMIN_TOKEN || env.ADMIN_TOKEN;
}

function getAllowedOrigins(env: Env): string[] {
  return parseOrigins(env.GODVIEW_ALLOWED_ORIGINS_JSON || env.ALLOWED_ORIGINS_JSON);
}

function getAllowedCustomEvents(env: Env): unknown[] {
  return parseJsonArray(env.GODVIEW_ALLOWED_CUSTOM_EVENTS_JSON || env.ALLOWED_CUSTOM_EVENTS_JSON);
}

// The browser only needs the preflight to pass so the request can be sent;
// origin authorization happens per site in handleEvents.
function corsHeaders(origin: string | null) {
  const headers = new Headers({
    "access-control-allow-methods": "POST, OPTIONS, GET, DELETE",
    "access-control-allow-headers": "content-type, authorization",
    "content-type": "application/json",
    "x-content-type-options": "nosniff",
    "vary": "Origin",
  });
  if (origin) headers.set("access-control-allow-origin", origin);
  return headers;
}

function parseOrigins(value?: string) {
  const parsed = parseJsonArray(value);
  return parsed.every((item) => typeof item === "string") ? parsed as string[] : [];
}

function parseJsonArray(value?: string): unknown[] {
  try { return value ? JSON.parse(value) as unknown[] : []; } catch { return []; }
}

function json(value: unknown, headers: Headers, status = 200) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

