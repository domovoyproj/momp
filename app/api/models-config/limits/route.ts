import { NextResponse } from "next/server";
import { fetchUsageReportViews } from "@/lib/limits-checker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const reports = await fetchUsageReportViews();
    return NextResponse.json({ reports });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
