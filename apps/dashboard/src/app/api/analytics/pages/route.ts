import { getPages, parseFilters, parseRange } from "@/lib/analytics";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const range = parseRange(url.searchParams.get("range"));
    const siteId = url.searchParams.get("siteId");
    const filters = parseFilters(url.searchParams);
    return Response.json({ pages: await getPages(range, siteId, filters) });
  } catch (error) { return errorResponse(error); }
}
