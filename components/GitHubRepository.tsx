"use client";

import { useEffect, useState } from "react";
import { openExternal } from "@/lib/open-external";
import { useI18n } from "@/hooks/useI18n";
import { WorkspaceIcon } from "./WorkspaceIcon";

export function GitHubRepository({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const [repository, setRepository] = useState<{ cwd: string; url: string; branch: string | null }>();
  useEffect(() => {
    if (!cwd) return;
    const controller = new AbortController();
    void fetch(`/api/github?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (data.url) setRepository({ cwd, url: data.url, branch: data.branch });
      }).catch(() => {});
    return () => controller.abort();
  }, [cwd]);
  if (!repository || repository.cwd !== cwd) return null;
  return (
    <div className="github-repository">
      <button onClick={() => openExternal(repository.url)} title={repository.url}>
        <WorkspaceIcon name="branch" />
        <span>GitHub<small>{repository.url.split("/").slice(-2).join("/")}</small></span>
        <code>{repository.branch}</code>
      </button>
      <div className="github-links">
        <button onClick={() => openExternal(`${repository.url}/pulls`)}>Pull requests ↗</button>
        <button onClick={() => openExternal(`${repository.url}/actions`)}>{t("connections.actions")} ↗</button>
      </div>
    </div>
  );
}
