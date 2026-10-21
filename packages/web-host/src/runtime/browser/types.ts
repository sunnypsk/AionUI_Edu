import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';

const ownerId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const capabilityOwner = z.object({ userId: ownerId, conversationId: ownerId });

/** A bounded diagnostic; raw Chromium errors can contain URLs and private profile data. */
export class BrowserRuntimeError extends Error {
  readonly stage: 'profile' | 'launch' | 'capture' | 'selector';
  readonly details?: { matchCount: number };

  constructor(code: string, stage: BrowserRuntimeError['stage'], details?: { matchCount: number }) {
    super(code);
    this.stage = stage;
    this.details = details;
  }
}

/** Sign one backend-issued owner without exposing the signing key to the MCP child. */
export function signBrowserCapability(key: string, userId: string, conversationId: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, conversationId })).toString('base64url');
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}

/** Validate task-bound claims before looking up their authoritative backend owner. */
export function verifyBrowserCapability(key: string, capability: string): { userId: string; conversationId: string } {
  try {
    const [payload, signature, extra] = capability.split('.');
    if (!payload || !signature || extra) throw new Error('UNAUTHORIZED');
    const actual = Buffer.from(signature, 'base64url');
    const expected = createHmac('sha256', key).update(payload).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('UNAUTHORIZED');
    const claims = capabilityOwner.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (typeof claims.userId !== 'string' || typeof claims.conversationId !== 'string') throw new Error('UNAUTHORIZED');
    return { userId: claims.userId, conversationId: claims.conversationId };
  } catch {
    throw new Error('UNAUTHORIZED');
  }
}

const tabId = z.string().uuid();
const point = z.number().finite().min(0).max(4096);

export const browserActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inspect') }).strict(),
  z
    .object({
      kind: z.literal('resize'),
      tabId,
      width: z.number().int().min(320).max(1920),
      height: z.number().int().min(240).max(1600),
    })
    .strict(),
  z.object({ kind: z.literal('open'), url: z.string().max(4096).optional() }).strict(),
  z.object({ kind: z.literal('navigate'), tabId, url: z.string().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal('back'), tabId }).strict(),
  z.object({ kind: z.literal('forward'), tabId }).strict(),
  z.object({ kind: z.literal('reload'), tabId }).strict(),
  z.object({ kind: z.literal('select'), tabId }).strict(),
  z.object({ kind: z.literal('close'), tabId }).strict(),
  z.object({ kind: z.literal('snapshot'), tabId }).strict(),
  z
    .object({ kind: z.literal('click'), tabId, x: point, y: point, button: z.enum(['left', 'right']).optional() })
    .strict(),
  z.object({ kind: z.literal('move'), tabId, x: point, y: point }).strict(),
  z.object({ kind: z.literal('down'), tabId, x: point, y: point }).strict(),
  z.object({ kind: z.literal('up'), tabId, x: point, y: point }).strict(),
  z
    .object({
      kind: z.literal('scroll'),
      tabId,
      x: z.number().finite().min(-4000).max(4000),
      y: z.number().finite().min(-4000).max(4000),
    })
    .strict(),
  z.object({ kind: z.literal('text'), tabId, text: z.string().max(100000) }).strict(),
  z
    .object({
      kind: z.literal('key'),
      tabId,
      key: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[\w+ -]+$/),
    })
    .strict(),
  z
    .object({ kind: z.literal('fill'), tabId, selector: z.string().min(1).max(1000), text: z.string().max(100000) })
    .strict(),
  z.object({ kind: z.literal('clickElement'), tabId, selector: z.string().min(1).max(1000) }).strict(),
  z
    .object({
      kind: z.literal('upload'),
      tabId,
      selector: z.string().max(1000).optional(),
      name: z.string().min(1).max(200),
      mimeType: z
        .string()
        .max(150)
        .regex(/^[\w.+-]+\/[\w.+-]+$/)
        .optional(),
      base64: z.string().max(42_000_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('uploadPath'),
      tabId,
      selector: z.string().min(1).max(1000),
      path: z.string().min(1).max(4096),
    })
    .strict(),
  z.object({ kind: z.literal('dialog'), tabId, accept: z.boolean(), text: z.string().max(10000).optional() }).strict(),
]);

export type BrowserAction = z.infer<typeof browserActionSchema>;
export type BrowserOwner = { userId: string; conversationId: string; workspace: string };
export type BrowserControl = 'human' | 'agent';
export type BrowserPreferences = { agentEnabled: boolean };
export type BrowserState = {
  running: boolean;
  agentEnabled: boolean;
  control: BrowserControl;
  takingOver: boolean;
  revision: number;
  activeTabId: string | null;
  tabs: {
    id: string;
    title: string;
    url: string;
    /** The last top-level address requested for this tab; differs from `url` when the load failed. */
    requestedUrl?: string;
    fileChooser: boolean;
    dialog?: { type: string; message: string };
  }[];
  downloads: { id: string; name: string; state: 'saving' | 'ready' | 'failed' }[];
  viewport: { width: number; height: number };
};
export type BrowserResult = {
  state: BrowserState;
  image?: string;
  text?: string;
  frameError?: { code: 'BROWSER_TIMEOUT' | 'BROWSER_UNAVAILABLE'; stage: 'capture'; diagnostic_id: string };
  /** The request was issued, but reaching the navigation milestone is unconfirmed. Inspect before retrying. */
  navigationError?: { code: 'BROWSER_TIMEOUT'; stage: 'navigation'; diagnostic_id: string };
};

/** Only network pages are accepted; browser-internal and local-file schemes stay inaccessible. */
export function browserUrl(value = 'about:blank'): string {
  if (value === 'about:blank') return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('INVALID_BROWSER_URL');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('INVALID_BROWSER_URL');
  return url.href;
}
