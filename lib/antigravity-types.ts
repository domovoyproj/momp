export type AntigravityStatus = "offline" | "connecting" | "ready" | "running" | "stopping";
export type AntigravityError = "not-installed" | "setup-failed" | "setup-integrity" | "xbox-dns-browser" | "auth-required" | "quota" | "interrupted" | "timeout" | "unsupported" | "unavailable" | "cancelled";

export interface AntigravityMessage {
  id: string;
  role: "user" | "assistant" | "thinking";
  text: string;
}

export interface AntigravityOption {
  id: string;
  name: string;
  value: string;
  choices: Array<{ value: string; name: string }>;
}

export interface AntigravityTool {
  id: string;
  title: string;
  status?: string;
  output?: string;
  changes?: Array<{ path: string; before: string; after: string }>;
}

export interface AntigravityPermission {
  id: string;
  title: string;
  canAllow: boolean;
}

export interface AntigravityThread {
  id: string;
  title: string;
  revision: number;
  status: AntigravityStatus;
  error?: AntigravityError;
  messages: AntigravityMessage[];
  options: AntigravityOption[];
  tools: AntigravityTool[];
  permissions: AntigravityPermission[];
  plan?: Array<{ text: string; status: string }>;
  context?: { used: number; size: number };
  stopReason?: string;
}

export type AntigravityHistoryItem = Pick<AntigravityThread, "id" | "title" | "revision" | "status">;
