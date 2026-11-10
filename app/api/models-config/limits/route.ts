import { NextResponse } from "next/server";
import { fetchUsageReportViews } from "@/lib/limits-checker";
import { fetchAntigravityUsage } from "@/lib/collaboration-providers";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403, headers });
  const [omp, cli] = await Promise.allSettled([fetchUsageReportViews(), fetchAntigravityUsage()]);
  if (omp.status === "rejected" && (cli.status === "rejected" || !cli.value)) {
    return NextResponse.json({ error: "usage_unavailable" }, { status: 503, headers });
  }
  return NextResponse.json({
    reports: omp.status === "fulfilled" ? omp.value : [],
    ompUnavailable: omp.status === "rejected",
    antigravity: cli.status === "fulfilled" ? cli.value : undefined,
  }, { headers });
}
