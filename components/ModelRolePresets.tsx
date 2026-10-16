"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { createModelRolePreset, MODEL_ROLE_PRESETS, type ModelRolePreset } from "@/lib/model-role-presets";
import { SearchableSelect } from "./SearchableSelect";

interface Props {
  models: { id: string; name: string; provider: string }[];
  disabled: boolean;
  onApply: (preset: ModelRolePreset, gpt: string, gemini: string) => Promise<void>;
}

export function ModelRolePresets({ models, disabled, onApply }: Props) {
  const { locale } = useI18n();
  const russian = locale === "ru";
  const [preset, setPreset] = useState<ModelRolePreset>("balanced");
  const [gpt, setGpt] = useState("");
  const [gemini, setGemini] = useState("");
  const [pending, setPending] = useState(false);
  const gptModels = models.filter(model => /^(openai-codex|openai|github-copilot)$/.test(model.provider) && /gpt|codex/i.test(model.id));
  const geminiModels = models.filter(model => /^(google-antigravity|google|google-gemini-cli|github-copilot)$/.test(model.provider) && /gemini/i.test(model.id));
  const selectedGpt = gptModels.some(model => `${model.provider}/${model.id}` === gpt) ? gpt : "";
  const selectedGemini = geminiModels.some(model => `${model.provider}/${model.id}` === gemini) ? gemini : "";
  const ready = Boolean(selectedGpt && selectedGemini);
  const names = russian ? { balanced: "Баланс", quality: "Качество", fast: "Gemini + ревью GPT" } : { balanced: "Balanced", quality: "Quality", fast: "Gemini + GPT review" };
  return (
    <section className="role-presets" aria-label="GPT + Gemini">
      <div className="role-presets-heading"><strong>GPT + Gemini</strong><span>{russian ? "Одна команда, разные роли" : "One team, complementary roles"}</span></div>
      <div className="role-preset-tabs">
        {MODEL_ROLE_PRESETS.map(value => <button key={value} type="button" aria-pressed={preset === value} disabled={pending} onClick={() => setPreset(value)}>{names[value]}</button>)}
      </div>
      <p>{russian ? "Выберите доступные модели. Пресет заменит восемь ролей в выбранной области; остальные настройки сохранятся. Роль advisor сама по себе не включает автоматическое ревью." : "Choose available models. Applying replaces eight roles in the selected scope and preserves other settings. The advisor role does not enable automatic review by itself."}</p>
      <div className="role-preset-selectors">
        {([{ label: "GPT", value: selectedGpt, entries: gptModels, change: setGpt }, { label: "Gemini", value: selectedGemini, entries: geminiModels, change: setGemini }]).map(group => (
          <SearchableSelect key={group.label} value={group.value} ariaLabel={group.label} disabled={pending || disabled} onChange={group.change} options={[{ value: "", label: `${russian ? "Выберите" : "Choose"} ${group.label}` }, ...group.entries.map(model => ({ value: `${model.provider}/${model.id}`, label: `${model.name} — ${model.provider}` }))]} />
        ))}
      </div>
      {ready && <div className="role-preset-preview">{Object.entries(createModelRolePreset(preset, selectedGpt, selectedGemini)).map(([role, model]) => <span key={role}><code>{role}</code><b>{model === selectedGpt ? "GPT" : "Gemini"}</b></span>)}</div>}
      {(!gptModels.length || !geminiModels.length) && <p role="status">{russian ? "Сначала подключите ChatGPT и Antigravity (или другие провайдеры GPT/Gemini) в разделе подключений." : "First connect ChatGPT and Antigravity, or other GPT/Gemini providers, in Connections."}</p>}
      <button className="role-preset-apply" type="button" disabled={!ready || pending || disabled} onClick={async () => { setPending(true); try { await onApply(preset, selectedGpt, selectedGemini); } finally { setPending(false); } }}>{pending ? (russian ? "Сохранение…" : "Saving…") : (russian ? "Применить пресет" : "Apply preset")}</button>
    </section>
  );
}
