import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTracker, type Tracker } from "./index.js";

const ENDPOINT = "https://collector.test/v1/events";
const FLUSH_DELAY_MS = 3_000;

let fetchMock: ReturnType<typeof vi.fn>;
let tracker: Tracker | undefined;

function lastBody() {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse(call[1].body) as { events: { event: string; context: { page: string }; properties?: Record<string, string | number | boolean> }[] };
}

function stubNavigator(sendBeacon = vi.fn()) {
  vi.stubGlobal("navigator", { sendBeacon, language: "en-US", userAgent: "happy-dom" });
  return sendBeacon;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  tracker?.stop();
  tracker = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createTracker", () => {
  it("buffers automatic events and sends one batch after the flush delay", () => {
    tracker = createTracker({ endpoint: ENDPOINT, siteId: "site_1" });
    tracker.start();

    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FLUSH_DELAY_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().events.map((event) => event.event)).toEqual(["page_view"]);
  });

  it("flushes immediately once the batch reaches its maximum size", () => {
    tracker = createTracker({ endpoint: ENDPOINT, siteId: "site_1" });
    tracker.start();

    for (let i = 0; i < 8; i++) tracker.track("click", { label: "x" });
    expect(fetchMock).not.toHaveBeenCalled();

    tracker.track("click", { label: "x" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().events).toHaveLength(10);

    vi.advanceTimersByTime(FLUSH_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses sendBeacon with the queued events when the page is hidden", () => {
    const sendBeacon = stubNavigator();
    tracker = createTracker({ endpoint: ENDPOINT, siteId: "site_1" });
    tracker.start();

    window.dispatchEvent(new Event("pagehide"));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe(ENDPOINT);
    const body = JSON.parse(sendBeacon.mock.calls[0][1]) as { events: { event: string; properties?: Record<string, string | number | boolean> }[] };
    expect(body.events.map((event) => event.event)).toEqual(["page_view", "session_end"]);
    expect(body.events[1].properties?.durationSeconds).toBe(0);
  });

  it("reports session duration since the session started, not since the last activity", () => {
    const sendBeacon = stubNavigator();
    const startedAt = Date.now() - 120_000;
    localStorage.setItem("openpulse:visitor", "visitor_1");
    localStorage.setItem("openpulse:session", `session_1.${Date.now() - 5_000}`);
    localStorage.setItem("openpulse:session-start", String(startedAt));

    tracker = createTracker({ endpoint: ENDPOINT, siteId: "site_1" });
    tracker.start();
    tracker.track("click", { label: "x" });

    window.dispatchEvent(new Event("pagehide"));

    const body = JSON.parse(sendBeacon.mock.calls[0][1]) as { events: { event: string; properties?: Record<string, string | number | boolean> }[] };
    const sessionEnd = body.events.find((event) => event.event === "session_end");
    expect(sessionEnd?.properties?.durationSeconds).toBe(120);
    expect(localStorage.getItem("godview:visitor")).toBe("visitor_1");
  });

  it("creates and reuses godview:visitor and godview:session keys", () => {
    tracker = createTracker({ endpoint: ENDPOINT, siteId: "site_1" });
    tracker.start();

    const visitorId = localStorage.getItem("godview:visitor");
    const session = localStorage.getItem("godview:session");
    expect(visitorId).toBeTruthy();
    expect(session).toBeTruthy();

    tracker.track("click", { label: "btn" });
    expect(localStorage.getItem("godview:visitor")).toBe(visitorId);
  });

  it("tracks single-page-app route changes through the history API", () => {
    tracker = createTracker({ endpoint: ENDPOINT, siteId: "site_1" });
    tracker.start();

    history.pushState({}, "", "/pricing");
    vi.advanceTimersByTime(FLUSH_DELAY_MS);

    const events = lastBody().events;
    expect(events.map((event) => event.event)).toEqual(["page_view", "page_view"]);
    expect(events[1].context.page).toBe("/pricing");
  });

  it("ignores route changes that do not alter the URL", () => {
    tracker = createTracker({ endpoint: ENDPOINT, siteId: "site_1" });
    tracker.start();

    history.pushState({}, "", window.location.href);
    history.pushState({}, "", "");
    vi.advanceTimersByTime(FLUSH_DELAY_MS);

    expect(lastBody().events.map((event) => event.event)).toEqual(["page_view"]);
  });

  it("drops custom events that are not in the configured allowlist", () => {
    tracker = createTracker({ endpoint: ENDPOINT, siteId: "site_1", allowedEvents: ["signup_started"] });
    tracker.start();

    tracker.track("signup_started", { plan: "pro" });
    tracker.track("purchase_completed", { plan: "pro" });
    vi.advanceTimersByTime(FLUSH_DELAY_MS);

    expect(lastBody().events.map((event) => event.event)).toEqual(["page_view", "signup_started"]);
  });
});
