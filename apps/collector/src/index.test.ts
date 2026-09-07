import { describe, expect, it, vi } from "vitest";
import worker from "./index.js";

const ORIGIN = "https://example.com";

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    EVENTS: { writeDataPoint: vi.fn() },
    ALLOWED_ORIGINS_JSON: JSON.stringify([ORIGIN]),
    ALLOWED_CUSTOM_EVENTS_JSON: JSON.stringify(["signup_started"]),
    ...overrides,
  };
}

function makeRequest(events: unknown, { origin = ORIGIN }: { origin?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request("https://collector.test/v1/events", {
    method: "POST",
    headers,
    body: JSON.stringify(events),
  });
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    event: "page_view",
    timestamp: new Date().toISOString(),
    siteId: "site_1",
    sessionId: "session_1",
    visitorId: "visitor_1",
    context: { page: "/", url: "https://example.com/" },
    ...overrides,
  };
}

describe("collector", () => {
  it("answers health checks", async () => {
    const response = await worker.fetch(new Request("https://collector.test/health"), makeEnv());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("allows preflight requests from allowed origins", async () => {
    const response = await worker.fetch(
      new Request("https://collector.test/v1/events", { method: "OPTIONS", headers: { origin: ORIGIN } }),
      makeEnv(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("rejects requests from origins that are not allowed", async () => {
    const response = await worker.fetch(makeRequest({ events: [makeEvent()] }, { origin: "https://evil.test" }), makeEnv());
    expect(response.status).toBe(403);
  });

  it("rejects malformed JSON bodies", async () => {
    const request = new Request("https://collector.test/v1/events", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: "{not json",
    });
    const response = await worker.fetch(request, makeEnv());
    expect(response.status).toBe(400);
  });

  it("rejects batches outside the 1-20 event range", async () => {
    const tooMany = await worker.fetch(makeRequest({ events: Array.from({ length: 21 }, () => makeEvent()) }), makeEnv());
    expect(tooMany.status).toBe(400);

    const empty = await worker.fetch(makeRequest({ events: [] }), makeEnv());
    expect(empty.status).toBe(400);
  });

  it("rejects custom events outside the configured allowlist", async () => {
    const response = await worker.fetch(
      makeRequest({ events: [makeEvent({ event: "purchase_completed" })] }),
      makeEnv(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Event not allowed: purchase_completed" });
  });

  it("rejects all custom events when no allowlist is configured", async () => {
    const response = await worker.fetch(
      makeRequest({ events: [makeEvent({ event: "signup_started" })] }),
      makeEnv({ ALLOWED_CUSTOM_EVENTS_JSON: undefined }),
    );
    expect(response.status).toBe(400);
  });

  it("accepts automatic and allowlisted custom events, writing one data point each", async () => {
    const env = makeEnv();
    const response = await worker.fetch(
      makeRequest({ events: [makeEvent(), makeEvent({ event: "signup_started", properties: { plan: "pro" } })] }),
      env,
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 2 });
    expect(env.EVENTS.writeDataPoint).toHaveBeenCalledTimes(2);
  });
});

describe("collector site provisioning", () => {
  function makeKv() {
    return { get: vi.fn(), put: vi.fn(), list: vi.fn() };
  }

  function adminRequest(method: string, body?: unknown, token = "admin-token") {
    return new Request("https://collector.test/v1/sites", {
      method,
      headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("rejects ingestion requests that carry no origin header", async () => {
    const response = await worker.fetch(makeRequest({ events: [makeEvent()] }, { origin: null }), makeEnv());
    expect(response.status).toBe(403);
  });

  it("returns 503 when the KV binding or admin token is not configured", async () => {
    const response = await worker.fetch(adminRequest("GET"), makeEnv());
    expect(response.status).toBe(503);
  });

  it("rejects admin requests without a valid bearer token", async () => {
    const kv = makeKv();
    const env = makeEnv({ SITES: kv as unknown as KVNamespace, ADMIN_TOKEN: "admin-token" });
    const noToken = await worker.fetch(adminRequest("GET", undefined, ""), env);
    expect(noToken.status).toBe(401);
    const wrongToken = await worker.fetch(adminRequest("GET", undefined, "wrong"), env);
    expect(wrongToken.status).toBe(401);
    expect(kv.get).not.toHaveBeenCalled();
  });

  it("creates a site and stores it under its site id", async () => {
    const kv = makeKv();
    const env = makeEnv({ SITES: kv as unknown as KVNamespace, ADMIN_TOKEN: "admin-token" });
    const response = await worker.fetch(
      adminRequest("POST", { name: "Marketing site", origins: ["https://example.com", "https://www.example.com"] }),
      env,
    );
    expect(response.status).toBe(201);
    const { site } = await response.json() as { site: { id: string; name: string; origins: string[] } };
    expect(site.id).toMatch(/^site_[0-9a-f]{12}$/);
    expect(site.name).toBe("Marketing site");
    expect(site.origins).toEqual(["https://example.com", "https://www.example.com"]);
    expect(kv.put).toHaveBeenCalledWith(`site:${site.id}`, expect.stringContaining(site.id));
  });

  it("rejects site creation with malformed origins", async () => {
    const kv = makeKv();
    const env = makeEnv({ SITES: kv as unknown as KVNamespace, ADMIN_TOKEN: "admin-token" });
    const response = await worker.fetch(adminRequest("POST", { name: "Bad", origins: ["https://example.com/some/path"] }), env);
    expect(response.status).toBe(400);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("lists provisioned sites", async () => {
    const kv = makeKv();
    kv.list.mockResolvedValue({ keys: [{ name: "site:site_abc" }, { name: "site:site_def" }] });
    kv.get.mockImplementation((key: string) => Promise.resolve(
      key === "site:site_abc"
        ? JSON.stringify({ id: "site_abc", name: "A", origins: ["https://a.test"], createdAt: "2026-09-01T00:00:00.000Z" })
        : JSON.stringify({ id: "site_def", name: "B", origins: ["https://b.test"], createdAt: "2026-09-02T00:00:00.000Z" }),
    ));
    const env = makeEnv({ SITES: kv as unknown as KVNamespace, ADMIN_TOKEN: "admin-token" });
    const response = await worker.fetch(adminRequest("GET"), env);
    expect(response.status).toBe(200);
    const { sites } = await response.json() as { sites: Array<{ id: string }> };
    expect(sites.map((site) => site.id)).toEqual(["site_abc", "site_def"]);
  });

  it("accepts ingestion from a provisioned site origin", async () => {
    const kv = makeKv();
    kv.get.mockResolvedValue(JSON.stringify({ id: "site_1", name: "Provisioned", origins: ["https://provisioned.test"], createdAt: "2026-09-01T00:00:00.000Z" }));
    const env = makeEnv({ SITES: kv as unknown as KVNamespace });
    const response = await worker.fetch(
      makeRequest({ events: [makeEvent()] }, { origin: "https://provisioned.test" }),
      env,
    );
    expect(response.status).toBe(202);
  });

  it("rejects ingestion from an origin outside the provisioned site, ignoring the global allowlist", async () => {
    const kv = makeKv();
    kv.get.mockResolvedValue(JSON.stringify({ id: "site_1", name: "Provisioned", origins: ["https://provisioned.test"], createdAt: "2026-09-01T00:00:00.000Z" }));
    const env = makeEnv({ SITES: kv as unknown as KVNamespace });
    const response = await worker.fetch(makeRequest({ events: [makeEvent()] }), env);
    expect(response.status).toBe(403);
  });

  it("supports GODVIEW_ALLOWED_ORIGINS_JSON environment variable", async () => {
    const env = {
      EVENTS: { writeDataPoint: vi.fn() },
      GODVIEW_ALLOWED_ORIGINS_JSON: JSON.stringify(["https://godview.app"]),
    };
    const response = await worker.fetch(
      makeRequest({ events: [makeEvent()] }, { origin: "https://godview.app" }),
      env,
    );
    expect(response.status).toBe(202);
  });

  it("supports GODVIEW_ADMIN_TOKEN environment variable", async () => {
    const kv = makeKv();
    kv.list.mockResolvedValue({ keys: [] });
    const env = {
      EVENTS: { writeDataPoint: vi.fn() },
      SITES: kv as unknown as KVNamespace,
      GODVIEW_ADMIN_TOKEN: "godview-secret",
    };
    const request = new Request("https://collector.test/v1/sites", {
      headers: { authorization: "Bearer godview-secret" },
    });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);
  });
});

