import type { SiteRecord } from "@godview/shared";

export class SitesConfigurationError extends Error {}
export class SitesUpstreamError extends Error {}

export function collectorUrl(): string {
  const value = process.env.GODVIEW_COLLECTOR_URL || process.env.OPENPULSE_COLLECTOR_URL;
  if (!value) throw new SitesConfigurationError("Site provisioning is not configured: set GODVIEW_COLLECTOR_URL and GODVIEW_ADMIN_TOKEN.");
  return value.replace(/\/+$/, "");
}

export async function listSites(): Promise<SiteRecord[]> {
  const response = await sitesRequest("/v1/sites");
  const payload = await response.json().catch(() => null) as { sites?: SiteRecord[] } | null;
  return payload?.sites ?? [];
}

export async function createSite(name: string, origins: string[]): Promise<SiteRecord> {
  const response = await sitesRequest("/v1/sites", { method: "POST", body: JSON.stringify({ name, origins }) });
  const payload = await response.json().catch(() => null) as { site?: SiteRecord } | null;
  if (!payload?.site) throw new SitesUpstreamError("The collector did not return the created site.");
  return payload.site;
}

async function sitesRequest(path: string, init?: RequestInit): Promise<Response> {
  const adminToken = process.env.GODVIEW_ADMIN_TOKEN || process.env.OPENPULSE_ADMIN_TOKEN;
  if (!adminToken) throw new SitesConfigurationError("Site provisioning is not configured: set GODVIEW_COLLECTOR_URL and GODVIEW_ADMIN_TOKEN.");
  let response: Response;
  try {
    response = await fetch(`${collectorUrl()}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SitesUpstreamError("The collector could not be reached.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new SitesUpstreamError(payload?.error ?? "The collector rejected the request.");
  }
  return response;
}
