import { getLiveVisitors } from "@/lib/analytics";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const siteId = url.searchParams.get("siteId");
    return Response.json({ visitors: await getLiveVisitors(siteId) });
  } catch (error) { return errorResponse(error); }
}
