import type { Diagnostic } from "../../protocol/supervision/mod.ts";

// 처리 못한 예외로 죽는 process의 위치 ID. log record의 location은 아래 표의 표시 문자열이 된다.
export const CRASH_LOCATIONS = {
  daemon: "daemon-crash",
  agentRuntime: "agent-runtime-crash",
} as const;

// I/O worker catalog의 `locations`에 쓴다.
export const CRASH_LOCATION_NAMES: Readonly<Record<string, string>> = {
  [CRASH_LOCATIONS.daemon]: "packages/core/main/daemon/wiring/diagnostics.ts",
  [CRASH_LOCATIONS.agentRuntime]: "packages/core/main/agent-runtime/main.ts",
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

type CrashEvent = {
  preventDefault(): void;
  error?: unknown;
  reason?: unknown;
};
type CrashTarget = {
  addEventListener(
    type: "unhandledrejection" | "error",
    listener: (event: CrashEvent) => void,
  ): void;
  removeEventListener(
    type: "unhandledrejection" | "error",
    listener: (event: CrashEvent) => void,
  ): void;
};

// 처리 못한 예외로 죽기 전에 분류 한 줄을 남긴다. 원문은 stderr에만 가고(fallback이다),
// 기록이 실패하거나 기한을 넘기면 삼키고 그대로 종료한다. 돌려주는 함수가 listener를 푼다.
export function installCrashHandler(options: {
  target: CrashTarget;
  write(): Promise<unknown>;
  stderr: WritableStream<Uint8Array>;
  redact(text: string): string;
  exit(code: number): void;
  deadlineMs?: number;
}): () => void {
  let crashing = false;
  const handle = (event: CrashEvent, cause: unknown) => {
    event.preventDefault();
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
  const onRejection = (event: CrashEvent) => handle(event, event.reason);
  const onError = (event: CrashEvent) => handle(event, event.error);
  options.target.addEventListener("unhandledrejection", onRejection);
  options.target.addEventListener("error", onError);
  return () => {
    options.target.removeEventListener("unhandledrejection", onRejection);
    options.target.removeEventListener("error", onError);
  };
}

async function writeStderr(
  options: { stderr: WritableStream<Uint8Array>; redact(text: string): string },
  cause: unknown,
) {
  try {
    const text = cause instanceof Error
      ? cause.stack ?? cause.message
      : String(cause);
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
