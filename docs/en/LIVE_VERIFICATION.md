# PENDING LIVE VERIFICATION

[Русский](../ru/LIVE_VERIFICATION.md) · [Provider setup](AI_MODES.md)

Use a disposable Git project with one committed text file. Keep provider credentials and project contents out of reports.

1. With only ChatGPT connected, sign in from **Connections → ChatGPT**. Select a model and reasoning level. Ask the agent to inspect the test file and reopen the session. Check usage and reported reset time, then sign out and sign back in.
2. In a clean profile with no Antigravity installation or selected project, choose **Connections → Google Antigravity → Sign in with Google**. Wait for momp to prepare the component and open the browser. Use the separate momp Edge window to sign in to your Google Account and return to momp. Open the test project, start a conversation, select a Gemini model and ask it to read the file. Check permissions, history and **Usage limits**. Restart momp and confirm the conversation opens without downloading the component again.
3. Configure Gemini API separately if you use it. Run a normal chat with a file read and check that the saved session reopens.
4. Connect both providers. Run GPT lead and Gemini lead. Check the displayed model, generated diff, test results and independent review. Confirm that working files change only after **Approve and apply**, then reverse the patch. When a real quota or connection error occurs, check pause, explicit retry and the optional single-provider fallback.

Record the outcomes separately for OAuth, model discovery, permissions, inference, quota reporting and recovery. The automated suite uses local provider fixtures.

## Xbox DNS verification

On Windows, momp enables Xbox DNS routing automatically for Google hosts during component downloads, browser sign-in and model requests. No DNS settings, API key or pasted authorization code are needed for Antigravity sign-in. The server defaults to `MOMP_XBOX_DNS=1`; this is an implementation setting, not a setup step. Other platforms do not yet have this automatic browser route.

The sign-in window uses an installed Microsoft Edge and a separate, persistent momp profile. Existing browser cookies are not copied, so the first sign-in may require your Google credentials and two-factor authentication. Later attempts can reuse the account selected in this profile. The official CLI has an approximately 60-second authentication window: if it expires while you complete the first sign-in, click **Sign in with Google** again. The browser profile is retained.

A temporary helper observes only the official Antigravity callback URL and returns its one-time code to the official CLI. It has no permission to read Google Account pages or cookies. The CLI performs the OAuth exchange and stores credentials. Edge may display a developer-extension notification; momp does not suppress it. Browser management policies can block the helper. In that case sign-in reports an error and does not silently open an unrouted browser. [Edge notification](https://support.microsoft.com/en-au/edge/developer-mode-extension-notification)

For the live check, complete step 2 above, send a real prompt and verify the saved account after restarting momp. Separately test a Gemini API request if you use that connection. Record failures of sign-in, model discovery and inference independently. A successful public page or synthetic callback does not prove that a real account can authenticate or use a model.

### Optional connection diagnostics

The following Windows PowerShell command is for troubleshooting only. It is not required for installation or sign-in. It resolves public Google hostnames with Xbox DNS over HTTPS. Xbox DNS decides which domains use its gateway; a successful DNS lookup alone does not establish the HTTPS gateway route. [Xbox DNS service](https://xbox-dns.ru/)

```powershell
$googleEndpoints = @(
  'https://storage.googleapis.com/antigravity-public/'
  'https://accounts.google.com/'
  'https://oauth2.googleapis.com/'
  'https://cloudcode-pa.googleapis.com/'
  'https://daily-cloudcode-pa.googleapis.com/'
  'https://daily-cloudcode-pa.sandbox.googleapis.com/'
  'https://generativelanguage.googleapis.com/v1beta/models'
)
foreach ($url in $googleEndpoints) {
  curl.exe --disable --head --silent --show-error --max-time 10 --noproxy '*' `
    --doh-url https://xbox-dns.ru/dns-query --output NUL `
    --write-out '%{url_effective} HTTP %{http_code}\n' -- $url
}
```

An HTTP status, including `4xx`, confirms that the endpoint responded over HTTPS; it does not verify account authorization or a model response. For the download check, substitute the binary URL for your platform from the [Antigravity manifest](../../lib/antigravity-runtime.ts) and expect `200`.

### Evidence and remaining live checks

- The Windows download test installed the complete Antigravity CLI 1.5.5 in a temporary profile and verified its pinned SHA-512.
- The separate Edge profile opened the public Google sign-in page through the app's Xbox DNS tunnel with TLS verification intact. A synthetic callback tested automatic code delivery without an account.
- On November 11, 2026, the Xbox DNS website reported a service outage. Its resolver returned `0.0.0.0` and `::` for `generativelanguage.googleapis.com`; the Gemini API request failed. momp rejects these addresses and does not silently switch DNS providers.
- **PENDING LIVE VERIFICATION:** real Google account sign-in, real Antigravity/Gemini responses, model discovery, account quota reports and reconnect after reauthorization. Public endpoint checks and synthetic flows do not replace these checks.

If Xbox DNS cannot return a usable address or connect, retry after the service recovers. The app cannot restore the external DNS service or change Google's account and regional access rules.
