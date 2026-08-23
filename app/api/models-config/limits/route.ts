import { NextRequest, NextResponse } from "next/server";
import { checkProviderLimits } from "@/lib/limits-checker";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const model = url.searchParams.get("model");
    
    const limits = await checkProviderLimits(model);
    return NextResponse.json({ limits });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
