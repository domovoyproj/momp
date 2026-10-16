import "@oh-my-pi/pi-coding-agent/config/all-settings";
import { all, lookup } from "@oh-my-pi/pi-coding-agent/config/registry";

export type SettingPath = string;
export const SETTINGS_SCHEMA = Object.fromEntries(all().map(setting => [setting.id, setting]));
export const getDefault = (path: string) => lookup(path)?.default;
export const getEnumValues = (path: string) => lookup(path)?.enumValues;
export const getType = (path: string) => lookup(path)?.type;
export const getUi = (path: string) => lookup(path)?.ui;
export const hasUi = (path: string) => Boolean(lookup(path)?.ui);
export const isCredential = (path: string) => lookup(path)?.isCredential === true;
export const getPathsForTab = (tab: string) => all().filter(setting => setting.ui?.tab === tab).map(setting => setting.id);
