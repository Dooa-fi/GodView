import { getOverview, parseRange } from "@/lib/analytics";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const range = parseRange(url.searchParams.get("range"));
    const siteId = url.searchParams.get("siteId");
    return Response.json(await getOverview(range, siteId));
  } catch (error) { return errorResponse(error); }
}
