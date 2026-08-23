/**
 * Полный словарь переводов для всех разделов, вкладок, групп и параметров настроек momp.
 */

export const SETTINGS_TAB_TRANSLATIONS: Record<string, string> = {
  appearance: "Внешний вид",
  model: "Модель",
  interaction: "Взаимодействие",
  context: "Контекст",
  memory: "Память",
  files: "Файлы",
  shell: "Терминал и оболочка",
  tools: "Инструменты",
  tasks: "Задачи и субагенты",
  providers: "Провайдеры",
};

export const SETTINGS_GROUP_TRANSLATIONS: Record<string, string> = {
  // Appearance
  "Theme": "Тема оформления",
  "Status Line": "Строка состояния",
  "Display": "Отображение",
  "Images": "Изображения",

  // Model
  "Thinking": "Размышления модели (Thinking)",
  "Sampling": "Параметры сэмплинга (Температура, Top-P)",
  "Prompt": "Системные промпты",
  "Retry & Fallback": "Повторы и резервные модели",
  "Advisor": "Советник (Advisor)",
  "Prewalk": "Предварительный анализ (Prewalk)",
  "Vision": "Зрение и изображения (Vision)",

  // Interaction
  "Input": "Ввод и горячие клавиши",
  "Approvals": "Подтверждения действий",
  "Notifications": "Уведомления и звуки",
  "Speech": "Голос и озвучка",
  "Collab": "Совместная работа",
  "Magic Keywords": "Ключевые слова",
  "Startup & Updates": "Запуск и обновления",
  "Power (macOS)": "Энергосбережение",
  "Agent": "Поведение агента",
  "Git": "Интеграция с Git",

  // Context
  "General": "Основные настройки",
  "Compaction": "Сжатие контекста",
  "Rules (TTSR)": "Правила проекта (TTSR)",
  "Experimental": "Экспериментальные функции",

  // Memory
  "Auto-Learn": "Автообучение",
  "Mnemopi": "Долговременная память Mnemopi",
  "Hindsight": "Память Hindsight",

  // Files
  "Editing": "Редактирование файлов",
  "Reading": "Чтение файлов",
  "Read Summaries": "Сводки файлов",
  "LSP": "Языковые серверы (LSP)",

  // Shell
  "Bash": "Выполнение команд Bash",
  "Eval & Runtimes": "Среды выполнения (Eval / Runtime)",

  // Tools
  "Available Tools": "Доступные инструменты",
  "Todos": "Список задач (Todos)",
  "Grep & Browser": "Поиск (Grep) и Браузер",
  "Computer": "Управление компьютером",
  "GitHub": "Интеграция с GitHub",
  "Output Limits": "Лимиты вывода",
  "Execution": "Выполнение",
  "Discovery & MCP": "Обнаружение и MCP",
  "Extensions": "Расширения",
  "Developer": "Для разработчиков",

  // Tasks
  "Modes": "Режимы работы",
  "Subagents": "Субагенты",
  "Isolation": "Изоляция и воркспейсы",
  "Commands & Skills": "Команды и навыки",

  // Providers
  "Services": "Сервисы",
  "Fireworks": "Fireworks AI",
  "Tiny Model": "Компактная модель (Tiny)",
  "Protocol": "Сетевой протокол",
  "Timeouts": "Таймауты",
  "Privacy": "Конфиденциальность",
};

export const SETTINGS_FIELD_TRANSLATIONS: Record<string, { label?: string; description?: string }> = {
  "autoResume": {
    label: "Автовозобновление сессии",
    description: "Автоматически продолжать последнюю сессию при открытии текущей папки",
  },
  "defaultThinkingLevel": {
    label: "Уровень размышлений по умолчанию",
    description: "Начальный уровень рассуждений модели (off, minimal, low, medium, high, max)",
  },
  "temperature": {
    label: "Температура сэмплинга",
    description: "Креативность ответов модели (0.0 — строгие ответы, 1.0 — творческие)",
  },
  "topP": {
    label: "Top-P (Nucleus Sampling)",
    description: "Порог вероятностной выборки токенов",
  },
  "features.unexpectedStopDetection": {
    label: "Обнаружение внезапных остановок",
    description: "Предупреждать, если агент прервал работу без завершения задачи",
  },
  "notifications.sound": {
    label: "Звуковые уведомления",
    description: "Воспроизводить звуковой сигнал по завершении хода агента",
  },
  "notifications.system": {
    label: "Системные уведомления",
    description: "Показывать системные push-уведомления операционной системы",
  },
  "compaction.threshold": {
    label: "Порог сжатия контекста",
    description: "Процент заполнения контекста для запуска автосжатия",
  },
  "lsp.enabled": {
    label: "Включить LSP серверы",
    description: "Использовать языковые серверы для поиска определений, ссылок и диагностики ошибок",
  },
  "bash.timeout": {
    label: "Таймаут выполнения команд (сек)",
    description: "Максимальное время выполнения команды bash до прерывания",
  },
  "tools.browser.enabled": {
    label: "Включить инструмент Браузер",
    description: "Разрешить агенту просматривать веб-страницы через Chromium",
  },
  "tasks.maxSubagents": {
    label: "Максимум параллельных субагентов",
    description: "Ограничение на количество одновременно работающих субагентов",
  },
  "memory.backend": {
    label: "Движок памяти",
    description: "Выбор бекенда долгосрочной памяти (mnemopi, hindsight, none)",
  },
  "retry.maxAttempts": {
    label: "Количество повторов при ошибках",
    description: "Сколько раз агент пробует повторить запрос к API при сетевых ошибках",
  },
  "retry.usageAwareFallback": {
    label: "Резервная модель при лимитах",
    description: "Автоматически переключаться на резервную модель при исчерпании лимитов текущей",
  },
  "advisor.enabled": {
    label: "Включить советника (Advisor)",
    description: "Подключать вторую модель для верификации и подсказок основному агенту",
  },
  "plan.enabled": {
    label: "Режим планирования (Plan Mode)",
    description: "Агент сначала составляет план, а затем приступает к изменениям",
  },
};

/**
 * Переводит заголовок вкладки.
 */
export function translateTabLabel(tabId: string, defaultLabel?: string): string {
  return SETTINGS_TAB_TRANSLATIONS[tabId] || defaultLabel || tabId;
}

/**
 * Переводит название группы.
 */
export function translateGroupTitle(group: string): string {
  return SETTINGS_GROUP_TRANSLATIONS[group] || group;
}

/**
 * Переводит поле настроек.
 */
export function translateField(path: string, defaultLabel: string, defaultDesc?: string): { label: string; description?: string } {
  const trans = SETTINGS_FIELD_TRANSLATIONS[path];
  if (trans) {
    return {
      label: trans.label || defaultLabel,
      description: trans.description || defaultDesc,
    };
  }
  return { label: defaultLabel, description: defaultDesc };
}
