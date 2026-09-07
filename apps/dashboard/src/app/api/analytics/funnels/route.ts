import { getFunnel, parseFilters, parseRange } from "@/lib/analytics";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const range = parseRange(url.searchParams.get("range"));
    const siteId = url.searchParams.get("siteId");
    const stepsParam = url.searchParams.get("steps");
    const steps = stepsParam
      ? stepsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const filters = parseFilters(url.searchParams);
    return Response.json(await getFunnel(range, siteId, steps, filters));
  } catch (error) {
    return errorResponse(error);
  }
}
