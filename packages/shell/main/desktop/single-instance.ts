// 같은 데이터 root의 Electron main은 하나다. 두 번째 시작은 기존 main에 창을 요청할 뿐이고,
// argv의 URL·파일·명령은 실행 권한으로 읽지 않는다. second-instance argv에서 읽는 것은
// open-intent.ts의 두 intent(`--quit`, `--open-app <app ID>`)뿐이고 나머지는 새 기본 창 요청이다.
// OS 앱 바로가기가 `--open-app`으로 이미 떠 있는 main에 앱 창을 요청하는 데 쓴다.
import { readOpenIntent } from "./open-intent.ts";

interface SingleInstanceApp {
  requestSingleInstanceLock(additionalData: { dataRoot: string }): boolean;
  quit(): void;
  // Electron은 (event, argv, workingDirectory, additionalData)로 보낸다.
  on(event: "second-instance", listener: (...args: unknown[]) => void): void;
}

interface SingleInstanceOptions {
  app: SingleInstanceApp;
  dataRoot: string;
  /** 새 기본 창 요청. 대상 intent가 없는 second-instance마다 부른다. */
  onOpenWindow: () => void;
  /** argv `--quit`의 종료 요청. 있으면 second-instance가 부른다. */
  onQuitIntent: () => void;
  /** `--open-app <app ID>`의 앱 전용 창 요청. 없으면 기본 창이다. */
  onOpenApp?: (app: string) => void;
}

interface SingleInstance {
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
    const argv = Array.isArray(args[1])
      ? args[1].filter((item): item is string => typeof item === "string")
      : [];
    const intent = readOpenIntent(argv);
    if (intent.kind === "quit") onQuitIntent();
    else if (intent.kind === "app" && options.onOpenApp) {
      options.onOpenApp(intent.app);
    } else onOpenWindow();
  });
  return { acquired: true };
}
