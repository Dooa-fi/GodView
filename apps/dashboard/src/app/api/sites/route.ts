import { collectorUrl, createSite, listSites } from "@/lib/sites";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return Response.json({ sites: await listSites(), collectorUrl: collectorUrl() }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { name?: unknown; origins?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const origins = Array.isArray(body?.origins)
      ? body.origins.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : [];
    if (!name || name.length > 100) return Response.json({ error: "Expected a site name of 1–100 characters." }, { status: 400 });
    if (origins.length === 0 || origins.length > 20) return Response.json({ error: "Expected 1–20 allowed origins." }, { status: 400 });
    return Response.json({ site: await createSite(name, origins) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
