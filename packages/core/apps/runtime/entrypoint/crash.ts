import process from "node:process";

// 처리되지 않은 exception은 stderr에 원래 실패를 남기고 exit 1.
// 보고는 앱 code load 전에 설치한 exception observer가 한 번 한다. 그 보고가 전달되기 전에 process가 죽으면
// 오류 이름·message·stack이 앱 log에 남지 않으므로 `beforeExit`(전달이 끝날 때까지, 상한 안에서)를 기다린 뒤 죽는다.
export function installCrashExit(deps: {
  writeStderr: (text: string) => void;
  exit: (code: number) => void;
  beforeExit?: () => Promise<void>;
}): void {
  let exiting = false;
  const fail = (reason: unknown) => {
    const text =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`
        : String(reason);
    deps.writeStderr(text);
    if (exiting) return;
    exiting = true;
    void (deps.beforeExit?.() ?? Promise.resolve())
      .catch(() => {})
      .then(() => deps.exit(1));
  };
  // process event가 처리 못한 예외를 알린다. listener가 있으면 기본 종료는 하지 않는다.
  process.on("uncaughtException", fail);
  process.on("unhandledRejection", fail);
}
