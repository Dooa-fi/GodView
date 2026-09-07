import type { SiteRecord } from "@godview/shared";

export class SitesConfigurationError extends Error {}
export class SitesUpstreamError extends Error {}

const inMemorySites: SiteRecord[] = [];

export function collectorUrl(): string {
  const value = process.env.GODVIEW_COLLECTOR_URL || process.env.OPENPULSE_COLLECTOR_URL;
  return (value || "").replace(/\/+$/, "");
}

function hasCollectorConfig(): boolean {
  const url = process.env.GODVIEW_COLLECTOR_URL || process.env.OPENPULSE_COLLECTOR_URL;
  const token = process.env.GODVIEW_ADMIN_TOKEN || process.env.OPENPULSE_ADMIN_TOKEN;
  return Boolean(url && token);
}

export async function listSites(): Promise<SiteRecord[]> {
  if (!hasCollectorConfig()) {
    const defaultSiteId = process.env.GODVIEW_SITE_ID || process.env.OPENPULSE_SITE_ID || "site_primary";
    const base: SiteRecord = {
      id: defaultSiteId,
      name: "Primary Site",
      origins: ["https://example.com"],
      createdAt: new Date().toISOString(),
    };
    return [base, ...inMemorySites.filter((s) => s.id !== base.id)];
  }
  const response = await sitesRequest("/v1/sites");
  const payload = await response.json().catch(() => null) as { sites?: SiteRecord[] } | null;
  return payload?.sites ?? [];
}

export async function createSite(name: string, origins: string[]): Promise<SiteRecord> {
  if (!hasCollectorConfig()) {
    const site: SiteRecord = {
      id: `site_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
      name: name.trim(),
      origins,
      createdAt: new Date().toISOString(),
    };
    inMemorySites.push(site);
    return site;
  }
  const response = await sitesRequest("/v1/sites", { method: "POST", body: JSON.stringify({ name, origins }) });
  const payload = await response.json().catch(() => null) as { site?: SiteRecord } | null;
  if (!payload?.site) throw new SitesUpstreamError("The collector did not return the created site.");
  return payload.site;
}

export async function deleteSite(siteId: string): Promise<boolean> {
  if (!hasCollectorConfig()) {
    const idx = inMemorySites.findIndex((s) => s.id === siteId);
    if (idx !== -1) inMemorySites.splice(idx, 1);
    return true;
  }
  const response = await sitesRequest(`/v1/sites?id=${encodeURIComponent(siteId)}`, { method: "DELETE" });
  return response.ok;
}

async function sitesRequest(path: string, init?: RequestInit): Promise<Response> {
  const adminToken = process.env.GODVIEW_ADMIN_TOKEN || process.env.OPENPULSE_ADMIN_TOKEN;
  const url = collectorUrl();
  if (!adminToken || !url) throw new SitesConfigurationError("Site provisioning is not configured: set GODVIEW_COLLECTOR_URL and GODVIEW_ADMIN_TOKEN.");
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
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

