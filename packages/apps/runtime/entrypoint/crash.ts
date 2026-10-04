// 처리되지 않은 exception은 stderr에 원래 실패를 남기고 exit 1.
// 보고는 앱 code load 전에 설치한 exception observer가 한 번 한다.
export function installCrashExit(deps: {
  writeStderr: (text: string) => void;
  exit: (code: number) => void;
  target?: EventTarget;
}): void {
  const fail = (reason: unknown) => {
    const text = reason instanceof Error
      ? `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`
      : String(reason);
    deps.writeStderr(text);
    deps.exit(1);
  };
  const target = deps.target ?? globalThis;
  target.addEventListener("error", (event) => {
    event.preventDefault();
    fail((event as ErrorEvent).error);
  });
  target.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    fail((event as PromiseRejectionEvent).reason);
  });
}
