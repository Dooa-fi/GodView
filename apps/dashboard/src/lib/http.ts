import { AnalyticsConfigurationError, AnalyticsUpstreamError } from "./analytics";
import { SitesConfigurationError, SitesUpstreamError } from "./sites";

export function errorResponse(error: unknown) {
  if (error instanceof SitesConfigurationError) return Response.json({ error: error.message, code: "SITES_NOT_CONFIGURED" }, { status: 503 });
  if (error instanceof SitesUpstreamError) return Response.json({ error: error.message, code: "SITES_UNAVAILABLE" }, { status: 502 });
  if (error instanceof AnalyticsConfigurationError) return Response.json({ error: error.message, code: "ANALYTICS_NOT_CONFIGURED" }, { status: 503 });
  if (error instanceof AnalyticsUpstreamError) return Response.json({ error: error.message, code: "ANALYTICS_UNAVAILABLE" }, { status: 502 });
  console.error("Unexpected API error", error);
  return Response.json({ error: "Unexpected server error", code: "INTERNAL_ERROR" }, { status: 500 });
}
