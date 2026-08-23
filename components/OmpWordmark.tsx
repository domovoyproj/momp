import { useId, type CSSProperties, type ReactNode } from "react";

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
  const gradientId = `omp-pi-gradient-${useId().replaceAll(":", "")}`;

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
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="oklch(0.7 0.24 340)" />
            <stop offset=".5" stopColor="oklch(0.62 0.21 295)" />
            <stop offset="1" stopColor="oklch(0.81 0.14 200)" />
          </linearGradient>
        </defs>
        <path fill={`url(#${gradientId})`} d="M6 10 h10 v38 H6 z M48 10 h10 v38 H48 z M6 10 L32 25 L58 10 L58 19 L32 34 L6 19 z M19 28 h10 v24 H19 z M35 28 h10 v30 h6 v-8 h-6 V28 z" />
      </svg>
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          color: "inherit",
          fontFamily: '"Plus Jakarta Sans", Geist, ui-sans-serif, system-ui, sans-serif',
          fontSize: 15,
          fontWeight: 700,
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
