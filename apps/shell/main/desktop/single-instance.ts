// 같은 데이터 root의 Electron main은 하나다. 두 번째 시작은 기존 main에 창을 요청할 뿐이고,
// argv의 URL·파일·명령은 실행 권한으로 읽지 않는다. second-instance argv에서 읽는 것은
// open-intent.ts의 세 intent(`--quit`, `--open-app <app ID>`, `lophn://things-to-confirm/<id>`)
// 뿐이고 나머지는 새 기본 창 요청이다(desktop#R13, R14, R21).
import { readOpenIntent } from "./open-intent.ts";

/** second-instance argv의 창 없는 종료 요청. 다른 값은 실행하지 않는다. */
export function hasQuitIntent(argv: readonly string[]): boolean {
  return readOpenIntent(argv).kind === "quit";
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
  /** 새 기본 창 요청. 대상 intent가 없는 second-instance마다 부른다. */
  onOpenWindow: () => void;
  /** argv `--quit`의 종료 요청(desktop#R21). 있으면 second-instance가 부른다. */
  onQuitIntent: () => void;
  /** `--open-app <app ID>`의 앱 전용 창 요청. 없으면 기본 창이다. */
  onOpenApp?: (app: string) => void;
  /** `lophn://things-to-confirm/<id>` 링크. 없으면 기본 창이다. */
  onThingsToConfirm?: (request: string) => void;
  /** `lophn://things-to-confirm/<cac|tkt|app id>` 링크(coding agent 회수·취소·생성). 없으면 기본 창이다. */
  onCoding?: (target: string) => void;
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
    const argv = Array.isArray(args[1])
      ? args[1].filter((item): item is string => typeof item === "string")
      : [];
    const intent = readOpenIntent(argv);
    if (intent.kind === "quit") onQuitIntent();
    else if (intent.kind === "app" && options.onOpenApp) {
      options.onOpenApp(intent.app);
    } else if (
      intent.kind === "things-to-confirm" && options.onThingsToConfirm
    ) {
      options.onThingsToConfirm(intent.request);
    } else if (intent.kind === "coding" && options.onCoding) {
      options.onCoding(intent.target);
    } else onOpenWindow();
  });
  return { acquired: true };
}
