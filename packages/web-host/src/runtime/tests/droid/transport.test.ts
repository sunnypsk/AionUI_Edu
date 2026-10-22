import { afterEach, describe, expect, it } from 'vitest';
import { DroidTransport } from '../../droid/provider/transport.js';

describe('native Droid transport lifecycle', () => {
  let transport: DroidTransport | undefined;
  afterEach(async () => {
    await transport?.close();
  });
  const start = async (code: string): Promise<DroidTransport> => {
    transport = await DroidTransport.start(process.execPath, ['-e', code], { cwd: process.cwd(), env: process.env });
    return transport;
  };
  it('preserves split UTF-8 frames and drains queued frames after registration', async () => {
    const client = await start(
      `const frame = Buffer.from('{"text":"自然中文😀"}\\r\\n'); process.stdout.write(frame.subarray(0, 12)); setTimeout(() => process.stdout.write(frame.subarray(12)), 20); process.stdin.resume();`
    );
    const frame = await new Promise<string>((resolve) => client.onMessage(resolve));
    expect(JSON.parse(frame)).toEqual({ text: '自然中文😀' });
  });
  it('rejects sends after unexpected process exit without exposing stderr', async () => {
    const client = await start("process.stderr.write('private diagnostic'); setTimeout(() => process.exit(2), 20);");
    const error = await new Promise<Error>((resolve) => client.onError(resolve));
    expect(error.message).toBe('SPECIALIST_TRANSPORT_CLOSED');
    await expect(client.send('{}')).rejects.toThrow('SPECIALIST_TRANSPORT_CLOSED');
  });
  it('closes a process that ignores graceful shutdown and is safe to close twice', async () => {
    const client = await start("process.on('SIGTERM', () => {}); process.stdin.resume(); setInterval(() => {}, 1000);");
    await client.close();
    await client.close();
    expect(client.isConnected).toBe(false);
  });
});
