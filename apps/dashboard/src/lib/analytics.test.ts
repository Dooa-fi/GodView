import { describe, expect, it } from "vitest";
import { parseRange, resolveSiteId, rowsFromResult } from "./analytics";

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
});

