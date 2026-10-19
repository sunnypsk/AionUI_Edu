import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALE_DIR = path.resolve(__dirname, '../../../packages/desktop/src/renderer/services/i18n/locales/zh-TW');

/** Colloquial Cantonese markers that must not appear in teacher-facing zh-TW copy. */
const COLLOQUIAL = /[嘅呢咗喺冇]|交返|同互動/;
/** Internal/technical terms that teachers should not see. */
const INTERNAL_TERMS = ['Docker', ' task', 'process'];

/**
 * Keys allowed to bypass the check. Keep this small; each entry needs a reason.
 * Format: `<file>.<dotted.key.path>`.
 */
const ALLOW_LIST = new Set<string>([]);

const collect = (value: unknown, prefix: string, out: Array<[string, string]>): void => {
  if (typeof value === 'string') {
    out.push([prefix, value]);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, prefix ? `${prefix}.${k}` : k, out);
  }
};

const entries: Array<[string, string]> = [];
for (const file of readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.json'))) {
  const json = JSON.parse(readFileSync(path.join(LOCALE_DIR, file), 'utf8'));
  collect(json, file.replace(/\.json$/, ''), entries);
}

describe('zh-TW teacher-facing register', () => {
  const checked = entries.filter(([key]) => !ALLOW_LIST.has(key));

  it('has no colloquial Cantonese markers', () => {
    const offenders = checked.filter(([, v]) => COLLOQUIAL.test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(offenders).toEqual([]);
  });

  it('has no internal technical terms', () => {
    const offenders = checked
      .filter(([, v]) => INTERNAL_TERMS.some((t) => v.includes(t)))
      .map(([k, v]) => `${k}: ${v}`);
    expect(offenders).toEqual([]);
  });

  it('uses 網絡 rather than 網路', () => {
    const offenders = checked.filter(([, v]) => v.includes('網路')).map(([k, v]) => `${k}: ${v}`);
    expect(offenders).toEqual([]);
  });
});
