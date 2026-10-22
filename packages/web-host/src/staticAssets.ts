import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const CONTENT_TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
};

const acceptedEncodings = (header: string): string[] => {
  const weights = new Map<string, number>();
  for (const part of header.toLowerCase().split(',')) {
    const [name, ...parameters] = part.trim().split(';');
    const quality = parameters.map((parameter) => parameter.trim()).find((parameter) => parameter.startsWith('q='));
    const value = quality ? Number(quality.slice(2)) : 1;
    weights.set(name, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0);
  }
  const weight = (encoding: string): number => weights.get(encoding) ?? weights.get('*') ?? 0;
  return ['br', 'gzip'].filter((encoding) => weight(encoding) > 0).sort((a, b) => weight(b) - weight(a));
};

/** Serves build-time compressed assets without doing compression on the request path. */
export async function serveCompressedAsset(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  // Generated assets live directly under assets/. Restricting the alphabet also
  // rejects encoded separators and traversal before touching the filesystem.
  const match = /^\/assets\/([\w-][\w.-]*\.(js|css|json|svg))$/.exec(pathname);
  if (!match) return false;
  res.setHeader('Vary', 'Accept-Encoding');
  // serve-handler already implements identity byte ranges and their validators.
  if (req.headers.range) return false;
  const originalPath = join(staticDir, 'assets', match[1]);
  const original = await stat(originalPath).catch((): null => null);
  if (!original?.isFile()) return false;
  for (const encoding of acceptedEncodings(req.headers['accept-encoding'] ?? '')) {
    const compressedPath = `${originalPath}.${encoding === 'br' ? 'br' : 'gz'}`;
    const compressed = await stat(compressedPath).catch((): null => null);
    if (!compressed?.isFile()) continue;
    const etag = `W/"${compressed.size.toString(16)}-${compressed.mtimeMs.toString(16)}-${encoding}"`;
    res.setHeader('Content-Type', CONTENT_TYPES[match[2]]);
    res.setHeader('Content-Encoding', encoding);
    res.setHeader('ETag', etag);
    res.setHeader(
      'Cache-Control',
      /-[\w-]{8,}\./.test(match[1]) ? 'public, max-age=31536000, immutable' : 'public, max-age=0'
    );
    const validators = req.headers['if-none-match']?.split(',').map((value) => value.trim());
    if (validators?.includes(etag) || validators?.includes('*')) {
      res.writeHead(304).end();
      return true;
    }
    res.setHeader('Content-Length', compressed.size);
    if (req.method === 'HEAD') res.end();
    else await pipeline(createReadStream(compressedPath), res);
    return true;
  }
  return false;
}
