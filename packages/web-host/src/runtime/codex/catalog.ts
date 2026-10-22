import { stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CodexAuthService } from '../codexAuth.js';
import type { CliModelCatalog } from '../../../../desktop/src/common/types/platform/cliModels.js';

/** Short-lived discovery processes always resolve the currently active CLI launcher. */
export class CodexModelCatalog {
  private cached?: { key: string; expires: number; promise: Promise<CliModelCatalog> };
  private clients = new Set<CodexAuthService>();
  private generation = 0;
  constructor(private readonly createClient = () => new CodexAuthService()) {}

  invalidate(): void {
    this.generation += 1;
    this.cached = undefined;
  }

  async get(version: string, accountEpoch: number, refresh = false): Promise<CliModelCatalog> {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const credentials = await stat(path.join(home, 'auth.json')).catch((): undefined => undefined);
    const key = `${home}:${version}:${accountEpoch}:${credentials?.mtimeMs}:${credentials?.size}:${this.generation}`;
    if (!refresh && this.cached?.key === key && this.cached.expires > Date.now()) return this.cached.promise;
    const client = this.createClient();
    this.clients.add(client);
    const promise = client
      .models()
      .then((models) => ({ models, version, fetchedAt: new Date().toISOString() }))
      .finally(() => {
        client.close();
        this.clients.delete(client);
      });
    this.cached = { key, expires: Date.now() + 60000, promise };
    void promise.catch(() => {
      if (this.cached?.promise === promise) this.cached = undefined;
    });
    return promise;
  }

  close(): void {
    this.invalidate();
    for (const client of this.clients) client.close();
    this.clients.clear();
  }
}
