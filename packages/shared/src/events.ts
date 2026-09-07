export const EVENT_NAMES = [
  "page_view",
  "click",
  "scroll",
  "page_visibility",
  "session_end",
  "form_start",
  "form_field_focus",
  "form_field_complete",
  "form_abandon",
] as const;

export type AutomaticEventName = (typeof EVENT_NAMES)[number];
export type EventName = AutomaticEventName | (string & {});

export function isAutomaticEventName(name: string): name is AutomaticEventName {
  return (EVENT_NAMES as readonly string[]).includes(name);
}

export interface EventContext {
  page: string;
  url: string;
  referrer?: string;
  screenWidth?: number;
  screenHeight?: number;
  language?: string;
  timezone?: string;
  device?: "mobile" | "tablet" | "desktop";
  browser?: string;
  os?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

export interface AnalyticsEvent {
  event: EventName;
  timestamp: string;
  siteId: string;
  sessionId: string;
  visitorId: string;
  context: EventContext;
  properties?: Record<string, string | number | boolean>;
}

export interface EventBatch {
  events: AnalyticsEvent[];
}

export interface SiteRecord {
  id: string;
  name: string;
  origins: string[];
  createdAt: string;
}
