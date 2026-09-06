"use client";

export type Lang = "en" | "ru";

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    nav_workspace: "Workspace",
    nav_dashboard: "Dashboard",
    nav_plans: "Plans",
    nav_groups_joiner: "Groups & Joiner",
    nav_browse: "Browse Groups",
    nav_accounts: "Accounts",
    nav_campaigns: "Campaigns",
    nav_create: "Create Campaign",
    nav_history: "Campaigns",
    nav_templates: "Templates",
    nav_logs: "Delivery Logs",
    nav_rent: "Rent Accounts",
    nav_system: "System",
    nav_settings: "Settings",
    nav_help: "Help",
    nav_admin: "Admin",
    lang_label: "Language",
    lang_english: "English",
    lang_russian: "Русский",
  },
  ru: {
    nav_workspace: "Рабочая область",
    nav_dashboard: "Панель",
    nav_plans: "Тарифы",
    nav_groups_joiner: "Группы и вступление",
    nav_browse: "Каталог групп",
    nav_accounts: "Аккаунты",
    nav_campaigns: "Кампании",
    nav_create: "Создать кампанию",
    nav_history: "Кампании",
    nav_templates: "Шаблоны",
    nav_logs: "Логи доставки",
    nav_rent: "Аренда аккаунтов",
    nav_system: "Система",
    nav_settings: "Настройки",
    nav_help: "Помощь",
    nav_admin: "Админ",
    lang_label: "Язык",
    lang_english: "English",
    lang_russian: "Русский",
  },
};

export function t(lang: Lang, key: string): string {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
}
