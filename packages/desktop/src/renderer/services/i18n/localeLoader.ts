import { DEFAULT_LANGUAGE, mergeWithFallback, normalizeLanguageCode } from '@/common/config/i18n';
import enUS from './locales/en-US/index';

export const fallbackLocale: Record<string, unknown> = enUS;
const loaders: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  'zh-CN': () => import('./locales/zh-CN/index'),
  'zh-TW': () => import('./locales/zh-TW/index'),
  'ja-JP': () => import('./locales/ja-JP/index'),
  'ko-KR': () => import('./locales/ko-KR/index'),
  'tr-TR': () => import('./locales/tr-TR/index'),
  'ru-RU': () => import('./locales/ru-RU/index'),
  'uk-UA': () => import('./locales/uk-UA/index'),
  'pt-BR': () => import('./locales/pt-BR/index'),
  'de-DE': () => import('./locales/de-DE/index'),
  'es-ES': () => import('./locales/es-ES/index'),
  'fr-FR': () => import('./locales/fr-FR/index'),
  'fa-IR': () => import('./locales/fa-IR/index'),
};
const loaded = new Map<string, Record<string, unknown>>([[DEFAULT_LANGUAGE, fallbackLocale]]);
const pending = new Map<string, Promise<Record<string, unknown>>>();

/** Imports only the requested locale and shares concurrent loads. */
export const loadLocaleModules = (locale: string): Promise<Record<string, unknown>> => {
  const normalized = normalizeLanguageCode(locale);
  const cached = loaded.get(normalized);
  if (cached) return Promise.resolve(cached);
  const inFlight = pending.get(normalized);
  if (inFlight) return inFlight;
  const loader = loaders[normalized];
  if (!loader) return Promise.resolve(fallbackLocale);
  const request = loader()
    .then(({ default: translations }) => {
      const merged = mergeWithFallback(fallbackLocale, translations);
      loaded.set(normalized, merged);
      return merged;
    })
    .finally(() => pending.delete(normalized));
  pending.set(normalized, request);
  return request;
};

/** Clears resolved resources; module imports remain cached by the browser. */
export const clearTranslationCache = (): void => {
  loaded.clear();
  loaded.set(DEFAULT_LANGUAGE, fallbackLocale);
};

/** Returns resources that have completed loading. */
export const getLoadedLanguages = (): string[] => Array.from(loaded.keys());
