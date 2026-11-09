"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UsageReportView, UsageLimitView } from "@/lib/limits-checker";
import type { AntigravityUsage } from "@/lib/collaboration-providers";
import { useI18n } from "@/hooks/useI18n";

const PROVIDER_NAMES: Record<string, string> = {
  "openai-codex": "ChatGPT / Codex", "google-antigravity": "Google Antigravity",
  openai: "OpenAI API", google: "Gemini API", "google-vertex": "Vertex AI", anthropic: "Anthropic",
};

function LimitRow({ limit, now }: { limit: UsageLimitView; now: number }) {
  const { t, locale } = useI18n();
  const remaining = limit.usedFraction === null ? null : Math.max(0, Math.round((1 - limit.usedFraction) * 100));
  const minutes = limit.resetsAt ? Math.ceil((limit.resetsAt - now) / 60_000) : null;
  const status = limit.status === "exhausted" || (limit.usedFraction ?? 0) >= 1 ? "exhausted" : limit.status;
  return <li className="usage-limit" data-status={status}>
    <div className="usage-row"><strong>{limit.label}</strong><span>{remaining === null ? t("usage.unknown") : t("usage.remaining", { percent: remaining })}</span></div>
    {remaining !== null && <meter min={0} max={100} value={remaining} aria-label={`${limit.label} · ${t("usage.remaining", { percent: remaining })}`} />}
    <div className="usage-row usage-meta">
      <span>{[limit.windowLabel, limit.modelId, t(`usage.source.${limit.source}`)].filter(Boolean).join(" · ")}</span>
      {status === "exhausted" && <strong>{t("usage.exhausted")}</strong>}
    </div>
    {limit.resetsAt && <div className="usage-meta">
      {t(limit.resetLabel === "regen" ? "usage.regen" : "usage.reset")} {" "}
      <time dateTime={new Date(limit.resetsAt).toISOString()}>{new Date(limit.resetsAt).toLocaleString(locale)}</time>
      {" · "}{minutes !== null && minutes > 0 ? t("usage.countdown", { hours: Math.floor(minutes / 60), minutes: minutes % 60 }) : t("usage.refreshPending")}
    </div>}
    {limit.notes?.map((note, index) => <p key={index} className="usage-meta">{note}</p>)}
  </li>;
}

export function LimitsModal({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef<AbortController | null>(null);
  const [reports, setReports] = useState<UsageReportView[] | null>(null);
  const [antigravity, setAntigravity] = useState<AntigravityUsage | undefined>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
      const response = await fetch("/api/models-config/limits", { cache: "no-store", signal });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.reports)) throw new Error();
      if (!data.ompUnavailable) setReports(data.reports);
      setError(Boolean(data.ompUnavailable));
      setAntigravity(data.antigravity);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const panel = dialog.current!;
    panel.showModal();
    void load();
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    const polling = setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => {
      panel.close();
      clearInterval(clock);
      clearInterval(polling);
      active.current?.abort();
      active.current = null;
    };
  }, [load]);

  const order = ["openai-codex", "google-antigravity"];
  const priority = (id: string) => order.includes(id) ? order.indexOf(id) : order.length;
  const orderedReports = reports?.slice().sort((a, b) => priority(a.provider) - priority(b.provider) || a.provider.localeCompare(b.provider));

  return <dialog ref={dialog} className="workbench-dialog usage-dialog" aria-labelledby="usage-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="workbench-dialog-header">
      <div><div className="workbench-kicker">MOMP / CONNECTIONS</div><h2 id="usage-title">{t("usage.title")}</h2></div>
      <div className="usage-actions">
        <button type="button" onClick={() => void load()} disabled={loading}>{t(loading ? "usage.loading" : "usage.refresh")}</button>
        <button type="button" onClick={onClose} aria-label={t("collaboration.close")}>×</button>
      </div>
    </header>
    <div className="workbench-dialog-body usage-content">
      <p className="usage-meta">{t("usage.description")}</p>
      {error && <p role="alert" className="workbench-error">{t("usage.error")}</p>}
      {!loading && !error && !orderedReports?.length && antigravity?.status !== "ready" && <p>{t("usage.empty")}</p>}
      {orderedReports?.map((report, index) => <section className="usage-report" key={`${report.provider}:${index}`}>
        <h3>{PROVIDER_NAMES[report.provider] ?? report.provider}</h3>
        <div className="usage-meta">{[report.email, report.orgName, new Date(report.fetchedAt).toLocaleString(locale)].filter(Boolean).join(" · ")}</div>
        <ul>{report.limits.map((limit) => <LimitRow key={`${limit.id}:${limit.windowLabel}`} limit={limit} now={now} />)}</ul>
        {report.notes?.map((note, n) => <p key={n} className="usage-meta">{note}</p>)}
      </section>)}
      {antigravity && <section className="usage-report">
        <h3>Google Antigravity CLI</h3>
        {antigravity.status === "ready" ? <>
          <p className="usage-meta">{t("usage.source.provider")} · {new Date(antigravity.fetchedAt).toLocaleString(locale)}</p>
          <table className="usage-cli-table" aria-label="Google Antigravity CLI"><tbody>
            {antigravity.rows.map((row, rowIndex) => <tr key={rowIndex}>
              {row.map((cell, index) => <td key={index}>{cell}</td>)}
            </tr>)}
          </tbody></table>
        </> : <p className="usage-meta">{t("usage.antigravityUnavailable")}</p>}
      </section>}
      <p className="usage-meta">{t("usage.antigravity")}</p>
    </div>
  </dialog>;
}
