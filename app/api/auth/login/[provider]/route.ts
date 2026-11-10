import { randomUUID } from "node:crypto";
import { providerPauseReason, type OAuthAuthInfo, type OAuthPrompt } from "@oh-my-pi/pi-ai/oauth";
import { createGoogleAuthBrowser } from "@/lib/google-auth-browser";
import { xboxDnsEnabled } from "@/lib/google-network";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getOmpRuntime, invalidateOmpRuntime } from "@/lib/omp-runtime";
import { resolveOAuthLoginId } from "@/lib/provider-listing-runtime";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// In-memory registry: loginToken -> resolve/reject for the manualCodeInput promise
declare global {
  var __ompLoginCallbacks: Map<string, { provider: string; resolve: (v: string) => void; reject: (e: Error) => void }> | undefined;
}

function getCallbackRegistry() {
  if (!globalThis.__ompLoginCallbacks) globalThis.__ompLoginCallbacks = new Map();
  return globalThis.__ompLoginCallbacks;
}

// POST /api/auth/login/[provider] — frontend sends redirect URL or auth code
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  const { provider } = await params;
  const body = await req.json().catch(() => null) as { token?: unknown; code?: unknown } | null;
  const { token, code } = body ?? {};
  if (typeof token !== "string" || token.length !== 36 || typeof code !== "string" || !code.trim() || code.length > 8_192) {
    return Response.json({ error: "token and code required" }, { status: 400 });
  }

  const registry = getCallbackRegistry();
  const callbacks = registry.get(token);
  if (!callbacks) {
    return Response.json({ error: "No pending login for token" }, { status: 404 });
  }
  if (callbacks.provider !== provider) {
    return Response.json({ error: "Token does not match provider" }, { status: 400 });
  }

  callbacks.resolve(code);
  registry.delete(token);
  return Response.json({ ok: true, provider });
}

// GET /api/auth/login/[provider] — SSE stream for OAuth flow
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  const { provider } = await params;

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    if (!streamCancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  // AbortController propagates client disconnect into AuthStorage.login().
  const abort = new AbortController();
  let streamCancelled = false;
  const abortRequest = () => abort.abort();
  req.signal.addEventListener("abort", abortRequest, { once: true });
  if (req.signal.aborted) abortRequest();
  const timeout = setTimeout(abortRequest, 5 * 60_000);

  const stream = new ReadableStream({
    async start(controller) {
      const loginId = resolveOAuthLoginId(provider);
      const needsBrowserRoute = xboxDnsEnabled() && (loginId === "google" || loginId?.startsWith("google-"));
      const localBrowser = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.get("host") ?? "");
      if (!loginId || needsBrowserRoute && !localBrowser) {
        clearTimeout(timeout);
        req.signal.removeEventListener("abort", abortRequest);
        const message = needsBrowserRoute && !localBrowser ? "Open momp on this computer to sign in to Google." : providerPauseReason(provider) ?? `Unknown provider: ${provider}`;
        send(controller, { type: "error", message });
        controller.close();
        return;
      }
      const registry = getCallbackRegistry();
      const activeTokens = new Set<string>();
      let pendingManualRequest: { token: string; promise: Promise<string> } | undefined;

      const createClientInputRequest = () => {
        abort.signal.throwIfAborted();
        const token = randomUUID();
        activeTokens.add(token);

        const promise = new Promise<string>((resolve, reject) => {
          registry.set(token, {
            provider,
            resolve: (value) => {
              activeTokens.delete(token);
              registry.delete(token);
              resolve(value);
            },
            reject: (error) => {
              activeTokens.delete(token);
              registry.delete(token);
              reject(error);
            },
          });
        });

        return { token, promise };
      };

      const getManualInputRequest = () => {
        if (!pendingManualRequest) {
          pendingManualRequest = createClientInputRequest();
          pendingManualRequest.promise
            .finally(() => {
              pendingManualRequest = undefined;
            })
            .catch(() => {});
        }
        return pendingManualRequest;
      };

      // Cleanup: remove pending token and abort any waiting promise
      const cleanup = () => {
        for (const token of activeTokens) {
          registry.get(token)?.reject(new Error("Login cancelled"));
          registry.delete(token);
        }
        activeTokens.clear();
      };

      // Also cancel on client disconnect
      abort.signal.addEventListener("abort", cleanup);

      let browser: Awaited<ReturnType<typeof createGoogleAuthBrowser>> | undefined;
      let browserFailed = false;
      try {
        abort.signal.throwIfAborted();
        if (needsBrowserRoute) browser = await createGoogleAuthBrowser({ signal: abort.signal, onClose: abortRequest });
        const { authStorage } = await getOmpRuntime();
        abort.signal.throwIfAborted();
        await authStorage.oauth.login(loginId, {
          // Every provider prompt (paste-the-code, enterprise URL, ...) becomes
          // a browser input request keyed by a short-lived token.
          onPrompt: async (prompt: OAuthPrompt) => {
            const request = createClientInputRequest();
            send(controller, {
              type: "prompt_request",
              message: prompt.message,
              placeholder: prompt.placeholder ?? null,
              token: request.token,
            });
            return request.promise;
          },
          // Manual-code flows resolve through the same pending request as the
          // auth URL so a user who pastes the redirect completes the login.
          onManualCodeInput: needsBrowserRoute ? undefined : () => getManualInputRequest().promise,
          onAuth: (info: OAuthAuthInfo) => {
            if (browser) {
              void browser.open(info.url).catch(() => { browserFailed = true; abort.abort(); });
              send(controller, { type: "progress", message: "Complete Google sign-in in the momp browser window." });
              return;
            }
            const request = getManualInputRequest();
            send(controller, {
              type: "auth",
              // `launchUrl` is the truncation-safe loopback redirect when the
              // flow hosts one; fall back to the full authorization URL.
              url: info.launchUrl ?? info.url,
              fullUrl: info.url,
              instructions: info.instructions ?? null,
              token: request.token,
            });
          },
          onProgress: (message: string) => {
            send(controller, { type: "progress", message });
          },
          signal: abort.signal,
        });

        invalidateModelsCache();
        invalidateOmpRuntime();
        send(controller, { type: "success" });
      } catch {
        if (browserFailed) send(controller, { type: "error", message: "Could not open the momp Google sign-in window. Close its previous window and retry." });
        else if (abort.signal.aborted) send(controller, { type: "cancelled" });
        else send(controller, { type: "error", message: "Provider sign-in failed. Check the account and retry." });
      } finally {
        await browser?.close();
        clearTimeout(timeout);
        req.signal.removeEventListener("abort", abortRequest);
        cleanup();
        if (!streamCancelled) controller.close();
      }
    },
    cancel() {
      streamCancelled = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store",
      Connection: "keep-alive",
    },
  });
}
