// Layer 1: NDJSON JSON-RPC 2.0 transport over stdio for ACP child processes.
// Enforces 64 MiB frame isolation, partial wire-read activity notification,
// per-method request timeouts with $/cancel_request, stderr tail redaction,
// and graceful process-group stop sequence.

import { redactCredentials } from "../../../base/telemetry/log.ts";
import type { CliProcess, CliSpawn } from "../../../protocol/acp/mod.ts";

export type Json = Record<string, unknown>;

export type JsonRpcReply =
  | { ok: true; data: Json }
  | { ok: false; error: string; code?: number; timedOut?: boolean };

export type JsonRpcTransportOptions = {
  /** Human-readable process label for error messages (e.g. "agy"). */
  label: string;
  spawn: CliSpawn;
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Max single NDJSON line length in UTF-16 code units / bytes (default 64 MiB). */
  maxFrameBytes?: number;
  /** Default timeout in ms for timed control requests (default 30_000). */
  requestTimeoutMs?: number;
  /** Methods exempt from request timeout (default: session/prompt, session/load). */
  untimedMethods?: ReadonlySet<string>;
  /** Stop phase timeouts (injectable for fast tests). */
  stopTimeouts?: {
    cancelMs?: number;
    closeMs?: number;
    exitMs?: number;
  };
  /** Fired on EVERY raw stdout chunk (including partial bytes before newline). */
  onWireActivity?: () => void;
  /** Incoming JSON-RPC notification (method without id). */
  onNotification?: (method: string, params: Json) => void;
  /** Incoming JSON-RPC request from agent (method with id). */
  onAgentRequest?: (id: string | number, method: string, params: Json) => void;
  /** Once-per-session warning when a frame is oversized, malformed, or handler throws. */
  onWarning?: (message: string) => void;
  /** Fired when the child process exits. */
  onExit?: (code: number | null, stderrTail: string) => void;
};

export type JsonRpcTransport = {
  readonly pid: number | undefined;
  readonly exited: boolean;
  readonly gone: Promise<void>;
  stderrTail(): string;
  request(
    method: string,
    params: Json,
    options?: { timeoutMs?: number; untimed?: boolean },
  ): Promise<JsonRpcReply>;
  notify(method: string, params: Json): void;
  respond(id: string | number, result: Json): void;
  respondError(id: string | number, code: number, message: string): void;
  /**
   * Graceful shutdown:
   * 1. If active turn, send session/cancel and wait up to cancelMs (3s).
   * 2. If sessionId, send session/close and wait up to closeMs (1s).
   * 3. Close stdin EOF (proc.end()).
   * 4. Wait / kill process group (proc.kill()).
   */
  stop(options?: {
    sessionId?: string | null;
    isTurnActive?: () => boolean;
    cancelTurn?: () => void;
  }): Promise<void>;
  /** Immediate kill without graceful RPC handshake (e.g. startup failure). */
  kill(): void;
};

export const DEFAULT_MAX_FRAME_BYTES = 64 * 1024 * 1024;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_STOP_CANCEL_MS = 3_000;
export const DEFAULT_STOP_CLOSE_MS = 1_000;
export const DEFAULT_STOP_EXIT_MS = 3_000;

export const DEFAULT_UNTIMED_METHODS: ReadonlySet<string> = new Set([
  "session/prompt",
  "session/load",
]);

const STDERR_TAIL_LIMIT = 1000;

const isRec = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const rec = (value: unknown): Json => (isRec(value) ? value : {});
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const errMsg = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createJsonRpcTransport(
  options: JsonRpcTransportOptions,
): JsonRpcTransport {
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  const defaultTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const untimed = options.untimedMethods ?? DEFAULT_UNTIMED_METHODS;
  const cancelMs = options.stopTimeouts?.cancelMs ?? DEFAULT_STOP_CANCEL_MS;
  const closeMs = options.stopTimeouts?.closeMs ?? DEFAULT_STOP_CLOSE_MS;
  const exitMs = options.stopTimeouts?.exitMs ?? DEFAULT_STOP_EXIT_MS;

  const spawnOpts: { cwd?: string; env?: Record<string, string> } = {};
  if (options.cwd !== undefined) spawnOpts.cwd = options.cwd;
  if (options.env !== undefined) spawnOpts.env = options.env;

  const proc: CliProcess = options.spawn(
    options.command,
    options.args,
    spawnOpts,
  );

  let exited = false;
  let stderrBuf = "";
  let counter = 0;
  let warnedUnreadable = false;
  let buffer = "";
  // While skipping an oversized frame, discard incoming chunks until the next newline.
  let skippingOversized = false;

  const waiting = new Map<number, (reply: JsonRpcReply) => void>();

  let markGone: () => void = () => {};
  const gone = new Promise<void>((resolve) => {
    markGone = resolve;
  });

  const redactedStderrTail = (): string => {
    const trimmed = stderrBuf.trim();
    return trimmed === "" ? "" : redactCredentials(trimmed);
  };

  function warnOnce(why: string): void {
    if (warnedUnreadable) return;
    warnedUnreadable = true;
    options.onWarning?.(
      `${options.label} sent a message lophn could not read: ${why}`,
    );
  }

  function writeRaw(body: Json): void {
    if (exited) return;
    proc.write(`${JSON.stringify({ jsonrpc: "2.0", ...body })}\n`);
  }

  function handleMessage(msg: Json): void {
    if (typeof msg.method === "string") {
      if (msg.id === undefined) {
        options.onNotification?.(msg.method, rec(msg.params));
      } else {
        options.onAgentRequest?.(
          msg.id as string | number,
          msg.method,
          rec(msg.params),
        );
      }
      return;
    }
    if (typeof msg.id !== "number") return;
    const resolve = waiting.get(msg.id);
    if (resolve === undefined) return;
    waiting.delete(msg.id);
    if (msg.error !== undefined) {
      const error = rec(msg.error);
      resolve({
        ok: false,
        error: redactCredentials(
          str(error.message) || `${options.label} failed`,
        ),
        ...(typeof error.code === "number" ? { code: error.code } : {}),
      });
    } else {
      resolve({ ok: true, data: rec(msg.result) });
    }
  }

  function processLine(line: string): void {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      warnOnce("a line is not JSON");
      return;
    }
    if (!isRec(parsed)) {
      warnOnce("it is not an object");
      return;
    }
    try {
      handleMessage(parsed);
    } catch (error) {
      warnOnce(errMsg(error));
    }
  }

  proc.onStderr((text) => {
    stderrBuf = (stderrBuf + text).slice(-STDERR_TAIL_LIMIT);
  });

  proc.onStdout((chunk) => {
    if (chunk.length > 0) {
      options.onWireActivity?.();
    }
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (skippingOversized) {
        skippingOversized = false;
      } else if (line.length > maxFrameBytes) {
        warnOnce("a line exceeds the 64 MiB frame limit");
      } else {
        processLine(line);
      }
    }
    if (buffer.length > maxFrameBytes) {
      buffer = "";
      skippingOversized = true;
      warnOnce("a line exceeds the 64 MiB frame limit");
    }
  });

  proc.onExit((code) => {
    if (exited) return;
    exited = true;
    const pending = [...waiting.values()];
    waiting.clear();
    for (const resolve of pending) {
      resolve({ ok: false, error: `${options.label} exited` });
    }
    markGone();
    options.onExit?.(code, redactedStderrTail());
  });

  function request(
    method: string,
    params: Json,
    reqOpts?: { timeoutMs?: number; untimed?: boolean },
  ): Promise<JsonRpcReply> {
    if (exited) {
      return Promise.resolve({ ok: false, error: `${options.label} exited` });
    }
    const id = ++counter;
    const isUntimed = reqOpts?.untimed ?? untimed.has(method);
    const timeoutMs = reqOpts?.timeoutMs ?? defaultTimeoutMs;
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      waiting.set(id, (reply) => {
        if (timer !== undefined) clearTimeout(timer);
        resolve(reply);
      });
      if (!isUntimed && timeoutMs > 0) {
        timer = setTimeout(() => {
          if (!waiting.delete(id)) return;
          // Inform the server the timed-out request is abandoned.
          writeRaw({ method: "$/cancel_request", params: { requestId: id } });
          resolve({
            ok: false,
            error: `${options.label} did not answer ${method} in ${Math.round(timeoutMs / 1000)} seconds.`,
            timedOut: true,
          });
        }, timeoutMs);
        timer.unref?.();
      }
      writeRaw({ id, method, params });
    });
  }

  let stopping: Promise<void> | null = null;

  function stop(stopOpts?: {
    sessionId?: string | null;
    isTurnActive?: () => boolean;
    cancelTurn?: () => void;
  }): Promise<void> {
    stopping ??= (async () => {
      const sid = stopOpts?.sessionId ?? null;
      // 1. Cancel running turn and wait up to cancelMs (3s).
      if (!exited && stopOpts?.isTurnActive?.()) {
        if (stopOpts.cancelTurn) {
          stopOpts.cancelTurn();
        } else if (sid !== null && sid !== "") {
          writeRaw({ method: "session/cancel", params: { sessionId: sid } });
        }
        await Promise.race([
          new Promise<void>((resolve) => {
            const poll = setInterval(() => {
              if (!stopOpts.isTurnActive?.() || exited) {
                clearInterval(poll);
                clearTimeout(limit);
                resolve();
              }
            }, 50);
            const limit = setTimeout(() => {
              clearInterval(poll);
              resolve();
            }, cancelMs);
          }),
          gone,
        ]);
      }

      // 2. Send session/close and wait up to closeMs (1s).
      if (!exited && sid !== null && sid !== "") {
        await Promise.race([
          request(
            "session/close",
            { sessionId: sid },
            { timeoutMs: closeMs, untimed: false },
          ).then(() => undefined),
          gone,
        ]);
      }

      // 3. Close stdin EOF and wait / escalate to kill.
      if (!exited) {
        proc.end();
        const killTimer = setTimeout(() => {
          if (!exited) proc.kill();
        }, exitMs);
        await Promise.race([
          gone,
          new Promise<void>((resolve) => setTimeout(resolve, exitMs * 2)),
        ]);
        clearTimeout(killTimer);
      }
    })();
    return stopping;
  }

  return {
    get pid() {
      return proc.pid;
    },
    get exited() {
      return exited;
    },
    gone,
    stderrTail: redactedStderrTail,
    request,
    notify(method, params) {
      writeRaw({ method, params });
    },
    respond(id, result) {
      writeRaw({ id, result });
    },
    respondError(id, code, message) {
      writeRaw({ id, error: { code, message } });
    },
    stop,
    kill() {
      proc.end();
      proc.kill();
    },
  };
}
