export type RangeKey = "24h" | "7d" | "30d";

export interface MetricRow {
  label: string;
  value: number;
}

export interface TrafficPoint {
  date: string;
  pageviews: number;
  visitors: number;
}

export interface LiveVisitor {
  country: string;
  device: string;
  browser: string;
  page: string;
  lastSeen: string;
}

export interface AnalyticsFilter {
  country?: string;
  device?: string;
  browser?: string;
  os?: string;
  source?: string;
  page?: string;
}

export interface OverviewData {
  range: RangeKey;
  pageviews: number;
  visitors: number;
  sessions: number;
  bounceRate: number;
  pagesPerSession: number;
  liveVisitors: number;
  traffic: TrafficPoint[];
  sources: MetricRow[];
  devices: MetricRow[];
  browsers: MetricRow[];
  os: MetricRow[];
  countries: MetricRow[];
}

export interface FunnelStep {
  name: string;
  count: number;
  conversionRate: number;
  dropoffRate: number;
}

export interface FunnelData {
  range: RangeKey;
  steps: FunnelStep[];
}
