import process from "node:process";
import type { Diagnostic } from "../../protocol/supervision/mod.ts";

// 처리 못한 예외로 죽는 process의 위치 ID. log record의 location은 아래 표의 표시 문자열이 된다.
export const CRASH_LOCATIONS = {
  daemon: "daemon-crash",
  agentRuntime: "agent-runtime-crash",
  agentRuntimeTurnStart: "agent-runtime-turn-start",
  appSupervisor: "app-supervisor-crash",
  shellMain: "shell-main-crash",
} as const;

// I/O worker catalog의 `locations`에 쓴다. 새 location은 `main/worker/io.ts` catalog의
// `components`에도 해당 component를 같이 올려야 한다(없으면 ingress가 조용히 버린다).
export const CRASH_LOCATION_NAMES: Readonly<Record<string, string>> = {
  [CRASH_LOCATIONS.daemon]: "packages/core/main/daemon/wiring/diagnostics.ts",
  [CRASH_LOCATIONS.agentRuntime]: "packages/core/main/agent-runtime/main.ts",
  [CRASH_LOCATIONS.agentRuntimeTurnStart]:
    "packages/core/main/agent-runtime/product-driver.ts",
  [CRASH_LOCATIONS.appSupervisor]: "packages/core/main/app-supervisor/main.ts",
  [CRASH_LOCATIONS.shellMain]: "packages/shell/main/desktop/wiring/crash.ts",
};

export function crashDiagnostic(input: {
  component: string;
  location: string;
  at: string;
}): Extract<Diagnostic, { kind: "lophn_internal" }> {
  return {
    type: "diagnostic",
    kind: "lophn_internal",
    payload: {
      component: input.component,
      observed_at: input.at,
      error_class: "internal_exception",
      location: input.location,
      count: 1,
    },
  };
}

// 처리 못한 예외는 이 process의 event가 알린다.
// 처리 못한 예외로 죽기 전에 분류 한 줄을 남긴다. 원문은 stderr에만 가고(fallback이다),
// 기록이 실패하거나 기한을 넘기면 삼키고 그대로 종료한다. 돌려주는 함수가 listener를 푼다.
export function installCrashHandler(options: {
  write(): Promise<unknown>;
  stderr: WritableStream<Uint8Array>;
  redact(text: string): string;
  exit(code: number): void;
  deadlineMs?: number;
}): () => void {
  let crashing = false;
  const handle = (cause: unknown) => {
    // 기록하는 중에 또 죽으면 기다리지 않는다.
    if (crashing) return options.exit(1);
    crashing = true;
    void (async () => {
      await writeStderr(options, cause);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, options.deadlineMs ?? 2000);
      });
      try {
        await Promise.race([options.write().catch(() => {}), deadline]);
      } finally {
        clearTimeout(timer);
      }
      options.exit(1);
    })();
  };
  process.on("unhandledRejection", handle);
  process.on("uncaughtException", handle);
  return () => {
    process.off("unhandledRejection", handle);
    process.off("uncaughtException", handle);
  };
}

async function writeStderr(
  options: { stderr: WritableStream<Uint8Array>; redact(text: string): string },
  cause: unknown,
) {
  try {
    const text =
      cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
    const writer = options.stderr.getWriter();
    try {
      await writer.write(
        new TextEncoder().encode(`uncaught: ${options.redact(text)}\n`),
      );
    } finally {
      writer.releaseLock();
    }
  } catch {
    // stderr가 닫혔으면 원문은 버려진다.
  }
}
