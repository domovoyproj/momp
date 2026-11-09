# momp 1.6.0-rc.1

## English

### Overview

This candidate brings the OMP engine up to date and adds persistent AI tasks in the local workspace.

### What’s New

Prepare an AI task, check the models and source context, and confirm the run. Resume unfinished steps after an interruption and export the proposed Git patch.

### AI Providers

ChatGPT sign-in and OpenAI API keys use separate routes. Gemini API can power a normal coding session. Google Antigravity can participate in AI tasks through its official CLI.

### Hybrid AI

Choose GPT Lead, Gemini Lead, Dual Review or routing by task type. Each reviewer receives the proposed diff and the result of the Git whitespace check.

### Interface Improvements

AI tasks shows the selected models, stage results and review history. Connections distinguishes API keys and account sign-in. Usage limits displays missing figures, a countdown and the most recent provider report.

The browser-verification archive contains screenshots from the production web build in light and dark themes, at desktop and mobile sizes.

### How to Use

Open a Git project and choose **AI tasks** in the sidebar. Select the strategy and committed source files, then prepare and confirm. See the [English guide](https://github.com/domovoyproj/momp/blob/feat/next-generation-rc/docs/en/USER_GUIDE.md).

### Installation / Upgrade

Use the Windows executable or the web archive for candidate testing. Keep the previous stable installation for rollback. Preview builds are separate from automatic stable updates.

### Bug Fixes

Unknown quota amounts no longer appear as an entirely unused allowance. The paused SDK Antigravity route no longer advertises API-key sign-in.

### Compatibility

Oh My Pi 18.18.5, Bun 1.4.4, Next.js 16.4.3, React 19.2.8 and Tauri 2.11.5.

Local validation passed 659 Bun tests with five platform-dependent skips, TypeScript, lint, the web build, and four browser scenarios with synthetic providers. The release workflow also requires native Windows build and executable smoke checks.

### Known Issues

Real account sign-in, inference and quota checks are pending. OMP's Antigravity OAuth is paused. The official CLI adapter is available for proposals and reviews in AI tasks. Applying patches and running project tests are manual.

### Download

Check the candidate assets against SHA256SUMS in this release. The Windows portable executable has no Authenticode signature.

## Русский

### Обзор обновления

Кандидат обновляет ядро OMP и добавляет сохраняемые задачи AI в локальном рабочем пространстве.

### Что нового

Подготовьте задачу, проверьте модели и исходный контекст, затем подтвердите запуск. После прерывания можно повторить незавершённые этапы и скачать предложенный Git-патч.

### AI-провайдеры

Для входа в ChatGPT и ключей OpenAI API предусмотрены отдельные подключения. Gemini API доступен в обычном чате. Google Antigravity может участвовать в задачах через официальный CLI.

### Совместный режим

Выберите GPT или Gemini исполнителем, включите двойное ревью или распределение по типу задачи. Каждый ревьюер получает предложенный diff и результат проверки пробелов Git.

### Улучшения интерфейса

Панель задач показывает модели, результаты этапов и историю ревью. В подключениях различаются вход в аккаунт и API-ключи. Окно лимитов показывает отсутствующие данные, обратный отсчёт и время последнего отчёта.

В архиве браузерной проверки находятся скриншоты production-сборки в светлой и тёмной темах на desktop и mobile.

### Как пользоваться

Откройте Git-проект и выберите **Задачи AI** в боковой панели. Укажите стратегию и файлы из коммита, подготовьте и подтвердите задачу. См. [руководство](https://github.com/domovoyproj/momp/blob/feat/next-generation-rc/docs/ru/USER_GUIDE.md).

### Установка / обновление

Для проверки кандидата используйте EXE или веб-архив. Сохраните предыдущую стабильную версию для отката. Предварительные сборки отделены от автоматических стабильных обновлений.

### Исправления

Неизвестная квота больше не выглядит полностью свободной. Приостановленный в OMP Antigravity OAuth больше не предлагается как подключение по API-ключу.

### Совместимость

Oh My Pi 18.18.5, Bun 1.4.4, Next.js 16.4.3, React 19.2.8 и Tauri 2.11.5.

Локально прошли 659 тестов Bun при пяти платформенных пропусках, TypeScript, ESLint, веб-сборка и четыре браузерных сценария с имитаторами провайдеров. Релизный процесс также требует нативной сборки Windows и smoke-теста EXE.

### Известные проблемы

Вход в реальные аккаунты, ответы моделей и квоты ожидают проверки. Antigravity OAuth в OMP приостановлен. Официальный CLI доступен для предложений и ревью в задачах AI. Патчи применяются и тесты проекта запускаются вручную.

### Скачать

Сверьте файлы кандидата с SHA256SUMS в релизе. Переносимый EXE не подписан Authenticode.
