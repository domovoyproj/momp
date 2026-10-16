"use client";

import { useI18n } from "@/hooks/useI18n";

export function WelcomeScreen({ onPrompt }: { onPrompt?: (prompt: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="welcome-screen">
      <span className="welcome-eyebrow">{t("welcome.eyebrow")}</span>
      <h1>{t("welcome.title")}</h1>
      <p>{t("welcome.subtitle")}</p>
      {onPrompt && <div className="welcome-suggestions">
        {(["explore", "fix", "release"] as const).map((action, index) => (
          <button key={action} onClick={() => onPrompt(t(`welcome.${action}Prompt`))}>
            <span className="suggestion-symbol" aria-hidden="true">{["⌘", "↗", "◈"][index]}</span>
            <span><strong>{t(`welcome.${action}`)}</strong><small>{t(`welcome.${action}Hint`)}</small></span>
          </button>
        ))}
      </div>}
    </div>
  );
}
