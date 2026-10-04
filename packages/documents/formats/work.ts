// coordinator 쪽 runner client. 호출마다 프로세스를 띄우고 deadline에 죽인다.
import { err, ok, type Result } from "../../base/mod.ts";
import type { LophnError } from "../../base/mod.ts";
import {
  GUEST_CALL_TIMEOUT_MS,
  RUNNER_CONCURRENCY,
  RUNNER_HEAP_MIB,
} from "./guest/contract.ts";
import {
  readMessage,
  type RunnerRequest,
  type RunnerResponse,
  writeMessage,
} from "./runner/protocol.ts";

const RUNNER = new URL("./runner/main.ts", import.meta.url);

// runner가 읽는 내장 wasm. quickjs-emscripten specifier resolve로 Deno npm cache의
// @jitl/quickjs-wasmfile-release-sync를 찾는다. cache 위치를 새로 두지 않는다.
export function runnerWasmPath(): string {
  const resolved = import.meta.resolve("quickjs-emscripten");
  const match = resolved.match(
    /^(file:\/\/\/.+\/npm\/registry\.npmjs\.org\/)quickjs-emscripten(\/[^/]+)\/dist\//,
  );
  if (!match) {
    throw new Error("quickjs-emscripten cache layout is not recognized");
  }
  return decodeURIComponent(
    `${match[1]}@jitl/quickjs-wasmfile-release-sync${
      match[2]
    }/dist/emscripten-module.wasm`,
  ).slice("file://".length);
}

export type FormatRunFailure = "missing_module" | "runner_failed" | "rejected";

export type FormatRun =
  | { ok: true; output: unknown }
  | { ok: false; failure: FormatRunFailure; detail: string };

type Waiter = {
  limit: number;
  resume: () => void;
};

type Slot = {
  active: number;
  waiters: Waiter[];
};

function createSlot(): Slot {
  return { active: 0, waiters: [] };
}

async function acquire(slot: Slot, limit: number): Promise<void> {
  if (slot.active < limit) {
    slot.active += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    slot.waiters.push({
      limit,
      resume: () => {
        slot.active += 1;
        resolve();
      },
    });
  });
}

function release(slot: Slot): void {
  slot.active -= 1;
  const ready = slot.waiters.findIndex((waiter) => slot.active < waiter.limit);
  if (ready === -1) return;
  const [next] = slot.waiters.splice(ready, 1);
  next?.resume();
}

const slots = createSlot();

export type RunnerClientOptions = {
  // 테스트가 deadline·동시성·heap을 줄여 끼운다.
  timeoutMs?: number;
  concurrency?: number;
  heapMib?: number;
  // 테스트가 runner 대신 넣는 실행. 없으면 Deno subprocess.
  spawn?: (request: RunnerRequest, timeoutMs: number) => Promise<FormatRun>;
};

function runnerFlags(heapMib: number): string[] {
  // 읽기 권한은 runner entry와 내장 QuickJS wasm 파일로만 좁힌다(planning documents T4).
  return [
    "run",
    "--frozen",
    "--no-prompt",
    `--allow-read=${RUNNER.pathname},${runnerWasmPath()}`,
    `--v8-flags=--max-old-space-size=${heapMib}`,
    RUNNER.pathname,
  ];
}

async function spawnRunner(
  request: RunnerRequest,
  timeoutMs: number,
  heapMib: number,
): Promise<FormatRun> {
  const child = new Deno.Command(Deno.execPath(), {
    args: runnerFlags(heapMib),
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
    clearEnv: true,
  }).spawn();
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    try {
      child.kill("SIGKILL");
    } catch {
      // 이미 끝난 프로세스.
    }
  }, timeoutMs);
  try {
    const writer = child.stdin.getWriter();
    const reader = child.stdout.getReader();
    await writeMessage(async (bytes) => {
      await writer.write(bytes);
      return bytes.length;
    }, request);
    await writer.close();
    let pending = new Uint8Array();
    const message = await readMessage(async (buffer) => {
      while (pending.length === 0) {
        const next = await reader.read();
        if (next.done) return null;
        pending = next.value;
      }
      const take = Math.min(buffer.length, pending.length);
      buffer.set(pending.subarray(0, take));
      pending = pending.subarray(take);
      return take;
    });
    const status = await child.status;
    if (!status.success && killed) {
      return {
        ok: false,
        failure: "runner_failed",
        detail: "runner deadline killed",
      };
    }
    return fromResponse(message);
  } catch (error) {
    if (!killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        // 이미 끝난 프로세스.
      }
    }
    return {
      ok: false,
      failure: "runner_failed",
      detail: killed
        ? "runner deadline killed"
        : error instanceof Error
        ? error.message
        : "runner crashed",
    };
  } finally {
    clearTimeout(timer);
  }
}

function fromResponse(message: unknown): FormatRun {
  if (typeof message !== "object" || message === null || !("ok" in message)) {
    return {
      ok: false,
      failure: "runner_failed",
      detail: "empty runner response",
    };
  }
  const response = message as RunnerResponse;
  if (response.ok) return { ok: true, output: response.output };
  if (response.reason === "module_mismatch") {
    return { ok: false, failure: "missing_module", detail: response.detail };
  }
  return { ok: false, failure: "runner_failed", detail: response.detail };
}

export async function runFormat(
  request: RunnerRequest,
  options: RunnerClientOptions = {},
): Promise<FormatRun> {
  if (request.bundle.length === 0) {
    return {
      ok: false,
      failure: "missing_module",
      detail: "module bundle is missing",
    };
  }
  const limit = options.concurrency ?? RUNNER_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? GUEST_CALL_TIMEOUT_MS;
  await acquire(slots, limit);
  try {
    const spawn = options.spawn ??
      ((item, timeout) =>
        spawnRunner(item, timeout, options.heapMib ?? RUNNER_HEAP_MIB));
    return await spawn(request, timeoutMs);
  } finally {
    release(slots);
  }
}

export function unavailable(detail: string): Result<never, LophnError> {
  return err({ code: "unavailable", message: detail });
}

export function runResult(result: FormatRun): Result<unknown, LophnError> {
  if (!result.ok) return unavailable(result.detail);
  return ok(result.output);
}
