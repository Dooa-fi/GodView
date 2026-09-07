import { describe, expect, it, beforeEach } from "vitest";
import { GET as healthGET } from "../app/api/health/route";
import { GET as sitesGET, POST as sitesPOST, DELETE as sitesDELETE } from "../app/api/sites/route";
import { GET as overviewGET } from "../app/api/analytics/overview/route";
import { GET as pagesGET } from "../app/api/analytics/pages/route";
import { GET as eventsGET } from "../app/api/analytics/events/route";
import { GET as funnelsGET } from "../app/api/analytics/funnels/route";
import { GET as liveGET } from "../app/api/analytics/live/route";

describe("GodView E2E API Route Verification", () => {
  beforeEach(() => {
    process.env.GODVIEW_DEMO_MODE = "true";
  });

  it("1. GET /api/health returns ok: true and service name", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, service: "godview-dashboard" });
  });

  it("2. /api/sites handles GET, POST, and DELETE", async () => {
    // List sites
    const listRes = await sitesGET();
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(Array.isArray(listBody.sites)).toBe(true);
    expect(listBody.sites.length).toBeGreaterThan(0);

    // Create new site
    const postReq = new Request("http://localhost/api/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "E2E Test Site",
        origins: ["https://test.example.com"],
      }),
    });
    const postRes = await sitesPOST(postReq);
    expect(postRes.status).toBe(201);
    const postBody = await postRes.json();
    expect(postBody.site).toBeDefined();
    expect(postBody.site.name).toBe("E2E Test Site");
    expect(postBody.site.origins).toEqual(["https://test.example.com"]);

    // Delete created site
    const deleteReq = new Request(`http://localhost/api/sites?id=${encodeURIComponent(postBody.site.id)}`, {
      method: "DELETE",
    });
    const deleteRes = await sitesDELETE(deleteReq);
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.ok).toBe(true);
  });

  it("3. GET /api/analytics/overview returns 6 metrics, breakdown dimensions, and hourly curve", async () => {
    // 24h range test
    const req24h = new Request("http://localhost/api/analytics/overview?range=24h&siteId=site_test");
    const res24h = await overviewGET(req24h);
    expect(res24h.status).toBe(200);
    const data24h = await res24h.json();

    expect(data24h.range).toBe("24h");
    expect(data24h.pageviews).toBeGreaterThan(0);
    expect(data24h.visitors).toBeGreaterThan(0);
    expect(data24h.sessions).toBeGreaterThan(0);
    expect(data24h.bounceRate).toBeDefined();
    expect(data24h.pagesPerSession).toBeDefined();
    expect(data24h.liveVisitors).toBeGreaterThan(0);

    // Hourly traffic points
    expect(data24h.traffic.length).toBeGreaterThanOrEqual(8);
    expect(data24h.traffic[0].date).toMatch(/^\d{2}:\d{2}$/);

    // Technology breakdown: devices, browsers, os
    expect(data24h.devices.length).toBeGreaterThan(0);
    expect(data24h.browsers.length).toBeGreaterThan(0);
    expect(data24h.os.length).toBeGreaterThan(0);
    expect(data24h.countries.length).toBeGreaterThan(0);
    expect(data24h.sources.length).toBeGreaterThan(0);

    // Filtered query test
    const filteredReq = new Request("http://localhost/api/analytics/overview?range=7d&country=United+States&device=Desktop");
    const filteredRes = await overviewGET(filteredReq);
    expect(filteredRes.status).toBe(200);
    const filteredData = await filteredRes.json();
    expect(filteredData.pageviews).toBeDefined();
  });

  it("4. GET /api/analytics/pages returns ranked pages", async () => {
    const req = new Request("http://localhost/api/analytics/pages?range=7d");
    const res = await pagesGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.pages)).toBe(true);
    expect(data.pages.length).toBeGreaterThan(0);
    expect(data.pages[0].label).toBe("/");
    expect(data.pages[0].value).toBeGreaterThan(0);
  });

  it("5. GET /api/analytics/events returns ranked events", async () => {
    const req = new Request("http://localhost/api/analytics/events?range=7d");
    const res = await eventsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.events)).toBe(true);
    expect(data.events.length).toBeGreaterThan(0);
    expect(data.events.some((e: any) => e.label === "page_view")).toBe(true);
  });

  it("6. GET /api/analytics/funnels computes sequential conversion and drop-off rates", async () => {
    const req = new Request("http://localhost/api/analytics/funnels?range=7d&steps=page_view,signup_started,signup_completed");
    const res = await funnelsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.range).toBe("7d");
    expect(data.steps).toHaveLength(3);

    // Step 0: Base step (100% conversion, 0% dropoff)
    expect(data.steps[0].name).toBe("page_view");
    expect(data.steps[0].conversionRate).toBe(100);
    expect(data.steps[0].dropoffRate).toBe(0);

    // Step 1: Intermediate step
    expect(data.steps[1].name).toBe("signup_started");
    expect(data.steps[1].conversionRate).toBeLessThanOrEqual(100);
    expect(data.steps[1].dropoffRate).toBeGreaterThan(0);

    // Step 2: Final step
    expect(data.steps[2].name).toBe("signup_completed");
    expect(data.steps[2].conversionRate).toBeLessThanOrEqual(data.steps[1].conversionRate);
  });

  it("7. GET /api/analytics/live returns real-time active visitors", async () => {
    const req = new Request("http://localhost/api/analytics/live?siteId=site_test");
    const res = await liveGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.visitors)).toBe(true);
    expect(data.visitors.length).toBeGreaterThan(0);
    expect(data.visitors[0].country).toBeDefined();
    expect(data.visitors[0].device).toBeDefined();
    expect(data.visitors[0].browser).toBeDefined();
    expect(data.visitors[0].page).toBeDefined();
  });
});
