import { type CSSProperties, type ReactNode } from "react";

type OmpWordmarkProps = {
  label?: ReactNode;
  markSize?: number;
  gap?: number;
  style?: CSSProperties;
  labelStyle?: CSSProperties;
};

export function OmpWordmark({
  label = "momp",
  markSize = 22,
  gap = 10,
  style,
  labelStyle,
}: OmpWordmarkProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
        minWidth: 0,
        color: "var(--text)",
        ...style,
      }}
    >
      <svg
        viewBox="0 0 64 64"
        width={markSize}
        height={markSize}
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <rect width="64" height="64" rx="16" fill="var(--text)" />
        <path d="M14 42 25 24Q28 19 32 26L35 36Q38 43 42 36L51 22" fill="none" stroke="var(--bg)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          color: "inherit",
          fontFamily: '"Plus Jakarta Sans", Geist, ui-sans-serif, system-ui, sans-serif',
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.025em",
          whiteSpace: "nowrap",
          ...labelStyle,
        }}
      >
        {label}
      </span>
    </span>
  );
}
