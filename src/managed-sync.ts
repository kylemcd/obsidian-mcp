import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";

import type { ManagedSyncConfig } from "./config.js";

export type ManagedSyncState =
  | "disabled"
  | "starting"
  | "setup_failed"
  | "connecting"
  | "running"
  | "disconnected"
  | "stale"
  | "stopped";

export type ManagedSyncSnapshot = {
  enabled: boolean;
  requiredForReady: boolean;
  state: ManagedSyncState;
  running: boolean;
  configured: boolean;
  ready: boolean;
  pid?: number;
  restartCount: number;
  lastOutputAt?: string;
  lastSyncAt?: string;
  lastExitCode?: number | null;
  lastExitSignal?: NodeJS.Signals | null;
  lastError?: string;
};

export class ManagedSync {
  private child?: ChildProcess;
  private state: ManagedSyncState;
  private configured = false;
  private stopping = false;
  private restartTimer?: NodeJS.Timeout;
  private staleTimer?: NodeJS.Timeout;
  private runtimeTimer?: NodeJS.Timeout;
  private lastOutputAt?: number;
  private lastSyncAt?: number;
  private lastExitCode?: number | null;
  private lastExitSignal?: NodeJS.Signals | null;
  private lastError?: string;
  private restartCount = 0;

  constructor(
    private readonly config: ManagedSyncConfig,
    private readonly vaultPath: string
  ) {
    this.state = config.enabled ? "starting" : "disabled";
  }

  start() {
    if (!this.config.enabled) {
      this.state = "disabled";
      return;
    }

    void this.prepareAndStart();
  }

  async stop() {
    this.stopping = true;
    this.clearTimers();

    if (!this.child || this.child.killed || this.child.exitCode != null) {
      this.state = "stopped";
      return;
    }

    await new Promise<void>((resolve) => {
      const child = this.child;
      if (!child) {
        resolve();
        return;
      }

      const killTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5_000);

      child.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });

      child.kill("SIGTERM");
    });

    this.state = "stopped";
  }

  snapshot(): ManagedSyncSnapshot {
    return {
      enabled: this.config.enabled,
      requiredForReady: this.config.requiredForReady,
      state: this.state,
      running: Boolean(this.child && !this.child.killed && this.child.exitCode == null),
      configured: this.configured,
      ready: this.isReady(),
      pid: this.child?.pid,
      restartCount: this.restartCount,
      lastOutputAt: iso(this.lastOutputAt),
      lastSyncAt: iso(this.lastSyncAt),
      lastExitCode: this.lastExitCode,
      lastExitSignal: this.lastExitSignal,
      lastError: this.lastError
    };
  }

  isReady(): boolean {
    if (!this.config.enabled || !this.config.requiredForReady) return true;
    if (!this.configured || !this.lastSyncAt) return false;
    if (this.state !== "running") return false;
    return Date.now() - this.lastOutputAtOrStart() <= this.config.staleAfterMs;
  }

  private async prepareAndStart() {
    try {
      this.state = "starting";
      await fs.mkdir(this.vaultPath, { recursive: true });
      this.configured = await this.hasSyncConfiguration();

      if (!this.configured) {
        if (!this.config.autoSetup) {
          throw new Error(`Obsidian sync is not configured for ${this.vaultPath}; set SYNC_AUTO_SETUP=true or run sync-setup manually.`);
        }
        await this.runInitialSetup();
        this.configured = true;
      }

      this.startContinuousSync();
    } catch (error) {
      this.state = "setup_failed";
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error("managed_sync_setup_failed", this.lastError);
      this.scheduleRestart();
    }
  }

  private async hasSyncConfiguration(): Promise<boolean> {
    const result = await this.runCommand(["sync-status", "--path", this.vaultPath], 30_000);
    if (result.ok) {
      this.logCommandOutput("managed_sync_status", result.output);
    }
    return result.ok;
  }

  private async runInitialSetup() {
    if (!this.config.remoteVault) {
      throw new Error(
        "SYNC_ENABLED=true but Obsidian Sync is not configured. Set OBSIDIAN_REMOTE_VAULT, " +
          "or set SYNC_ENABLED=false to use an externally synced vault."
      );
    }

    const args = [
      "sync-setup",
      "--vault",
      this.config.remoteVault,
      "--path",
      this.vaultPath,
      "--device-name",
      this.config.deviceName
    ];

    if (this.config.syncPassword) {
      args.push("--password", this.config.syncPassword);
    }

    const result = await this.runCommand(args, 120_000);
    this.logCommandOutput("managed_sync_setup", result.output);
    if (!result.ok) {
      throw new Error("Obsidian sync-setup failed; verify OBSIDIAN_REMOTE_VAULT, OBSIDIAN_AUTH_TOKEN, and OBSIDIAN_SYNC_PASSWORD.");
    }
  }

  private startContinuousSync() {
    this.clearTimers();
    this.state = "connecting";
    this.lastError = undefined;
    this.lastOutputAt = Date.now();
    const child = spawn(this.config.command, ["sync", "--path", this.vaultPath, "--continuous"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;

    console.log("managed_sync_started", `pid=${child.pid}`, `vault=${this.vaultPath}`);

    child.stdout?.on("data", (chunk) => this.handleOutput("stdout", chunk));
    child.stderr?.on("data", (chunk) => this.handleOutput("stderr", chunk));
    child.on("error", (error) => {
      this.lastError = error.message;
      this.state = "setup_failed";
      console.error("managed_sync_process_error", error);
    });
    child.on("exit", (code, signal) => {
      this.lastExitCode = code;
      this.lastExitSignal = signal;
      this.child = undefined;
      this.clearTimers();

      if (this.stopping) return;

      this.state = "disconnected";
      this.lastError = `sync process exited with code=${code ?? "null"} signal=${signal ?? "null"}`;
      console.warn("managed_sync_exited", this.lastError);
      this.scheduleRestart();
    });

    this.staleTimer = setInterval(() => this.checkStale(), Math.min(this.config.staleAfterMs, 60_000));
    this.runtimeTimer = setTimeout(() => {
      void this.restart("runtime_max");
    }, this.config.runtimeMaxMs);
  }

  private handleOutput(stream: "stdout" | "stderr", chunk: Buffer) {
    this.lastOutputAt = Date.now();
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.observeSyncLine(trimmed);
      const level = stream === "stderr" ? "warn" : "log";
      console[level]("managed_sync", trimmed);
    }
  }

  private observeSyncLine(line: string) {
    if (line.includes("Connection successful")) {
      this.state = "connecting";
      return;
    }
    if (line.includes("Disconnected from server") || line.includes("Waiting to connect")) {
      this.state = "disconnected";
      return;
    }
    if (line.includes("Fully synced")) {
      this.state = "running";
      this.lastSyncAt = Date.now();
      return;
    }
    if (
      line.includes("Upload complete") ||
      line.includes("Downloaded ") ||
      line.includes("Accepted ") ||
      line.startsWith("Push: ")
    ) {
      this.state = "running";
    }
  }

  private checkStale() {
    if (this.stopping || !this.config.enabled) return;
    if (Date.now() - this.lastOutputAtOrStart() <= this.config.staleAfterMs) return;
    this.state = "stale";
    void this.restart("stale_output");
  }

  private async restart(reason: string) {
    if (this.stopping) return;
    this.restartCount += 1;
    console.warn("managed_sync_restarting", `reason=${reason}`, `restartCount=${this.restartCount}`);
    this.clearTimers();

    const child = this.child;
    if (child && !child.killed && child.exitCode == null) {
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 5_000);
        child.once("exit", () => {
          clearTimeout(killTimer);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }

    this.scheduleRestart();
  }

  private scheduleRestart() {
    if (this.stopping) return;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.prepareAndStart();
    }, this.config.restartDelayMs);
  }

  private clearTimers() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    if (this.runtimeTimer) clearTimeout(this.runtimeTimer);
    this.restartTimer = undefined;
    this.staleTimer = undefined;
    this.runtimeTimer = undefined;
  }

  private async runCommand(args: string[], timeoutMs: number): Promise<{ ok: boolean; output: string }> {
    return new Promise((resolve) => {
      const child = spawn(this.config.command, args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let output = "";
      const timeout = setTimeout(() => {
        output += "\ncommand timed out";
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        resolve({ ok: false, output: error.message });
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        resolve({ ok: code === 0, output });
      });
    });
  }

  private logCommandOutput(prefix: string, output: string) {
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) console.log(prefix, trimmed);
    }
  }

  private lastOutputAtOrStart(): number {
    return this.lastOutputAt ?? 0;
  }
}

function iso(value: number | undefined): string | undefined {
  return value == null ? undefined : new Date(value).toISOString();
}
