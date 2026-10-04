// 처리되지 않은 exception은 보고를 시도한 뒤 stderr에 원래 실패를 남기고 exit 1.
export type CrashReport = (
  reason: unknown,
  kind: "error" | "unhandledrejection",
) => Promise<void>;

export function installCrashExit(deps: {
  report: CrashReport;
  writeStderr: (text: string) => void;
  exit: (code: number) => void;
}): void {
  const fail = (reason: unknown, kind: "error" | "unhandledrejection") => {
    const text = reason instanceof Error
      ? `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`
      : String(reason);
    deps.report(reason, kind).catch(() => undefined).finally(() => {
      deps.writeStderr(text);
      deps.exit(1);
    });
  };
  globalThis.addEventListener("error", (event) => {
    event.preventDefault();
    fail((event as ErrorEvent).error, "error");
  });
  globalThis.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    const rejection = event as PromiseRejectionEvent;
    fail(rejection.reason, "unhandledrejection");
  });
}
