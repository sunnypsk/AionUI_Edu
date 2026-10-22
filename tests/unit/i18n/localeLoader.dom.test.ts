import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@/common/config/i18n';
import { clearTranslationCache, getLoadedLanguages, loadLocaleModules } from '@/renderer/services/i18n/localeLoader';

vi.mock('@/common/config/configService', () => ({
  configService: { whenReady: () => new Promise(() => {}), get: vi.fn(), set: vi.fn() },
}));
vi.mock('@/common', () => ({
  ipcBridge: { systemSettings: { languageChanged: { on: vi.fn() }, changeLanguage: { invoke: vi.fn() } } },
}));

describe('locale loading', () => {
  beforeEach(() => clearTranslationCache());

  it('only loads the selected locale alongside the fallback', async () => {
    const resources = await loadLocaleModules('zh-HK');
    expect(getLoadedLanguages().sort()).toEqual(['en-US', 'zh-TW']);
    expect(resources.common).toMatchObject({ cancel: '取消' });
  });

  it('shares concurrent locale imports', async () => {
    const first = loadLocaleModules('ja');
    expect(loadLocaleModules('ja-JP')).toBe(first);
    await first;
  });

  it('falls back for unsupported language codes', async () => {
    expect((await loadLocaleModules('unsupported')).common).toMatchObject({ cancel: 'Cancel' });
    expect(getLoadedLanguages()).toEqual(['en-US']);
  });

  it.each(SUPPORTED_LANGUAGES)('can load packaged locale %s', async (language) => {
    const resources = await loadLocaleModules(language);
    expect(resources.common).toHaveProperty('cancel');
    expect(resources.conversation).toBeDefined();
  });

  it('finishes the hinted locale before the renderer readiness promise resolves', async () => {
    localStorage.setItem('i18nextLng', 'zh-TW');
    const { default: i18n, i18nReady } = await import('@/renderer/services/i18n');
    await i18nReady;
    expect(i18n.language).toBe('zh-TW');
    expect(i18n.t('common.cancel')).toBe('取消');
    localStorage.removeItem('i18nextLng');
  });
});
