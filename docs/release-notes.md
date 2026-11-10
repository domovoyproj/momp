# momp 1.6.1

## English

### Overview

This update fixes a clipped project menu, restores browsing at Windows drive roots, and makes Google Antigravity sign-in available before opening a project.

### What's New

The Antigravity panel can recheck the CLI installation and cancel a pending sign-in. File Explorer and Skills offer a directory picker when the selected project folder is gone.

### AI Providers

momp finds Google's standard CLI installation automatically. Set the absolute path in MOMP_ANTIGRAVITY_CLI if you installed the CLI elsewhere. [AI modes](https://github.com/domovoyproj/momp/blob/v1.6.1/docs/en/AI_MODES.md)

### Hybrid AI

If you use Antigravity as the Gemini provider in AI tasks, the same detected CLI is available for its lead and review roles. [Hybrid AI guide](https://github.com/domovoyproj/momp/blob/v1.6.1/docs/en/HYBRID_MODE.md)

### Interface Improvements

The project menu opens over the sidebar and fits inside the window. Escape closes it and returns focus to the project button. [Desktop and mobile screenshots](https://github.com/domovoyproj/momp/tree/v1.6.1/docs/screenshots/next#project-menu-in-161--меню-проекта-в-161)

### How to Use

Choose **Connections → Google Antigravity → Sign in with Google**, complete sign-in in the browser, then open a project to start or reconnect a conversation.

### Installation / Upgrade

Verify the SHA-256 before installing. Keep your previous installer for rollback. [Installation and rollback](https://github.com/domovoyproj/momp/blob/v1.6.1/docs/en/INSTALLATION.md)

### Bug Fixes

An explicitly selected drive root now opens in File Explorer. Skills reports a missing project folder and links to the directory picker. Antigravity loads the conversation history when the workspace finishes restoring after a reload.

### Compatibility

Oh My Pi 18.18.5 and Bun 1.4.4. The Google integration requires the official Antigravity CLI. Usage reports require CLI 1.5.0 or newer.

### Known Issues

Google sign-in, responses and quotas with a real account remain **PENDING LIVE VERIFICATION**. [Live verification checklist](https://github.com/domovoyproj/momp/blob/v1.6.1/docs/en/LIVE_VERIFICATION.md)

### Download

The assets below include the Windows EXE, web distribution, browser verification archive and SHA-256 checksums.

## Русский

### Обзор обновления

В этой версии исправлено обрезание меню проекта и открытие корня диска в Windows. Войти в Google Antigravity теперь можно до выбора проекта.

### Что нового

В панели Antigravity можно перепроверить установку CLI и отменить ожидающий вход. Если выбранная папка исчезла, проводник и **Навыки** предлагают выбрать другую.

### AI-провайдеры

momp автоматически находит CLI в стандартной папке Google. При установке в другое место укажите абсолютный путь в MOMP_ANTIGRAVITY_CLI. [Режимы AI](https://github.com/domovoyproj/momp/blob/v1.6.1/docs/ru/AI_MODES.md)

### Совместный режим

Если в **Задачах AI** вы используете Antigravity для Gemini, найденный CLI доступен для выполнения и ревью. [Руководство по совместному режиму](https://github.com/domovoyproj/momp/blob/v1.6.1/docs/ru/HYBRID_MODE.md)

### Улучшения интерфейса

Меню проекта открывается поверх боковой панели и помещается в окне. Escape закрывает меню и возвращает фокус к кнопке проекта. [Скриншоты на компьютере и телефоне](https://github.com/domovoyproj/momp/tree/v1.6.1/docs/screenshots/next#project-menu-in-161--меню-проекта-в-161)

### Как пользоваться

Выберите **Подключения → Google Antigravity → Войти через Google**, завершите вход в браузере, затем откройте проект, чтобы начать или переподключить диалог.

### Установка / обновление

Перед установкой сверьте SHA-256. Сохраните предыдущий установщик для отката. [Установка и откат](https://github.com/domovoyproj/momp/blob/v1.6.1/docs/ru/INSTALLATION.md)

### Исправления

Проводник открывает явно выбранный корень диска. **Навыки** сообщают об исчезнувшей папке проекта и предлагают выбрать другую. После перезагрузки история диалогов Antigravity появляется, как только проект восстановлен.

### Совместимость

Oh My Pi 18.18.5 и Bun 1.4.4. Для интеграции с Google нужен официальный Antigravity CLI. Для отчётов о лимитах нужна версия CLI 1.5.0 или новее.

### Известные проблемы

Вход в Google, ответы и квоты на реальном аккаунте остаются в статусе **PENDING LIVE VERIFICATION**. [Порядок ручной проверки](https://github.com/domovoyproj/momp/blob/v1.6.1/docs/ru/LIVE_VERIFICATION.md)

### Скачать

К релизу приложены EXE для Windows, веб-сборка, архив браузерных проверок и контрольные суммы SHA-256.
