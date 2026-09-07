import { getLiveVisitors } from "@/lib/analytics";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json({ visitors: await getLiveVisitors() }); }
  catch (error) { return errorResponse(error); }
}
