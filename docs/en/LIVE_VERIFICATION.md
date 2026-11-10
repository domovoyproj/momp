# PENDING LIVE VERIFICATION

[Русский](../ru/LIVE_VERIFICATION.md) · [Provider setup](AI_MODES.md)

Use a disposable Git project with one committed text file. Keep provider credentials and project contents out of reports.

1. With only ChatGPT connected, sign in from **Connections → ChatGPT**. Select a model and reasoning level. Ask the agent to inspect the test file and reopen the session. Check usage and reported reset time, then sign out and sign back in.
2. In a clean profile with no Antigravity installation or selected project, choose **Connections → Google Antigravity → Sign in with Google**. Wait for momp to prepare the component and open the browser. Choose your Google Account and return to momp. Open the test project, start a conversation, select a Gemini model and ask it to read the file. Check permissions, history and **Usage limits**. Restart momp and confirm the conversation opens without downloading the component again.
3. Configure Gemini API separately if you use it. Run a normal chat with a file read and check that the saved session reopens.
4. Connect both providers. Run GPT lead and Gemini lead. Check the displayed model, generated diff, test results and independent review. Confirm that working files change only after **Approve and apply**, then reverse the patch. When a real quota or connection error occurs, check pause, explicit retry and the optional single-provider fallback.

Record the outcomes separately for OAuth, model discovery, permissions, inference, quota reporting and recovery. The automated suite uses local provider fixtures.

## Xbox DNS verification

This Windows PowerShell check resolves public Google hostnames with Xbox DNS over HTTPS. Antigravity opens Google sign-in in the default browser, which can use a different DNS resolver. [Xbox DNS setup](https://xbox-dns.ru/) · [Antigravity sign-in](https://antigravity.google/docs/ide/extensions/acp#authentication)

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

An HTTP status, including `4xx`, confirms that the endpoint responded over HTTPS. To check the download, substitute the binary URL for your platform from the [Antigravity manifest](../../lib/antigravity-runtime.ts) and expect `200`. Then verify the actual HTTPS route, browser sign-in, and a model response separately using steps 2–3.

On November 11, 2026, the Windows check received `200` for the Antigravity CLI 1.5.5 x64 download. Xbox DNS returned `0.0.0.0` and `::` for `generativelanguage.googleapis.com`. The Gemini API connection failed. End-to-end verification through Xbox DNS remains pending.

### Route under development

The test build uses `MOMP_XBOX_DNS=1` to resolve public Google hosts over Xbox DNS and passes the local proxy to Antigravity CLI. The proxy checks its destination and leaves TLS between the client and Google. The Windows download test installed Antigravity CLI 1.5.5 in a temporary profile and verified its pinned SHA-512.

In this mode, the sign-in button reports that the browser needs a managed route. Antigravity 1.5.5 opens the default browser itself. The browser sign-in and a live model response over Xbox DNS remain PENDING LIVE VERIFICATION.
