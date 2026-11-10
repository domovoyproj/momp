# PENDING LIVE VERIFICATION

[Русский](../ru/LIVE_VERIFICATION.md) · [Provider setup](AI_MODES.md)

Use a disposable Git project with one committed text file. Keep provider credentials and project contents out of reports.

1. With only ChatGPT connected, sign in from **Connections → ChatGPT**. Select a model and reasoning level. Ask the agent to inspect the test file and reopen the session. Check usage and reported reset time, then sign out and sign back in.
2. Without ChatGPT connected or a project selected, open **Connections → Google Antigravity** and choose **Sign in with Google**. Complete sign-in in the browser, then open the test project and start a conversation in **Antigravity chat**. Select a Gemini model and thinking level. Ask it to inspect the file and run a read-only Git command. If the CLI asks for permission, deny one action and allow another once. Close the conversation, reopen it from history and check continuity. Open **Usage limits** and compare the CLI figures with `/usage`. Repeat after signing out in the CLI.
3. Configure Gemini API separately if you use it. Run a normal chat with a file read and check that the saved session reopens.
4. Connect both providers. Run GPT lead and Gemini lead. Check the displayed model, generated diff, test results and independent review. Confirm that working files change only after **Approve and apply**, then reverse the patch. When a real quota or connection error occurs, check pause, explicit retry and the optional single-provider fallback.

Record the outcomes separately for OAuth, model discovery, permissions, inference, quota reporting and recovery. The automated suite uses local provider fixtures.
