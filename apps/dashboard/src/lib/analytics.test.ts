import { describe, expect, it } from "vitest";
import { parseRange, rowsFromResult } from "./analytics";

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
});
