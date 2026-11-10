# AI tasks and Hybrid

[Русский](../ru/HYBRID_MODE.md) · [Provider setup](AI_MODES.md)

1. Open a Git project with at least one commit and choose **AI tasks**. Select GPT only, Gemini only, GPT lead, Gemini lead, dual review or routing by task type. Dual review runs two independent reviews of the same proposed diff. Routing prefers Gemini for interface work and GPT for architecture and implementation unless you choose a lead. When a selected model is unavailable or a recent official report says its quota is exhausted, check the updated plan before starting.
2. Describe the task and list up to 16 project-relative UTF-8 paths, one per line. The lead receives committed versions of selected files. Enable **Allow creation and deletion within the selected paths** to include new paths or authorize a proposal to remove an existing file. Keep confidential content out of submitted paths and prompts.
3. Choose whether to run project tests. Select **Prepare task**, review the planned models and paths, then choose **Confirm and run**. The lead plans and proposes changes. momp builds the Git diff in a temporary repository and runs `git diff --check`. Reviewers receive the summary, the diff and test results when requested.
4. Read the reviews. Select **Review application** and **Approve and apply** to change the working files, or download the patch. Application checks the baseline commit, staged changes and exact file contents. If you requested tests, they must pass before in-app application. **Review rollback** reverses the patch only while the affected files still match the applied result. Unrelated edits and staged files are preserved.

The task history preserves completed stages. **Pause task** stops active steps and **Retry unfinished steps** resumes them with the same models. Each model stage has three attempts. When a reviewer is blocked, you can wait, retry, or finish without that review. When the lead is blocked, **Prepare a single-provider fallback** creates a separate task to approve.

## Run project tests in isolation

Install a local Docker engine in Linux container mode. Preload a trusted Bun image, then set `MOMP_TEST_RUNNER_IMAGE` before launching momp. The release suite uses `oven/bun:1.4.4`.

```sh
docker pull oven/bun:1.4.4
export MOMP_TEST_RUNNER_IMAGE=oven/bun:1.4.4
```

In PowerShell, use `$env:MOMP_TEST_RUNNER_IMAGE = 'oven/bun:1.4.4'`. The check runs `bun test` on the patched commit snapshot with no network, with a read-only root filesystem and with no mount of the original checkout. The test image must support `/bin/sh`, `tar` and Bun. Use self-contained tests or an image with the dependencies already prepared. Large snapshots and Git submodules require a separate test run. Reviewers receive the command, status and counts when available. Raw test output stays out of their prompts.
