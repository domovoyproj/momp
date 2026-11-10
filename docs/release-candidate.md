# momp 1.6.3-rc.1

## English

### Overview

This candidate adds automatic Xbox DNS routing to Google's connections on Windows. It keeps Google's official Antigravity client responsible for OAuth, token storage and model requests.

### What's New

Choose **Connections → Google Antigravity → Sign in with Google**. momp prepares the verified client, opens its own Edge profile and returns the authorization code to the official client automatically. No DNS settings, terminal commands or pasted codes are required.

### AI Providers

Google downloads, SDK requests and native Antigravity connections resolve Google hosts through Xbox DNS. ChatGPT remains independent. Gemini API remains a separate API-key connection. Invalid DNS answers fail without a direct Google fallback.

### Hybrid AI

Existing GPT/Gemini task orchestration uses the same routed Antigravity runtime. Ordinary public HTTPS destinations used by native coding tools remain available through the authenticated transport.

### Interface Improvements

Antigravity shows the active automatic route. Sign-in uses a dedicated Edge profile and preserves its cookies for a retry; ordinary browser profiles and Windows networking remain unchanged.

### How to Use

Open **Sign in with Google**, complete Google's account selection and consent, and return to momp. The first use of this separate profile may require a password or 2FA. The official CLI allows about 60 seconds for authentication; retry if it times out. Edge may display its developer-extension notice. It is not suppressed.

### Installation / Upgrade

Use the candidate assets attached only after the release gates pass. Follow the [installation and rollback guide](en/INSTALLATION.md). Keep the current executable to roll back; existing account/session stores are preserved. This candidate does not change stable update eligibility.

### Bug Fixes

The browser no longer escapes the selected Google route. Redirects into Google are checked at each hop; callback codes require the expected state and a per-attempt secret, expire and cannot be reused. Browser startup waits for the callback helper before navigating to Google. Closing or cancelling sign-in closes only its own browser and temporary listeners.

### Compatibility

Windows with installed Microsoft Edge, Antigravity CLI 1.5.5 (verified SHA-512), Oh My Pi 18.18.5, Bun 1.4.4, Next.js 16.4.3, React 19.2.8 and Tauri 2.11.5. The native Google route uses the pinned managed runtime even if a different CLI was configured. Other platforms retain their existing default route. A Windows administrator's browser policies can prevent the callback helper; momp reports failure and does not bypass those policies.

### Known Issues

The native proxy supports public HTTPS on port 443. Internal services, plain HTTP and nonstandard ports are not covered by this proxy; the existing loopback bypass remains available.

**PENDING LIVE VERIFICATION:** real Google account completion, inference and quotas. When checked on 11 November 2026, the Xbox DNS website reported an outage and its resolver returned zero addresses for the Gemini API hostname. Code cannot repair an upstream DNS outage. Public HTTPS checks and synthetic callback tests are not account verification. See the [live checklist](en/LIVE_VERIFICATION.md) and [verification record](IMPLEMENTATION_PROGRESS.md).

### Download

Download only assets attached to the verified candidate and compare their SHA-256 with `SHA256SUMS`. Do not use the old stable executable to test this change. [Xbox DNS screenshots](screenshots/xbox-dns/README.md) · [Earlier UI gallery](screenshots/next/README.md).

## Русский

### Обзор обновления

Кандидат добавляет автоматический Xbox DNS для подключений Google на Windows. OAuth, обмен кодов, хранение токенов и запросы моделей по-прежнему выполняет официальный клиент Antigravity.

### Что нового

Откройте **Подключения → Google Antigravity → Войти через Google**. momp подготовит проверенный клиент, откроет отдельный профиль Edge и автоматически передаст код авторизации официальному клиенту. Не нужно менять DNS, запускать команды или вставлять код.

### AI-провайдеры

Загрузки Google, запросы SDK и Antigravity разрешают имена Google через Xbox DNS. ChatGPT работает независимо. Gemini API остаётся отдельным подключением с API-ключом. Некорректный ответ DNS вызывает ошибку, без скрытого подключения к Google напрямую.

### Совместный режим

Существующие задачи GPT/Gemini используют тот же маршрут Antigravity. Обычные публичные HTTPS-адреса, нужные инструментам разработки, доступны через защищённый транспорт клиента.

### Улучшения интерфейса

Antigravity показывает включённый маршрут. Вход использует отдельный профиль Edge и сохраняет его cookies для следующей попытки. Обычные профили браузера и сетевые настройки Windows не меняются.

### Как пользоваться

Нажмите **Войти через Google**, выберите аккаунт и подтвердите доступ в Google, затем вернитесь в momp. При первом входе в отдельный профиль Google может запросить пароль или 2FA. Официальный CLI ограничивает вход примерно 60 секундами; при таймауте повторите попытку. Edge может показать уведомление о расширении разработчика — оно не отключается.

### Установка / обновление

Используйте артефакты кандидата, прикреплённые только после проверок. См. [установку и откат](ru/INSTALLATION.md). Сохраните текущий EXE для отката: существующие аккаунты и сессии остаются в своих хранилищах. Кандидат не меняет правила стабильных автообновлений.

### Исправления

Окно входа больше не выходит из выбранного маршрута Google. Каждый редирект проверяется заново. Для кода возврата обязательны правильный state и одноразовый секрет; повторная отправка и просроченные запросы отклоняются. Google открывается после готовности помощника возврата. Отмена закрывает только окно этой попытки и её временные сетевые службы.

### Совместимость

Windows с установленным Microsoft Edge; Antigravity CLI 1.5.5 с проверкой SHA-512; Oh My Pi 18.18.5; Bun 1.4.4; Next.js 16.4.3; React 19.2.8; Tauri 2.11.5. Для этого маршрута используется закреплённый клиент, даже если ранее был задан другой CLI. На других платформах остаётся прежний маршрут по умолчанию. Корпоративные политики Edge могут запретить помощник возврата; momp покажет ошибку и не будет обходить эти политики.

### Известные проблемы

Прокси клиента поддерживает публичные HTTPS-адреса на порту 443. Внутренние сервисы, обычный HTTP и нестандартные порты этим прокси не обслуживаются; существующий обход прокси для loopback сохраняется.

**PENDING LIVE VERIFICATION:** завершение входа с реальным аккаунтом, ответы моделей и квоты. 11 ноября 2026 Xbox DNS сообщал о сбое и возвращал нулевые адреса Gemini API. Исправление кода не устраняет сбой DNS-сервиса. Проверки публичного HTTPS и тестового callback не доказывают реальную авторизацию. См. [чек-лист](ru/LIVE_VERIFICATION.md) и [результаты проверок](IMPLEMENTATION_PROGRESS.md).

### Скачать

Используйте только файлы проверенного кандидата и сверяйте SHA-256 с `SHA256SUMS`. Старый стабильный EXE не содержит эту правку. [Скриншоты Xbox DNS](screenshots/xbox-dns/README.md) · [Предыдущая галерея интерфейса](screenshots/next/README.md).
