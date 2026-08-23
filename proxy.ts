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
  "WWW-Authenticate": 'Basic realm="momp-web", charset="UTF-8"',
};

function unauthorizedPage(): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>momp-web · требуется авторизация</title>
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
  <h1>Требуется авторизация</h1>
  <p>momp-web защищен паролем. Перезагрузите страницу и войдите под именем пользователя <code>momp</code> и вашим паролем.</p>
  <p>Забыли пароль? <a href="${RECOVERY_PAGE}">Восстановить доступ</a> — потребуется ввести проверочный код из консоли сервера momp-web.</p>
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
    const message = "Защита паролем включена, но файл учетных данных momp-web не может быть прочитан."
      + " Выполните команду `momp-web --reset-password` на сервере для сброса пароля.";
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
