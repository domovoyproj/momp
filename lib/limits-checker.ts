import { getOmpRuntime } from "./omp-runtime";
import { resolveUsedFraction, type UsageReport } from "@oh-my-pi/pi-ai";

/** One usage window (limit bucket) flattened for the browser. */
export interface UsageLimitView {
  id: string;
  label: string;
  /** Fraction used, 0..1 (>1 means overage). */
  usedFraction: number | null;
  used?: number;
  limit?: number;
  remaining?: number;
  unit: string;
  windowLabel?: string;
  windowDurationMs?: number;
  modelId?: string;
  resetsAt?: number;
  resetLabel?: string;
  status: "ok" | "warning" | "exhausted" | "unknown";
  notes?: string[];
  source: "provider" | "sdk";
}

/** One account's usage report, grouped by provider. */
export interface UsageReportView {
  provider: string;
  email?: string;
  orgName?: string;
  fetchedAt: number;
  limits: UsageLimitView[];
  notes?: string[];
}

function reportToView(report: UsageReport): UsageReportView {
  const meta = (report.metadata ?? {}) as Record<string, unknown>;
  return {
    provider: report.provider,
    email: typeof meta.email === "string" ? meta.email : undefined,
    orgName: typeof meta.orgName === "string" ? meta.orgName : undefined,
    fetchedAt: report.fetchedAt,
    notes: report.notes,
    limits: report.limits.map((limit) => {
      const used = resolveUsedFraction(limit);
      return {
        id: limit.id,
        label: limit.label,
        usedFraction: used !== undefined && Number.isFinite(used) && used >= 0 ? used : null,
        used: limit.amount.used,
        limit: limit.amount.limit,
        remaining: limit.amount.remaining,
        unit: limit.amount.unit,
        windowLabel: limit.window?.label,
        windowDurationMs: limit.window?.durationMs,
        modelId: limit.scope.modelId,
        resetsAt: typeof limit.window?.resetsAt === "number" && Number.isFinite(limit.window.resetsAt)
          && limit.window.resetsAt > 0 ? limit.window.resetsAt : undefined,
        resetLabel: limit.window?.resetLabel,
        status: limit.status ?? "unknown",
        notes: limit.notes,
        source: report.provider === "openai-codex" ? "provider" : "sdk",
      };
    }),
  };
}

/**
 * Real provider usage reports for every authenticated account, exactly as the
 * TUI's `/usage` command surfaces them (Claude 5h/7d, Google Antigravity
 * weekly, etc.). Backed by omp's own broker-coalesced usage fetch.
 */
export async function fetchUsageReportViews(): Promise<UsageReportView[]> {
  const { authStorage } = await getOmpRuntime();
  const reports = await authStorage.usage.reports();
  if (!reports || reports.length === 0) return [];
  return reports.map(reportToView);
}
