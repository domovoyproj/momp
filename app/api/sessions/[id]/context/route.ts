import { NextResponse } from "next/server";
import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import { resolveSessionPath, buildSessionContext, getHistoricalContextUsage, getCachedSessionDetails } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (!liveRpc) {
      const details = await getCachedSessionDetails(filePath!, {
        leafId,
        deferThinking,
        deferToolResultImages,
      });
      return NextResponse.json({
        context: details.context,
        ...(details.contextUsage ? { contextUsage: details.contextUsage } : {}),
      });
    }

    const sm = liveRpc?.inner.sessionManager ?? await SessionManager.open(filePath!);
    const entries = sm.getEntries() as never;
    const context = buildSessionContext(entries, leafId, {
      deferThinking,
      deferToolResultImages,
    });
    const liveUsage = typeof liveRpc?.inner?.getContextUsage === "function" && leafId === sm.getLeafId()
      ? liveRpc.inner.getContextUsage()
      : undefined;
    const contextUsage = liveUsage
      ? { percent: liveUsage.percent, contextWindow: liveUsage.contextWindow, tokens: liveUsage.tokens }
      : await getHistoricalContextUsage(entries, leafId);

    return NextResponse.json({
      context,
      ...(contextUsage ? { contextUsage } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
