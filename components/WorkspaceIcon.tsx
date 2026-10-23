import type { CSSProperties } from "react";

const paths = {
  chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
  connections: "M8 3v4m8-4v4M6 7h12v3a6 6 0 0 1-12 0V7Zm6 9v5",
  skills: "m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5",
  explore: "M4 5h6l2 2h8v12H4V5Zm4 6h8m-8 4h5",
  fix: "m9 7-2-3m8 3 2-3M8 9h8v7a4 4 0 0 1-8 0V9Zm-4 3h4m8 0h4M4 17h4m8 0h4M9 9V8a3 3 0 0 1 6 0v1",
  release: "M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5",
  branch: "M6 3v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12-12a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 6a9 9 0 0 1-9 9",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z",
} as const;

export function WorkspaceIcon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, ...style }}><path d={paths[name]} /></svg>;
}
