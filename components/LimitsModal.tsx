"use client";

import { useCallback, useEffect, useState } from "react";
import type { UsageReportView, UsageLimitView } from "@/lib/limits-checker";

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Claude (Anthropic)",
  claude: "Claude (Anthropic)",
  "claude-code": "Claude Code",
  google: "Google Gemini",
  gemini: "Google Gemini",
  "google-antigravity": "Google Antigravity",
  "google-vertex": "Google Vertex",
  openai: "OpenAI",
  "openai-codex": "ChatGPT / Codex",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  groq: "Groq",
  mistral: "Mistral",
};

const WINDOW_NAMES: Record<string, string> = {
  "5 hour": "5 часов",
  "7 day": "7 дней",
  weekly: "Неделя",
  daily: "День",
  monthly: "Месяц",
  hourly: "Час",
};

function providerName(provider: string): string {
  return PROVIDER_NAMES[provider.toLowerCase()] ?? provider;
}

function translateWindow(label?: string): string | undefined {
  if (!label) return undefined;
  return WINDOW_NAMES[label.toLowerCase()] ?? label;
}

/** "Claude 5 Hour" -> "Claude"; "Usage (Google)" -> "Google". */
function brandLabel(limit: UsageLimitView): string {
  const usage = limit.label.match(/^Usage \((.+)\)$/);
  if (usage) return usage[1];
  if (limit.windowLabel && limit.label.endsWith(limit.windowLabel)) {
    return limit.label.slice(0, limit.label.length - limit.windowLabel.length).trim() || limit.label;
  }
  return limit.label;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "сейчас";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${minutes}м`;
  return `${minutes}м`;
}

function barColor(freeFraction: number): string {
  if (freeFraction <= 0.0001) return "var(--danger)";
  if (freeFraction < 0.2) return "var(--warning)";
  return "var(--success)";
}

function LimitRow({ limit, now }: { limit: UsageLimitView; now: number }) {
  const freeFraction = Math.max(0, Math.min(1, 1 - limit.usedFraction));
  const freePct = Math.round(freeFraction * 100);
  const color = barColor(freeFraction);
  const resetMs = limit.resetsAt ? limit.resetsAt - now : undefined;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>{brandLabel(limit)}</span>
          {limit.windowLabel && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{translateWindow(limit.windowLabel)}</span>
          )}
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color, whiteSpace: "nowrap" }}>{freePct}% свободно</span>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 6, background: "var(--bg-hover)", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${freePct}%`,
            background: color,
            borderRadius: 6,
            transition: "width 0.35s ease",
          }}
        />
      </div>
      {resetMs !== undefined && resetMs > 0 && (
        <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 3 }}>
          {limit.resetLabel === "regen" ? "восстановление через" : "сброс через"} {formatDuration(resetMs)}
        </div>
      )}
    </div>
  );
}

export function LimitsModal({ onClose }: { onClose: () => void }) {
  const [reports, setReports] = useState<UsageReportView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const now = Date.now();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/models-config/limits", { cache: "no-store" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReports(data.reports ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Лимиты использования</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: loading ? "default" : "pointer",
                fontSize: 12,
                padding: "4px 10px",
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? "Обновление…" : "Обновить"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 4px" }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: "16px 18px", flex: 1 }}>
          {loading && !reports && (
            <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>Загрузка лимитов…</div>
          )}
          {error && (
            <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 0" }}>Ошибка: {error}</div>
          )}
          {!loading && !error && reports && reports.length === 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
              Нет данных о лимитах для авторизованных провайдеров.
              <br />
              Лимиты доступны для аккаунтов с OAuth-подпиской (Claude, Google Antigravity и др.).
            </div>
          )}
          {reports?.map((report, i) => (
            <div key={`${report.provider}:${report.email ?? i}`} style={{ marginBottom: 22 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>{providerName(report.provider)}</div>
                {report.email && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{report.email}</div>
                )}
              </div>
              {report.limits.map((limit) => (
                <LimitRow key={limit.id + limit.windowLabel} limit={limit} now={now} />
              ))}
              {report.notes?.map((note, n) => (
                <div key={n} style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 4 }}>{note}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
