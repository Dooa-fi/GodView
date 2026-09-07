"use strict";
(() => {
  // ../shared/src/events.ts
  var EVENT_NAMES = [
    "page_view",
    "click",
    "scroll",
    "page_visibility",
    "session_end",
    "form_start",
    "form_field_focus",
    "form_field_complete",
    "form_abandon"
  ];
  function isAutomaticEventName(name) {
    return EVENT_NAMES.includes(name);
  }

  // src/index.ts
  var VISITOR_KEY = "godview:visitor";
  var SESSION_KEY = "godview:session";
  var SESSION_START_KEY = "godview:session-start";
  var LEGACY_VISITOR_KEY = "openpulse:visitor";
  var LEGACY_SESSION_KEY = "openpulse:session";
  var LEGACY_SESSION_START_KEY = "openpulse:session-start";
  var SESSION_TTL_MS = 30 * 60 * 1e3;
  var SCROLL_MILESTONES = [25, 50, 75, 90];
  var MAX_BATCH_SIZE = 10;
  var FLUSH_DELAY_MS = 3e3;
  function createTracker(options) {
    const autoTrack = options.autoTrack ?? true;
    const allowedEvents = options.allowedEvents ? new Set(options.allowedEvents) : null;
    let started = false;
    let unloading = false;
    let lastTrackedUrl = "";
    let flushTimer = null;
    let sentScrollMilestones = /* @__PURE__ */ new Set();
    const queue = [];
    const activeForms = /* @__PURE__ */ new Set();
    const submittedForms = /* @__PURE__ */ new Set();
    const listeners = [];
    const listen = (target, type, listener, options2) => {
      target.addEventListener(type, listener, options2);
      listeners.push({ target, type, listener, options: options2 });
    };
    const track = (event, properties) => {
      if (allowedEvents && !isAutomaticEventName(event) && !allowedEvents.has(event)) return;
      const payload = {
        event,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        siteId: options.siteId,
        visitorId: getOrCreateId(VISITOR_KEY),
        sessionId: getOrCreateSession().id,
        context: getContext(),
        properties: sanitizeProperties(properties)
      };
      queue.push(payload);
      if (queue.length >= MAX_BATCH_SIZE) flush();
      else if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
    };
    const flush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (queue.length === 0) return;
      sendBatch(options.endpoint, queue.splice(0), unloading);
    };
    const page = () => {
      sentScrollMilestones = /* @__PURE__ */ new Set();
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
      listen(document, "click", (event) => trackClick(event, track));
      listen(window, "scroll", () => trackScroll(track, sentScrollMilestones), { passive: true });
      listen(document, "visibilitychange", () => {
        track("page_visibility", { visible: document.visibilityState === "visible" });
        if (document.visibilityState === "hidden") flush();
      });
      listen(document, "focusin", (event) => trackFormFocus(event, track, activeForms));
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
        track("session_end", { durationSeconds: Math.round((Date.now() - getOrCreateSession().startedAt) / 1e3) });
        flush();
      });
    };
    const stop = () => {
      for (const { target, type, listener, options: options2 } of listeners) target.removeEventListener(type, listener, options2);
      listeners.length = 0;
      unwatchHistory(trackRouteChange);
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      started = false;
    };
    return { start, stop, track, page };
  }
  function sendBatch(endpoint2, events, unloading) {
    const body = JSON.stringify({ events });
    if (unloading && navigator.sendBeacon) {
      navigator.sendBeacon(endpoint2, body);
      return;
    }
    void fetch(endpoint2, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
  }
  var routeChangeListeners = /* @__PURE__ */ new Set();
  var historyWatched = false;
  function watchHistory(onChange) {
    routeChangeListeners.add(onChange);
    if (historyWatched) return;
    historyWatched = true;
    const notify = () => routeChangeListeners.forEach((listener) => listener());
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method].bind(history);
      history[method] = (...args) => {
        original(...args);
        notify();
      };
    }
    window.addEventListener("popstate", notify);
    window.addEventListener("hashchange", notify);
  }
  function unwatchHistory(onChange) {
    routeChangeListeners.delete(onChange);
  }
  function getContext() {
    const url = new URL(window.location.href);
    return {
      page: url.pathname,
      url: `${url.origin}${url.pathname}`,
      referrer: document.referrer || void 0,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      device: getDevice(),
      browser: getBrowser(),
      os: getOperatingSystem(),
      utmSource: url.searchParams.get("utm_source") ?? void 0,
      utmMedium: url.searchParams.get("utm_medium") ?? void 0,
      utmCampaign: url.searchParams.get("utm_campaign") ?? void 0,
      utmTerm: url.searchParams.get("utm_term") ?? void 0,
      utmContent: url.searchParams.get("utm_content") ?? void 0
    };
  }
  function trackClick(event, track) {
    const element = event.target?.closest("a, button");
    if (!element) return;
    const link = element instanceof HTMLAnchorElement ? element : null;
    const isOutbound = link && link.href && new URL(link.href).origin !== window.location.origin;
    track("click", {
      element: element.tagName.toLowerCase(),
      label: safeLabel(element),
      outbound: Boolean(isOutbound)
    });
  }
  function trackScroll(track, sent) {
    const documentHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (documentHeight <= 0) return;
    const depth = Math.round(window.scrollY / documentHeight * 100);
    for (const milestone of SCROLL_MILESTONES) {
      if (depth >= milestone && !sent.has(milestone)) {
        sent.add(milestone);
        track("scroll", { depth: milestone });
      }
    }
  }
  function trackFormFocus(event, track, activeForms) {
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
  function trackFormCompletion(event, track) {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
    if (!field.value) return;
    const form = field.closest("form");
    track("form_field_complete", { form: formName(form), field: fieldName(field) });
  }
  function formName(form) {
    return form?.id || form?.getAttribute("name") || "unnamed_form";
  }
  function fieldName(field) {
    return field.name || field.id || field.type || "unnamed_field";
  }
  function safeLabel(element) {
    return element.getAttribute("data-analytics-label") || element.getAttribute("aria-label") || element.id || "unlabelled";
  }
  function sanitizeProperties(properties) {
    if (!properties) return void 0;
    return Object.fromEntries(Object.entries(properties).slice(0, 20).map(([key, value]) => [key.slice(0, 64), typeof value === "string" ? value.slice(0, 256) : value]));
  }
  function getOrCreateId(key) {
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
      const [id2, updatedAt] = stored.split(".");
      if (id2 && Date.now() - Number(updatedAt) < SESSION_TTL_MS) {
        safeStorageSet(SESSION_KEY, `${id2}.${Date.now()}`);
        const startedAt2 = Number(safeStorageGet(SESSION_START_KEY) ?? safeStorageGet(LEGACY_SESSION_START_KEY)) || Number(updatedAt);
        return { id: id2, startedAt: startedAt2 };
      }
    }
    const id = crypto.randomUUID();
    const startedAt = Date.now();
    safeStorageSet(SESSION_KEY, `${id}.${startedAt}`);
    safeStorageSet(SESSION_START_KEY, String(startedAt));
    return { id, startedAt };
  }
  function safeStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function safeStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
    }
  }
  function getDevice() {
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

  // src/auto.ts
  var currentScript = document.currentScript;
  var script = currentScript && currentScript.hasAttribute("data-site-id") ? currentScript : document.querySelector("script[data-site-id][data-endpoint]");
  var siteId = script?.getAttribute("data-site-id");
  var endpoint = script?.getAttribute("data-endpoint");
  if (siteId && endpoint) {
    const tracker = createTracker({ siteId, endpoint });
    tracker.start();
    window.godview = tracker;
    window.openpulse = tracker;
  }
})();
