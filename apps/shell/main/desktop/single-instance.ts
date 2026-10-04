// 같은 데이터 root의 Electron main은 하나다. 두 번째 시작은 기존 main에 새 기본 창을
// 요청할 뿐이고, argv의 URL·파일·명령은 실행 권한으로 읽지 않는다. second-instance
// argv에서 읽는 것은 창 없는 종료 intent `--quit`뿐이다(desktop#R21).

/** second-instance argv의 창 없는 종료 요청. 다른 값은 실행하지 않는다. */
export function hasQuitIntent(argv: readonly string[]): boolean {
  return argv.includes("--quit");
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
  /** 새 기본 창 요청. `--quit`이 아닌 second-instance마다 부른다. */
  onOpenWindow: () => void;
  /** argv `--quit`의 종료 요청(desktop#R21). 있으면 second-instance가 부른다. */
  onQuitIntent: () => void;
}

export interface SingleInstance {
  /** 이 프로세스가 lock을 가졌는지. 못 가졌으면 이미 종료를 요청했다. */
  acquired: boolean;
}

export function startSingleInstance(
  options: SingleInstanceOptions,
): SingleInstance {
  const { app, dataRoot, onOpenWindow, onQuitIntent } = options;
  if (!app.requestSingleInstanceLock({ dataRoot })) {
    app.quit();
    return { acquired: false };
  }
  app.on("second-instance", (...args: unknown[]) => {
    // Electron은 argv를 두 번째 인자로 보낸다.
    const argv = typeof args[1] === "object" && args[1] !== null &&
        Array.isArray(args[1])
      ? args[1] as string[]
      : [];
    if (hasQuitIntent(argv)) {
      onQuitIntent();
      return;
    }
    onOpenWindow();
  });
  return { acquired: true };
}
