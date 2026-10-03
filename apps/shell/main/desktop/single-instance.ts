// 같은 데이터 root의 Electron main은 하나다. 두 번째 시작은 등록된 창 열기
// intent만 넘기고 argv의 나머지는 실행 권한으로 읽지 않는다.

export const OPEN_APP_ARG = "--open-app";

export type WindowIntent = "open-app";

export interface SecondInstanceEvent {
  additionalData: { dataRoot: string };
  argv: string[];
}

export interface SingleInstanceApp {
  requestSingleInstanceLock(additionalData: { dataRoot: string }): boolean;
  quit(): void;
  // Electron은 (event, argv, workingDirectory, additionalData)로 보낸다.
  on(event: "second-instance", listener: (...args: unknown[]) => void): void;
}

export interface SingleInstanceOptions {
  app: SingleInstanceApp;
  dataRoot: string;
  onOpenApp: () => void;
}

export interface SingleInstance {
  /** 이 프로세스가 lock을 가졌는지. 못 가졌으면 이미 종료를 요청했다. */
  acquired: boolean;
}

/**
 * argv에서 창 열기 intent만 남긴다. `--open-app` 외의 값(URL, 파일, 명령)은
 * 두 번째 시작이 기존 main에서 실행할 권한이 없으므로 버린다.
 */
export function windowIntents(argv: readonly string[]): WindowIntent[] {
  return argv.filter((arg) => arg === OPEN_APP_ARG).map(() => "open-app");
}

export function startSingleInstance(
  options: SingleInstanceOptions,
): SingleInstance {
  const { app, dataRoot, onOpenApp } = options;
  if (!app.requestSingleInstanceLock({ dataRoot })) {
    app.quit();
    return { acquired: false };
  }
  app.on("second-instance", (...args) => {
    const argv = args[1];
    if (!Array.isArray(argv)) return;
    for (
      const intent of windowIntents(argv.filter((a) => typeof a === "string"))
    ) {
      if (intent === "open-app") onOpenApp();
    }
  });
  return { acquired: true };
}
