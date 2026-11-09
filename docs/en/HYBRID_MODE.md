# AI tasks and Hybrid

[Русский](../ru/HYBRID_MODE.md) · [Provider setup](AI_MODES.md)

1. Open a Git project with at least one commit and choose **AI tasks** in the sidebar.
2. Choose GPT only, Gemini only, GPT lead, Gemini lead, dual review or routing by task type. Dual review runs both reviews independently after a GPT lead. Routing uses Gemini as lead for interface work and GPT for implementation and architecture.
3. Describe the task. Optionally list up to eight tracked UTF-8 files, one path per line. Their committed versions will be sent to the lead model. Reviewers receive the task, proposed diff, lead summary and Git whitespace check. Keep confidential material out of the task and selected files.
4. Select **Prepare task** and review the exact models and context, then choose **Confirm and run**. The lead returns proposed replacements. momp generates the diff in a temporary Git repository. Reviewers cannot write to the checkout through this workflow.
5. Read the outcomes, download the patch and review it. At the correct project root, use `git apply --check /path/to/task.patch` before `git apply /path/to/task.patch`. Run the project's tests before committing. The task runs `git diff --check` on the proposal. Test commands are manual.

The task and completed stages are saved locally. **Pause task** stops active steps. After an error or restart, **Retry unfinished steps** uses the same models and retains completed work. Each stage allows three attempts. If the lead is complete, you can finish without remaining reviews. If the lead is blocked, you can prepare a separate task with the other model and review it before confirming. Separate proposal work directories keep concurrent tasks away from the working copy.
