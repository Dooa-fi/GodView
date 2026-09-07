import { getPages, parseRange } from "@/lib/analytics";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return Response.json({ pages: await getPages(parseRange(new URL(request.url).searchParams.get("range"))) }); }
  catch (error) { return errorResponse(error); }
}
