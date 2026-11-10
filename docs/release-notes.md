# momp 1.6.0

## English

### Overview

momp is a local coding workspace for Windows and the web. This release updates the Oh My Pi engine and brings two independent provider modes and an explicit workflow for working with both models.

### What’s New

Open a project, work in a saved conversation or prepare an AI task. Review the proposed patch and apply or reverse it from the task after checking the working files.

### AI Providers

ChatGPT uses Codex OAuth. Google Antigravity uses the official CLI for sign-in, model and thinking options, streamed chat and tool approvals. OpenAI API and Gemini API remain separate connections. Usage limits displays the latest successful reports and counts down to provider-reported reset times when available.

### Hybrid AI

Choose GPT Lead, Gemini Lead, Dual Review or smart routing. Independent reviewers receive the lead’s summary, the actual Git diff, the whitespace check and optional project test results. You can pause, retry an unfinished stage or approve a separate fallback. Optional project tests run in an offline, unprivileged container with a snapshot of the proposed tree.

### Interface Improvements

The split view keeps editor and composer controls readable. Connections, mobile settings search, tool permissions and the Update center have dedicated views. See the [screenshot gallery](https://github.com/domovoyproj/momp/tree/v1.6.0/docs/screenshots/next).

### How to Use

Open a project, choose the provider in **Connections** or **Antigravity chat**, then select **AI tasks** for lead-and-review work. Follow the [workspace guide](https://github.com/domovoyproj/momp/blob/v1.6.0/docs/en/USER_GUIDE.md).

### Installation / Upgrade

Verify the SHA-256 of the downloaded asset. Keep the previous stable installation and follow the [installation and rollback guide](https://github.com/domovoyproj/momp/blob/v1.6.0/docs/en/INSTALLATION.md). Preview builds stay outside the automatic stable update channel.

### Bug Fixes

Refresh failures preserve the most recent quota report. A replayed Antigravity session keeps the existing transcript. The editor supports leaving with Shift+Tab. MCP launch credentials and authenticated URLs are redacted while stored values survive an edit.

### Compatibility

Oh My Pi 18.18.5, Bun 1.4.4, Next.js 16.4.3, React 19.2.8 and Tauri 2.11.5. The release workflow checks TypeScript, ESLint, unit and integration tests, simulated OAuth and providers, Docker isolation, production browser flows and installer rollback. The Windows job builds and smoke-tests the portable EXE and its embedded Bun runtime. The browser archive records the light and dark desktop and mobile runs.

### Known Issues

The published candidate produced the OpenAI OAuth authorization request and connected to Antigravity CLI 1.5.4 through ACP on Windows. Sign-in with real accounts, model responses and account quotas remain **PENDING LIVE VERIFICATION**. Antigravity requires the official CLI. Hybrid edits are scoped to selected UTF-8 paths. Isolated project tests require a local Linux container engine and a prepared Bun image. The Windows EXE has no Authenticode signature. See the [live checklist](https://github.com/domovoyproj/momp/blob/v1.6.0/docs/en/LIVE_VERIFICATION.md).

### Download

Use `momp.exe` for portable Windows, `momp-web-dist.tar.gz` for web, and `browser-verification.tar.gz` for screenshots. Verify each with `SHA256SUMS`.

## Русский

### Обзор обновления

momp — локальная среда разработки для Windows и браузера. Выпуск обновляет ядро Oh My Pi и добавляет два самостоятельных режима и сценарий совместной работы моделей.

### Что нового

Откройте проект, продолжите сохранённый диалог или подготовьте задачу AI. Проверьте предложенный патч, примените или отмените его из задачи после сверки рабочих файлов.

### AI-провайдеры

ChatGPT использует Codex OAuth. Google Antigravity использует официальный CLI для входа, выбора модели и рассуждений, потокового чата и разрешений на действия. OpenAI API и Gemini API остаются отдельными подключениями. Окно лимитов сохраняет последние успешные отчёты и показывает обратный отсчёт до сообщённого провайдером восстановления.

### Совместный режим

Выберите GPT или Gemini исполнителем, двойное ревью или автоматическое распределение. Независимые ревьюеры получают сводку, настоящий Git diff, проверку пробелов и результаты запрошенных тестов. Задачу можно приостановить, повторить незавершённый этап или подтвердить отдельный запуск с одним провайдером. Тесты проекта работают в контейнере без сети и повышенных привилегий на снимке дерева с патчем.

### Улучшения интерфейса

Редактор и панель ввода остаются читаемыми в разделённом окне. Добавлены отдельные экраны подключений, мобильного поиска настроек, разрешений и обновлений. Снимки доступны в [галерее](https://github.com/domovoyproj/momp/tree/v1.6.0/docs/screenshots/next).

### Как пользоваться

Откройте проект, выберите провайдера в **Подключениях** или **Чате Antigravity**. Для работы с исполнителем и ревьюером откройте **Задачи AI**. См. [руководство](https://github.com/domovoyproj/momp/blob/v1.6.0/docs/ru/USER_GUIDE.md).

### Установка / обновление

Сверьте SHA-256 скачанного файла. Сохраните предыдущую стабильную версию и следуйте [инструкции установки и отката](https://github.com/domovoyproj/momp/blob/v1.6.0/docs/ru/INSTALLATION.md). Предварительные сборки не попадают в автоматические стабильные обновления.

### Исправления

При сбое обновления лимитов виден последний успешный отчёт. Восстановление Antigravity сохраняет переписку без повторов. Из редактора можно выйти сочетанием Shift+Tab. Секреты в аргументах запуска MCP и URL скрыты, а сохранённые значения переживают редактирование.

### Совместимость

Oh My Pi 18.18.5, Bun 1.4.4, Next.js 16.4.3, React 19.2.8 и Tauri 2.11.5. Релизный процесс проверяет TypeScript, ESLint, модульные и интеграционные тесты, имитацию OAuth и провайдеров, изоляцию Docker, браузерные сценарии production-сборки и откат установки. Задача Windows собирает и проверяет переносимый EXE со встроенным Bun. Браузерный архив содержит результаты в светлой и тёмной темах на desktop и mobile.

### Известные проблемы

Опубликованный кандидат сформировал запрос авторизации OpenAI и подключился к Antigravity CLI 1.5.4 по ACP на Windows. Вход на реальных аккаунтах, ответы моделей и квоты остаются в статусе **PENDING LIVE VERIFICATION**. Для Antigravity нужен официальный CLI. В Hybrid изменяются выбранные UTF-8 файлы. Для изолированных тестов нужен локальный движок Linux-контейнеров и подготовленный образ Bun. EXE Windows не подписан Authenticode. См. [порядок ручной проверки](https://github.com/domovoyproj/momp/blob/v1.6.0/docs/ru/LIVE_VERIFICATION.md).

### Скачать

`momp.exe` — переносимое приложение Windows, `momp-web-dist.tar.gz` — веб-сборка, `browser-verification.tar.gz` — скриншоты. Для каждого файла сверяйте `SHA256SUMS`.
