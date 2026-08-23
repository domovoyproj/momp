import { NextResponse } from "next/server";
import {
  RECOVERY_CODE_TTL_MS,
  consumeRecoveryCode,
  getWebAuthStatus,
  issueRecoveryCode,
} from "@/bin/web-auth-store.js";
import { hasJsonContentType } from "@/lib/request-security";

/**
 * Password recovery, and the only endpoint `proxy.ts` lets through unauthenticated.
 *
 * It hands out nothing: `request` mints a one-time code and prints it on the
 * server's own console — the terminal running omp-web — so completing the flow
 * proves the caller can see that machine. A port scanner that finds this route
 * can make the server print codes it will never read.
 */

export const dynamic = "force-dynamic";

const RECOVERY_BANNER = "─".repeat(52);

function announceRecoveryCode(code: string, expiresAt: number): void {
  const minutes = Math.round(RECOVERY_CODE_TTL_MS / 60_000);
  process.stdout.write([
    "",
    RECOVERY_BANNER,
    "omp-web password recovery",
    "",
    `  Recovery code: ${code}`,
    `  Valid until:   ${new Date(expiresAt).toLocaleTimeString()} (${minutes} minutes)`,
    "",
    "Enter it on the /recover page to set a new password.",
    "If you did not ask for this, ignore it — the code grants nothing on its own.",
    RECOVERY_BANNER,
    "",
  ].join("\n"));
}

export async function POST(req: Request) {
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 415 });
  }

  let body: { action?: unknown; code?: unknown; password?: unknown };
  try {
    body = await req.json() as { action?: unknown; code?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const status = getWebAuthStatus();
  if (status.managedByEnvironment) {
    return NextResponse.json({
      error: "Password access comes from the OMP_WEB_PASSWORD environment variable, which omp-web cannot reset."
        + " Change the variable on the server and restart it.",
    }, { status: 409 });
  }
  // A credential file that cannot be parsed cannot hold a recovery code either,
  // and minting one would mean rewriting the file — which would unlock a server
  // whose password nobody can verify. That case needs a shell on the machine.
  if (status.unreadable) {
    return NextResponse.json({
      error: `The credential file at ${status.file} could not be read.`
        + " Run `omp-web --reset-password` on the server to replace it.",
    }, { status: 409 });
  }
  if (!status.stored) {
    return NextResponse.json(
      { error: "No password is configured, so there is nothing to recover." },
      { status: 409 },
    );
  }

  if (body.action === "request") {
    const issued = issueRecoveryCode();
    if (!issued.ok) {
      return NextResponse.json(
        { error: "A recovery code was just issued. Check the server console, or wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(issued.retryAfterMs / 1000)) } },
      );
    }
    announceRecoveryCode(issued.code, issued.expiresAt);
    return NextResponse.json(
      { ok: true, expiresAt: issued.expiresAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (body.action === "complete") {
    const result = consumeRecoveryCode(body.code, body.password);
    if (result.ok) {
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    switch (result.reason) {
      case "invalid-password":
        return NextResponse.json({ error: result.message }, { status: 400 });
      case "invalid-code":
        return NextResponse.json({
          error: result.remainingAttempts > 0
            ? `That recovery code is not valid. ${result.remainingAttempts} attempt(s) left before it is discarded.`
            : "That recovery code is not valid, and it has now been discarded. Request a new one.",
        }, { status: 403 });
      case "expired":
        return NextResponse.json({ error: "That recovery code has expired. Request a new one." }, { status: 403 });
      case "too-many-attempts":
        return NextResponse.json({ error: "Too many attempts. Request a new recovery code." }, { status: 429 });
      case "no-code":
        return NextResponse.json({ error: "No recovery code is pending. Request one first." }, { status: 409 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
