"use client";

import { useI18n } from "@/hooks/useI18n";
import { OmpWordmark } from "./OmpWordmark";
import { WorkspaceIcon } from "./WorkspaceIcon";

export function WelcomeScreen({ onPrompt }: { onPrompt?: (prompt: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="welcome-screen">
      <div className="welcome-mark"><OmpWordmark markSize={42} label="" gap={0} /></div>
      <h1>{t("welcome.title")}</h1>
      <p>{t("welcome.subtitle")}</p>
      {onPrompt && <div className="welcome-suggestions">
        {(["explore", "fix", "release"] as const).map((action) => (
          <button key={action} onClick={() => onPrompt(t(`welcome.${action}Prompt`))}>
            <span className="suggestion-symbol"><WorkspaceIcon name={action} size={20} /></span>
            <span><strong>{t(`welcome.${action}`)}</strong><small>{t(`welcome.${action}Hint`)}</small></span>
          </button>
        ))}
      </div>}
    </div>
  );
}
