import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../hooks/useI18n.tsx";
import { SettingsConfig } from "./SettingsConfig.tsx";

const html = renderToStaticMarkup(
  React.createElement(I18nProvider, null,
    React.createElement(SettingsConfig, {
      initialSection: "themes",
      sessionId: null,
      onClose: () => {},
    }),
  ),
);

test("settings search has a programmatic name independent of its placeholder", () => {
  const searchInput = html.match(/<input\b[^>]*>/)?.[0];
  assert.ok(searchInput);
  assert.match(searchInput, /aria-label="Поиск настроек…"/);
});

test("settings close retains an accessible name when its visible label is hidden on mobile", () => {
  const closeButton = html.match(/<button\b[^>]*><span>Закрыть настройки<\/span><span aria-hidden="true">×<\/span><\/button>/)?.[0];
  assert.ok(closeButton);
  assert.match(closeButton, /aria-label="Закрыть настройки"/);
});
