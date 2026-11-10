"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { CollaborationStrategy, CollaborationTask, CollaborationModel } from "@/lib/collaboration";

type HistoryItem = { id: string; title: string; status: CollaborationTask["status"] };
type ModelOption = CollaborationModel & { name: string };
const strategies: CollaborationStrategy[] = ["gpt", "gemini", "gpt-lead", "gemini-lead", "dual-review", "smart"];
const gptProviders = ["openai-codex", "openai"];
const geminiProviders = ["google", "google-vertex"];

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

export function CollaborationPanel({ cwd, onClose, onWorkingFilesChanged }: { cwd: string; onClose: () => void; onWorkingFilesChanged: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [agy, setAgy] = useState(false);
  const [testsConfigured, setTestsConfigured] = useState(false);
  const [runTests, setRunTests] = useState(false);
  const [fileOperations, setFileOperations] = useState(false);
  const [mutation, setMutation] = useState<"apply" | "rollback">();
  const [agyModel, setAgyModel] = useState("");
  const [agyModels, setAgyModels] = useState<Array<{ id: string; name: string }>>([]);
  const [task, setTask] = useState<CollaborationTask | null>(null);
  const [strategy, setStrategy] = useState<CollaborationStrategy>("gpt-lead");
  const [kind, setKind] = useState("implementation");
  const [leadPreference, setLeadPreference] = useState("auto");
  const [gpt, setGpt] = useState("");
  const [gemini, setGemini] = useState("");
  const [prompt, setPrompt] = useState("");
  const [paths, setPaths] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = new URLSearchParams({ cwd }).toString();
  const url = `/api/collaboration?${query}`;
  const runningId = task?.status === "running" ? task.id : null;
  const modelKey = (model: ModelOption) => `${model.provider}/${model.id}`;
  const gptModels = models.filter((model) => gptProviders.includes(model.provider));
  const geminiModels = models.filter((model) => geminiProviders.includes(model.provider) && /gemini/i.test(model.id));

  useEffect(() => {
    const panel = dialog.current!;
    panel.showModal();
    return () => panel.close();
  }, []);

  useEffect(() => {
    const signal = new AbortController();
    void request<{ tasks: HistoryItem[]; antigravityConfigured: boolean; testsConfigured: boolean }>(url, { signal: signal.signal })
      .then((data) => { setHistory(data.tasks); setAgy(data.antigravityConfigured); setTestsConfigured(data.testsConfigured); })
      .catch((failure) => { if (!signal.signal.aborted) setError(failure.message); });
    void request<{ modelList: ModelOption[] }>(`/api/models?${query}`, { signal: signal.signal })
      .then((data) => setModels(data.modelList ?? []))
      .catch((failure) => { if (!signal.signal.aborted) setError(failure.message); });
    return () => signal.abort();
  }, [url, query]);

  useEffect(() => {
    if (strategy === "gpt" || gemini !== "agy") return;
    const controller = new AbortController();
    void request<{ models: Array<{ id: string; name: string }> }>(`${url}&antigravityModels=1`, { signal: controller.signal })
      .then((data) => setAgyModels(data.models))
      .catch(() => {});
    return () => controller.abort();
  }, [url, strategy, gemini]);

  useEffect(() => {
    if (!runningId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await request<{ task: CollaborationTask }>(`${url}&id=${encodeURIComponent(runningId)}`, { signal: controller.signal });
        setTask((current) => current?.id === runningId ? data.task : current);
      } catch (failure) {
        if (!controller.signal.aborted) setError((failure as Error).message);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1800);
    };
    timer = setTimeout(poll, 900);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [runningId, url]);

  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const data = await request<{ task?: CollaborationTask }>(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, cwd }),
      });
      if (data.task) setTask(data.task);
      if (body.action === "apply" || body.action === "rollback") {
        setMutation(undefined);
        onWorkingFilesChanged();
      }
      const list = await request<{ tasks: HistoryItem[] }>(url);
      setHistory(list.tasks);
    } catch (failure) {
      setError((failure as Error).message);
    } finally { setBusy(false); }
  }

  async function openTask(id: string) {
    setBusy(true);
    setError("");
    setMutation(undefined);
    try { setTask((await request<{ task: CollaborationTask }>(`${url}&id=${encodeURIComponent(id)}`)).task); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  function downloadDiff() {
    if (!task?.proposal?.diff) return;
    const href = URL.createObjectURL(new Blob([task.proposal.diff], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = `momp-${task.id.slice(0, 8)}.patch`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  }

  const selectedGpt = gptModels.find((model) => modelKey(model) === gpt);
  const selectedGemini = gemini === "agy" ? (agyModel.trim() ? { provider: "antigravity-cli", id: agyModel.trim() } : undefined)
    : geminiModels.find((model) => modelKey(model) === gemini);
  const canApply = task?.status === "complete" && task.proposal?.check === "passed" && Boolean(task.proposal.files?.length)
    && (!task.runTests || task.verification?.status === "passed");

  return <dialog ref={dialog} className="workbench-dialog collaboration-dialog" aria-labelledby="collaboration-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="workbench-dialog-header">
      <div><h2 id="collaboration-title">{t("collaboration.title")}</h2><p className="workbench-project" title={cwd}>{cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd}</p></div>
      <button type="button" onClick={onClose} aria-label={t("collaboration.close")}>×</button>
    </header>
    <div className="workbench-dialog-body collaboration-grid">
      <aside aria-label={t("collaboration.history")} className="collaboration-history">
        <button type="button" disabled={busy} onClick={() => { setTask(null); setError(""); setMutation(undefined); }}>＋ {t("collaboration.new")}</button>
        <h3>{t("collaboration.history")}</h3>
        {history.map((item) => <button key={item.id} type="button" disabled={busy} aria-current={task?.id === item.id ? "true" : undefined} onClick={() => void openTask(item.id)}>{item.title}</button>)}
      </aside>
      <section className="collaboration-content">
        {error && <p role="alert" className="workbench-error">{error}</p>}
        {!task ? <form className="collaboration-form" onSubmit={(event) => {
          event.preventDefault();
          void action({ action: "create", prompt, paths: paths.split("\n").map((line) => line.trim()).filter(Boolean), strategy, taskKind: kind,
            leadPreference, allowFileOperations: fileOperations, runTests: testsConfigured && runTests,
            gpt: strategy !== "gemini" ? selectedGpt : undefined, gemini: strategy !== "gpt" ? selectedGemini : undefined });
        }}>
          <p>{t("collaboration.intro")}</p>
          <label>{t("collaboration.strategy")}<select value={strategy} onChange={(event) => setStrategy(event.target.value as CollaborationStrategy)}>
            {strategies.map((item) => <option key={item} value={item}>{t(`collaboration.strategy.${item}`)}</option>)}
          </select></label>
          {strategy === "smart" && <div className="collaboration-models"><label>{t("collaboration.kind")}<select value={kind} onChange={(event) => setKind(event.target.value)}>
            {["implementation", "interface", "architecture"].map((item) => <option key={item} value={item}>{t(`collaboration.kind.${item}`)}</option>)}
          </select></label><label>{t("collaboration.leadPreference")}<select value={leadPreference} onChange={(event) => setLeadPreference(event.target.value)}>
            <option value="auto">{t("collaboration.strategy.smart")}</option><option value="gpt">GPT</option><option value="gemini">Gemini</option>
          </select></label></div>}
          <div className="collaboration-models">
            {strategy !== "gemini" && <label>GPT<select aria-label="GPT" value={gpt} onChange={(event) => setGpt(event.target.value)} required={strategy !== "smart"}>
              <option value="">{t("collaboration.select")}</option>{gptModels.map((model) => <option key={modelKey(model)} value={modelKey(model)}>{model.name} · {model.provider}</option>)}
            </select></label>}
            {strategy !== "gpt" && <label>Gemini<select aria-label="Gemini" value={gemini} onChange={(event) => setGemini(event.target.value)} required={strategy !== "smart"}>
              <option value="">{t("collaboration.select")}</option>{geminiModels.map((model) => <option key={modelKey(model)} value={modelKey(model)}>{model.name} · {model.provider}</option>)}
              {agy && <option value="agy">Google Antigravity CLI</option>}
            </select></label>}
          </div>
          {strategy !== "gpt" && gemini === "agy" && <label>{t("collaboration.agyModel")}
            <input required list="momp-agy-models" value={agyModel} onChange={(event) => setAgyModel(event.target.value)} placeholder="agy models" />
            <datalist id="momp-agy-models">{agyModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist>
          </label>}
          <label>{t("collaboration.prompt")}<textarea required rows={4} maxLength={12000} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
          <label>{t("collaboration.paths")}<textarea rows={3} value={paths} onChange={(event) => setPaths(event.target.value)} placeholder="src/example.ts" /></label>
          <fieldset className="collaboration-permissions"><legend>{t("collaboration.permissions")}</legend>
            <label><input type="checkbox" checked={fileOperations} onChange={(event) => setFileOperations(event.target.checked)} />{t("collaboration.fileOperations")}</label>
            <label><input type="checkbox" checked={runTests} disabled={!testsConfigured} onChange={(event) => setRunTests(event.target.checked)} />{t("collaboration.runTests")}</label>
            {!testsConfigured && <small>{t("collaboration.testSetup")}</small>}
          </fieldset>
          <button className="workbench-primary" type="submit" disabled={busy || strategy === "smart" && !selectedGpt && !selectedGemini}>{t("collaboration.prepare")}</button>
        </form> : <>
          <div className="collaboration-task-heading"><h3 aria-live="polite">{t(`collaboration.status.${task.status}`)}</h3><code>{task.base.slice(0, 10)}</code></div>
          <p className="collaboration-prompt">{task.prompt}</p>
          {task.paths.length > 0 && <p className="collaboration-paths"><code>{task.paths.join(", ")}</code></p>}
          {task.exclusions?.map(({ model, reason }) => <p key={`${model.provider}/${model.id}`} className="collaboration-paths">
            {t(`collaboration.routing.${reason}`, { model: `${model.provider}/${model.id}` })}
          </p>)}
          <ol className="collaboration-steps" aria-label={t("collaboration.steps")}>
            {task.steps.map((step, index) => <li key={index}>
              <div className="collaboration-step-title"><span>{t(`collaboration.role.${step.role}`)}</span><small>{t(`collaboration.status.${step.status}`)}</small></div>
              <code>{step.model.provider}/{step.model.id}</code>
              {step.attempts > 0 && <span className="collaboration-attempt">{t("collaboration.attempt", { count: step.attempts })}</span>}
              {step.error && <p className="workbench-error">{t(`collaboration.error.${step.error}`)}</p>}
              {step.result && <div className="collaboration-result">{step.result}</div>}
            </li>)}
          </ol>
          {task.runTests && <section className="collaboration-checks" aria-label={t("collaboration.testTitle")}>
            <h4>{t("collaboration.testTitle")}</h4><code>bun test</code>
            <span>{t(`collaboration.test.${task.verification?.status ?? "pending"}`)}</span>
            {task.verification && "passed" in task.verification && task.verification.passed !== undefined && <small>
              {t("collaboration.test.counts", { passed: task.verification.passed, failed: task.verification.failed ?? 0, skipped: task.verification.skipped ?? 0 })}
            </small>}
          </section>}
          {task.proposal && <section className="collaboration-proposal" aria-label="Git diff">
            <h4>Git diff <span>· {t(`collaboration.check.${task.proposal.check}`)}</span></h4>
            {task.proposal.diff && <><pre tabIndex={0}>{task.proposal.diff.trimEnd().split("\n").map((line, index) =>
              <span key={index} data-diff={line.startsWith("@@") ? "range" : line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : undefined}>{line}{"\n"}</span>)}</pre>
              <div className="collaboration-patch-actions">
                <button type="button" onClick={downloadDiff}>{t("collaboration.download")}</button>
                {canApply && (task.application === "applied" || task.application === "reverting"
                  ? <button type="button" disabled={busy} onClick={() => setMutation("rollback")}>{t("collaboration.rollback")}</button>
                  : <button type="button" disabled={busy} onClick={() => setMutation("apply")}>{t("collaboration.apply")}</button>)}
                {task.application && <small role="status">{t(`collaboration.application.${task.application}`)}</small>}
              </div>
              {mutation && <div className="collaboration-actions">
                <p>{t(`collaboration.confirm.${mutation}`)}</p>
                <button type="button" disabled={busy} onClick={() => setMutation(undefined)}>{t("collaboration.cancelConfirm")}</button>
                <button type="button" className="workbench-primary" disabled={busy}
                  onClick={() => void action({ action: mutation, id: task.id, confirm: true })}>{t(`collaboration.commit.${mutation}`)}</button>
              </div>}
            </>}
          </section>}
          {(task.status === "ready" || task.status === "paused") && <div className="collaboration-actions">
            <p>{t("collaboration.consent")}</p>
            <button type="button" className="workbench-primary" disabled={busy} onClick={() => void action({ action: "run", id: task.id, confirm: true })}>
              {t(task.status === "ready" ? "collaboration.run" : "collaboration.resume")}
            </button>
            {task.status === "paused" && task.steps[0].status === "complete" && <button type="button" disabled={busy} onClick={() => void action({ action: "skip-review", id: task.id, confirm: true })}>{t("collaboration.skip")}</button>}
            {task.status === "paused" && task.steps[0].status === "blocked" && task.steps.some((step) => step.model.provider !== task.steps[0].model.provider) &&
              <button type="button" disabled={busy} onClick={() => void action({ action: "prepare-fallback", id: task.id })}>{t("collaboration.fallback")}</button>}
          </div>}
          {task.status === "running" && <button type="button" disabled={busy} onClick={() => void action({ action: "cancel", id: task.id })}>{t("collaboration.pause")}</button>}
        </>}
      </section>
    </div>
  </dialog>;
}
