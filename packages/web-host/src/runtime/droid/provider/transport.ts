import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { StringFramedDroidClientTransport } from '@factory/droid-sdk/node';

const LIMIT = 32 * 1024 * 1024;

/** Bounded NDJSON transport. Raw stdout/stderr are deliberately never logged. */
export class DroidTransport implements StringFramedDroidClientTransport {
  private message?: (frame: string) => void;
  private error?: (error: Error) => void;
  private pending: string[] = [];
  private bytes = 0;
  private partial = '';
  private failure?: Error;
  private closing?: Promise<void>;
  private exited = false;
  private notified = false;
  private readonly closed: Promise<void>;
  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.closed = new Promise((resolve) =>
      child.once('close', () => {
        this.exited = true;
        resolve();
        this.fail();
      })
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.receive(chunk));
    child.stderr.resume();
    for (const stream of [child.stdout, child.stderr, child.stdin]) stream.on('error', () => this.fail());
    child.on('error', () => this.fail());
  }
  static async start(
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv }
  ): Promise<DroidTransport> {
    const child = spawn(command, args, { ...options, stdio: 'pipe', windowsHide: true });
    const transport = new DroidTransport(child);
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => reject(new Error('SPECIALIST_CLI_UNAVAILABLE')));
    });
    return transport;
  }
  get isConnected(): boolean {
    return !this.exited && !this.closing && !this.failure;
  }
  async send(frame: string): Promise<void> {
    if (!this.isConnected) throw new Error('SPECIALIST_TRANSPORT_CLOSED');
    // SDK 0.9.1 installs response handlers after send resolves: never await pipe backpressure.
    this.child.stdin.write(frame.endsWith('\n') ? frame : `${frame}\n`, (error) => {
      if (error) this.fail();
    });
  }
  onMessage(handler: (frame: string) => void): void {
    this.message = handler;
    for (const frame of this.pending.splice(0)) this.deliver(frame);
    this.bytes = 0;
  }
  onError(handler: (error: Error) => void): void {
    this.error = handler;
    this.notify();
  }
  private notify(): void {
    if (this.failure && this.error && !this.notified) {
      this.notified = true;
      this.error(this.failure);
    }
  }
  private fail(): void {
    if (this.closing) return;
    this.failure ??= new Error('SPECIALIST_TRANSPORT_CLOSED');
    void this.close();
  }
  private receive(chunk: string): void {
    if (this.closing) return;
    this.partial += chunk;
    let newline: number;
    while ((newline = this.partial.indexOf('\n')) >= 0) {
      const frame = this.partial.slice(0, newline).replace(/\r$/, '');
      this.partial = this.partial.slice(newline + 1);
      if (!frame.trim()) continue;
      if (Buffer.byteLength(frame) > LIMIT) {
        this.fail();
        return;
      }
      if (this.message) this.deliver(frame);
      else {
        this.pending.push(frame);
        this.bytes += Buffer.byteLength(frame);
      }
      if (this.bytes > LIMIT) {
        this.fail();
        return;
      }
    }
    if (Buffer.byteLength(this.partial) > LIMIT) this.fail();
  }
  private deliver(frame: string): void {
    try {
      this.message?.(frame);
    } catch {
      this.fail();
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.failure ??= new Error('SPECIALIST_TRANSPORT_CLOSED');
    this.closing = Promise.resolve().then(async () => {
      this.child.stdin.end();
      const term = setTimeout(() => {
        if (!this.exited) this.child.kill('SIGTERM');
      }, 200);
      const kill = setTimeout(() => {
        if (!this.exited) this.child.kill('SIGKILL');
      }, 1200);
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.closed,
          new Promise<void>((resolve) => {
            deadline = setTimeout(resolve, 2500);
          }),
        ]);
      } finally {
        clearTimeout(term);
        clearTimeout(kill);
        clearTimeout(deadline);
        this.child.stdin.destroy();
        this.child.stdout.destroy();
        this.child.stderr.destroy();
      }
      this.pending = [];
      this.partial = '';
    });
    this.notify();
    return this.closing;
  }
}
