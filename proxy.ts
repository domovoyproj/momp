import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import { authorizeWebRequest } from "@/lib/web-auth";

/**
 * The password-recovery surface, and the only thing that answers without
 * credentials. It cannot hand out access on its own: the recovery code it mints
 * is printed on the server's console, never returned over HTTP.
 */
const RECOVERY_PAGE = "/recover";
const RECOVERY_API = "/api/web-access/recovery";

const AUTHENTICATE_HEADERS = {
  "Cache-Control": "no-store",
  "WWW-Authenticate": 'Basic realm="omp-web", charset="UTF-8"',
};

function unauthorizedPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>omp-web · authentication required</title>
<style>
  :root { color-scheme: dark light; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #14161a; color: #e6e8ea;
         font: 15px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  main { max-width: 34rem; padding: 2rem; }
  h1 { font-size: 1.1rem; margin: 0 0 1rem; }
  p { margin: 0 0 0.85rem; color: #a8adb4; }
  code { color: #e6e8ea; }
  a { color: #7aa2f7; }
</style>
</head>
<body>
<main>
  <h1>Authentication required</h1>
  <p>omp-web is locked. Reload the page and sign in with the username <code>omp</code> and your password.</p>
  <p>Forgot it? <a href="${RECOVERY_PAGE}">Recover access</a> — you will need to read a one-time code off the console
     of the machine running omp-web.</p>
</main>
</body>
</html>
`;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApiRequest = pathname === "/api" || pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  // Recovery stays reachable while locked out — that is the whole point of it —
  // but only after the host and cross-site checks above have run.
  if (pathname === RECOVERY_PAGE || pathname === RECOVERY_API) return NextResponse.next();

  const decision = authorizeWebRequest(request.headers.get("authorization"));

  if (decision === "unavailable") {
    const message = "Password access is enabled but the omp-web credential file could not be read."
      + " Run `omp-web --reset-password` on the server to set a new password.";
    return isApiRequest
      ? NextResponse.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } })
      : new NextResponse(message, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  if (decision === "unauthorized") {
    return isApiRequest
      ? NextResponse.json(
        { error: "Authentication required", recoveryPath: RECOVERY_PAGE },
        { status: 401, headers: AUTHENTICATE_HEADERS },
      )
      : new NextResponse(unauthorizedPage(), {
        status: 401,
        headers: { ...AUTHENTICATE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
      });
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/recover", "/api/:path*"] };
