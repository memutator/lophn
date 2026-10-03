// 같은 데이터 root의 Electron main은 하나다. 두 번째 시작은 기존 main에 새 기본 창을
// 요청할 뿐이고, argv의 URL·파일·명령은 실행 권한으로 읽지 않는다.

export interface SingleInstanceApp {
  requestSingleInstanceLock(additionalData: { dataRoot: string }): boolean;
  quit(): void;
  // Electron은 (event, argv, workingDirectory, additionalData)로 보낸다.
  on(event: "second-instance", listener: (...args: unknown[]) => void): void;
}

export interface SingleInstanceOptions {
  app: SingleInstanceApp;
  dataRoot: string;
  onOpenWindow: () => void;
}

export interface SingleInstance {
  /** 이 프로세스가 lock을 가졌는지. 못 가졌으면 이미 종료를 요청했다. */
  acquired: boolean;
}

export function startSingleInstance(
  options: SingleInstanceOptions,
): SingleInstance {
  const { app, dataRoot, onOpenWindow } = options;
  if (!app.requestSingleInstanceLock({ dataRoot })) {
    app.quit();
    return { acquired: false };
  }
  app.on("second-instance", () => onOpenWindow());
  return { acquired: true };
}
