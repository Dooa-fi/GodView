import { isAutomaticEventName, type AnalyticsEvent, type EventContext, type EventName } from "@godview/shared";

export interface TrackerOptions {
  endpoint: string;
  siteId: string;
  /** Set false to disable automatic browser interaction tracking. */
  autoTrack?: boolean;
  /** Additional custom event names this tracker may send. Automatic events are always allowed. */
  allowedEvents?: string[];
}

export interface Tracker {
  start(): void;
  /** Stop automatic tracking and cancel the pending flush. */
  stop(): void;
  track(event: EventName, properties?: Record<string, string | number | boolean>): void;
  page(): void;
}

const VISITOR_KEY = "godview:visitor";
const SESSION_KEY = "godview:session";
const SESSION_START_KEY = "godview:session-start";
const LEGACY_VISITOR_KEY = "openpulse:visitor";
const LEGACY_SESSION_KEY = "openpulse:session";
const LEGACY_SESSION_START_KEY = "openpulse:session-start";
const SESSION_TTL_MS = 30 * 60 * 1000;
const SCROLL_MILESTONES = [25, 50, 75, 90];
const MAX_BATCH_SIZE = 10;
const FLUSH_DELAY_MS = 3_000;

export function createTracker(options: TrackerOptions): Tracker {
  const autoTrack = options.autoTrack ?? true;
  const allowedEvents = options.allowedEvents ? new Set<string>(options.allowedEvents) : null;
  let started = false;
  let unloading = false;
  let lastTrackedUrl = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let sentScrollMilestones = new Set<number>();
  const queue: AnalyticsEvent[] = [];
  const activeForms = new Set<string>();
  const submittedForms = new Set<string>();
  const listeners: { target: EventTarget; type: string; listener: EventListener; options?: AddEventListenerOptions }[] = [];

  const listen = <T extends Event>(
    target: EventTarget,
    type: string,
    listener: (event: T) => void,
    options?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, listener as EventListener, options);
    listeners.push({ target, type, listener: listener as EventListener, options });
  };

  const track = (event: EventName, properties?: Record<string, string | number | boolean>) => {
    if (allowedEvents && !isAutomaticEventName(event) && !allowedEvents.has(event)) return;
    const payload: AnalyticsEvent = {
      event,
      timestamp: new Date().toISOString(),
      siteId: options.siteId,
      visitorId: getOrCreateId(VISITOR_KEY),
      sessionId: getOrCreateSession().id,
      context: getContext(),
      properties: sanitizeProperties(properties),
    };

    queue.push(payload);
    if (queue.length >= MAX_BATCH_SIZE) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  };

  const flush = () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (queue.length === 0) return;
    sendBatch(options.endpoint, queue.splice(0), unloading);
  };

  const page = () => {
    sentScrollMilestones = new Set();
    track("page_view");
  };

  const trackRouteChange = () => {
    if (window.location.href === lastTrackedUrl) return;
    lastTrackedUrl = window.location.href;
    page();
  };

  const start = () => {
    if (started) return;
    started = true;
    lastTrackedUrl = window.location.href;
    page();
    if (!autoTrack) return;

    watchHistory(trackRouteChange);
    listen<MouseEvent>(document, "click", (event) => trackClick(event, track));
    listen(window, "scroll", () => trackScroll(track, sentScrollMilestones), { passive: true });
    listen(document, "visibilitychange", () => {
      track("page_visibility", { visible: document.visibilityState === "visible" });
      if (document.visibilityState === "hidden") flush();
    });
    listen<FocusEvent>(document, "focusin", (event) => trackFormFocus(event, track, activeForms));
    listen(document, "change", (event) => trackFormCompletion(event, track));
    listen(document, "submit", (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (form) submittedForms.add(formName(form));
    });
    listen(window, "pagehide", () => {
      unloading = true;
      for (const form of activeForms) {
        if (!submittedForms.has(form)) track("form_abandon", { form });
      }
      track("session_end", { durationSeconds: Math.round((Date.now() - getOrCreateSession().startedAt) / 1000) });
      flush();
    });
  };

  const stop = () => {
    for (const { target, type, listener, options } of listeners) target.removeEventListener(type, listener, options);
    listeners.length = 0;
    unwatchHistory(trackRouteChange);
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    started = false;
  };

  return { start, stop, track, page };
}

function sendBatch(endpoint: string, events: AnalyticsEvent[], unloading: boolean) {
  const body = JSON.stringify({ events });
  // sendBeacon cannot set a JSON content type without triggering a CORS
  // preflight, so it is only used during unload with a plain-text body.
  if (unloading && navigator.sendBeacon) {
    navigator.sendBeacon(endpoint, body);
    return;
  }
  void fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
}

const routeChangeListeners = new Set<() => void>();
let historyWatched = false;

function watchHistory(onChange: () => void) {
  routeChangeListeners.add(onChange);
  if (historyWatched) return;
  historyWatched = true;
  const notify = () => routeChangeListeners.forEach((listener) => listener());
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History["pushState"]>) => {
      original(...args);
      notify();
    };
  }
  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);
}

function unwatchHistory(onChange: () => void) {
  routeChangeListeners.delete(onChange);
}

function getContext(): EventContext {
  const url = new URL(window.location.href);
  return {
    page: url.pathname,
    url: `${url.origin}${url.pathname}`,
    referrer: document.referrer || undefined,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    device: getDevice(),
    browser: getBrowser(),
    os: getOperatingSystem(),
    utmSource: url.searchParams.get("utm_source") ?? undefined,
    utmMedium: url.searchParams.get("utm_medium") ?? undefined,
    utmCampaign: url.searchParams.get("utm_campaign") ?? undefined,
    utmTerm: url.searchParams.get("utm_term") ?? undefined,
    utmContent: url.searchParams.get("utm_content") ?? undefined,
  };
}

function trackClick(event: MouseEvent, track: Tracker["track"]) {
  const element = (event.target as Element | null)?.closest("a, button");
  if (!element) return;
  const link = element instanceof HTMLAnchorElement ? element : null;
  const isOutbound = link && link.href && new URL(link.href).origin !== window.location.origin;
  track("click", {
    element: element.tagName.toLowerCase(),
    label: safeLabel(element),
    outbound: Boolean(isOutbound),
  });
}

function trackScroll(track: Tracker["track"], sent: Set<number>) {
  const documentHeight = document.documentElement.scrollHeight - window.innerHeight;
  if (documentHeight <= 0) return;
  const depth = Math.round((window.scrollY / documentHeight) * 100);
  for (const milestone of SCROLL_MILESTONES) {
    if (depth >= milestone && !sent.has(milestone)) {
      sent.add(milestone);
      track("scroll", { depth: milestone });
    }
  }
}

function trackFormFocus(event: FocusEvent, track: Tracker["track"], activeForms: Set<string>) {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
  const form = field.closest("form");
  const formId = formName(form);
  if (!activeForms.has(formId)) {
    activeForms.add(formId);
    track("form_start", { form: formId });
  }
  track("form_field_focus", { form: formId, field: fieldName(field) });
}

function trackFormCompletion(event: Event, track: Tracker["track"]) {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
  if (!field.value) return;
  const form = field.closest("form");
  track("form_field_complete", { form: formName(form), field: fieldName(field) });
}

function formName(form: HTMLFormElement | null) {
  return form?.id || form?.getAttribute("name") || "unnamed_form";
}

function fieldName(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  return field.name || field.id || field.type || "unnamed_field";
}

function safeLabel(element: Element) {
  return element.getAttribute("data-analytics-label") || element.getAttribute("aria-label") || element.id || "unlabelled";
}

function sanitizeProperties(properties?: Record<string, string | number | boolean>) {
  if (!properties) return undefined;
  return Object.fromEntries(Object.entries(properties).slice(0, 20).map(([key, value]) => [key.slice(0, 64), typeof value === "string" ? value.slice(0, 256) : value]));
}

function getOrCreateId(key: string) {
  let stored = safeStorageGet(key);
  if (!stored && key === VISITOR_KEY) {
    stored = safeStorageGet(LEGACY_VISITOR_KEY);
    if (stored) safeStorageSet(key, stored);
  }
  if (stored) return stored;
  const id = crypto.randomUUID();
  safeStorageSet(key, id);
  return id;
}

function getOrCreateSession() {
  let stored = safeStorageGet(SESSION_KEY) ?? safeStorageGet(LEGACY_SESSION_KEY);
  if (stored) {
    const [id, updatedAt] = stored.split(".");
    if (id && Date.now() - Number(updatedAt) < SESSION_TTL_MS) {
      safeStorageSet(SESSION_KEY, `${id}.${Date.now()}`);
      const startedAt = Number(safeStorageGet(SESSION_START_KEY) ?? safeStorageGet(LEGACY_SESSION_START_KEY)) || Number(updatedAt);
      return { id, startedAt };
    }
  }
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  safeStorageSet(SESSION_KEY, `${id}.${startedAt}`);
  safeStorageSet(SESSION_START_KEY, String(startedAt));
  return { id, startedAt };
}

function safeStorageGet(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function safeStorageSet(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* tracking remains anonymous */ } }

function getDevice(): EventContext["device"] {
  const width = window.innerWidth;
  return width < 768 ? "mobile" : width < 1024 ? "tablet" : "desktop";
}
function getBrowser() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  if (/Firefox\//.test(ua)) return "Firefox";
  return "Other";
}
function getOperatingSystem() {
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}
