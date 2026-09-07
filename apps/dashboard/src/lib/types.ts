export type RangeKey = "24h" | "7d" | "30d";

export interface MetricRow { label: string; value: number; }
export interface TrafficPoint { date: string; pageviews: number; visitors: number; }
export interface LiveVisitor { country: string; device: string; browser: string; page: string; lastSeen: string; }

export interface OverviewData {
  range: RangeKey;
  pageviews: number;
  visitors: number;
  sessions: number;
  liveVisitors: number;
  traffic: TrafficPoint[];
  sources: MetricRow[];
  devices: MetricRow[];
  countries: MetricRow[];
}
