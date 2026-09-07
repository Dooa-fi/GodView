import { describe, expect, it } from "vitest";
import { getFunnel, getOverview, parseFilters, parseRange, resolveSiteId, rowsFromResult, sanitizeFilterValue } from "./analytics";

describe("analytics query helpers", () => {
  it("accepts only the supported date ranges", () => {
    expect(parseRange("24h")).toBe("24h");
    expect(parseRange("30d")).toBe("30d");
    expect(parseRange("all-time")).toBe("7d");
    expect(parseRange(null)).toBe("7d");
  });

  it("normalizes SQL API row results and rejects malformed data", () => {
    expect(rowsFromResult([{ label: "India", value: "4" }])).toEqual([{ label: "India", value: "4" }]);
    expect(rowsFromResult({ data: [{ label: "Mobile", value: 2 }] })).toEqual([{ label: "Mobile", value: 2 }]);
    expect(rowsFromResult({ data: "not-an-array" })).toEqual([]);
  });

  it("sanitizes and resolves requested site IDs safely", () => {
    process.env.GODVIEW_SITE_ID = "site_default";
    expect(resolveSiteId("site_custom_123")).toBe("site_custom_123");
    expect(resolveSiteId("  site_trimmed  ")).toBe("site_trimmed");
    expect(resolveSiteId("site.with-dashes_and_dots")).toBe("site.with-dashes_and_dots");
    // Invalid characters or injection strings fallback to configured default
    expect(resolveSiteId("site' OR 1=1--")).toBe("site_default");
    expect(resolveSiteId(null)).toBe("site_default");
    expect(resolveSiteId("")).toBe("site_default");
  });

  it("sanitizes filter values and extracts active filters from parameters", () => {
    expect(sanitizeFilterValue("United States")).toBe("United States");
    expect(sanitizeFilterValue("Chrome 120.0")).toBe("Chrome 120.0");
    expect(sanitizeFilterValue("/pricing/pro")).toBe("/pricing/pro");
    // Reject quotes or potential SQL injection fragments
    expect(sanitizeFilterValue("US' OR '1'='1")).toBeUndefined();
    expect(sanitizeFilterValue("; DROP TABLE users--")).toBeUndefined();

    const params = new URLSearchParams({
      country: "United States",
      device: "Desktop",
      browser: "Chrome",
      os: "macOS",
      source: "Google",
      page: "/pricing",
      ignored: "extra_param",
    });
    const parsed = parseFilters(params);
    expect(parsed).toEqual({
      country: "United States",
      device: "Desktop",
      browser: "Chrome",
      os: "macOS",
      source: "Google",
      page: "/pricing",
    });
  });

  it("returns extended breakdown metrics in demo mode overview", async () => {
    process.env.GODVIEW_DEMO_MODE = "true";
    const data = await getOverview("24h", "site_test");
    expect(data.range).toBe("24h");
    expect(data.bounceRate).toBeGreaterThan(0);
    expect(data.pagesPerSession).toBeGreaterThan(0);
    expect(data.browsers.length).toBeGreaterThan(0);
    expect(data.os.length).toBeGreaterThan(0);
    // 24h range should have hourly traffic data points
    expect(data.traffic[0].date).toBe("00:00");
  });

  it("computes conversion funnel metrics correctly in demo mode", async () => {
    process.env.GODVIEW_DEMO_MODE = "true";
    const funnel = await getFunnel("7d", "site_test", ["page_view", "signup_started", "signup_completed"]);
    expect(funnel.range).toBe("7d");
    expect(funnel.steps).toHaveLength(3);
    expect(funnel.steps[0].name).toBe("page_view");
    expect(funnel.steps[0].conversionRate).toBe(100);
    expect(funnel.steps[0].dropoffRate).toBe(0);

    expect(funnel.steps[1].name).toBe("signup_started");
    expect(funnel.steps[1].conversionRate).toBeLessThanOrEqual(100);
    expect(funnel.steps[1].dropoffRate).toBeGreaterThan(0);

    expect(funnel.steps[2].name).toBe("signup_completed");
    expect(funnel.steps[2].conversionRate).toBeLessThanOrEqual(funnel.steps[1].conversionRate);
  });
});

