import { hasActiveAntigravityTurns } from "@/lib/antigravity-sessions";
import { hasActiveCollaborationTasks } from "@/lib/collaboration";
import { isApiRequestAllowed } from "@/lib/request-security";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted API request" }, { status: 403, headers });
  const busy = hasActiveAntigravityTurns() || hasActiveCollaborationTasks() || getRunningRpcSessionIds().length > 0;
  return Response.json({ busy }, { headers });
}
