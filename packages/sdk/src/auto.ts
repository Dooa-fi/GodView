import { createTracker, type Tracker } from "./index.js";

declare global {
  interface Window {
    godview?: Tracker;
    openpulse?: Tracker;
  }
}

const currentScript = document.currentScript;
const script = (currentScript && currentScript.hasAttribute("data-site-id"))
  ? currentScript
  : document.querySelector("script[data-site-id][data-endpoint]");

const siteId = script?.getAttribute("data-site-id");
const endpoint = script?.getAttribute("data-endpoint");

if (siteId && endpoint) {
  const tracker = createTracker({ siteId, endpoint });
  tracker.start();
  window.godview = tracker;
  window.openpulse = tracker;
}

