// 같은 데이터 root의 Electron main은 하나다. 두 번째 시작은 기존 main에 창을 요청할 뿐이고,
// argv의 URL·파일·명령은 실행 권한으로 읽지 않는다. second-instance argv에서 읽는 것은
// open-intent.ts의 intent(`--quit`, `--open-app <app ID>`, `--core`, `--agent-window`, `--page-host`)뿐이고
// `--core`는 창을 열지 않고 `--agent-window`와 `--page-host`(떠 있는 desktop 앱이 host다)는 창이 없을 때만 focus 없이 연다.
// 나머지는 새 기본 창 요청이다. OS 앱 바로가기가 `--open-app`으로
// 이미 떠 있는 main에 창을 요청하는 데 쓴다.
import { readOpenIntent } from "./open-intent.ts";

interface SingleInstanceApp {
  requestSingleInstanceLock(additionalData: { dataRoot: string }): boolean;
  quit(): void;
  // Electron은 (event, argv, workingDirectory, additionalData)로 보낸다.
  on(event: "second-instance", listener: (...args: unknown[]) => void): void;
}

interface SingleInstanceListenerOptions {
  app: Pick<SingleInstanceApp, "on">;
  /** 새 기본 창 요청. 대상 intent가 없는 second-instance마다 부른다. */
  onOpenWindow: () => void;
  /** argv `--quit`의 종료 요청. 있으면 second-instance가 부른다. */
  onQuitIntent: () => void;
  /** `--open-app <app ID>`의 앱 전용 창 요청. 없으면 기본 창이다. */
  onOpenApp?: (app: string) => void;
  /** `--agent-window`: 창이 하나도 없을 때만 focus 없이 연다. 있으면 아무것도 하지 않는다. */
  onAgentWindow: () => void;
}

/**
 * lock만 잡는다. core를 건드리기 전에 부른다. 못 잡으면 이미 종료를 요청했고 false다.
 * Electron의 lock은 userData 폴더에 걸리므로 userData를 정한 뒤에 부른다.
 */
export function acquireSingleInstance(
  app: Pick<SingleInstanceApp, "requestSingleInstanceLock" | "quit">,
  dataRoot: string,
): boolean {
  if (app.requestSingleInstanceLock({ dataRoot })) return true;
  app.quit();
  return false;
}

export function listenSecondInstance(
  options: SingleInstanceListenerOptions,
): void {
  const { app, onOpenWindow, onQuitIntent } = options;
  app.on("second-instance", (...args: unknown[]) => {
    // Electron은 argv를 두 번째 인자로 보낸다.
    const argv = Array.isArray(args[1])
      ? args[1].filter((item): item is string => typeof item === "string")
      : [];
    const intent = readOpenIntent(argv);
    if (intent.kind === "quit") onQuitIntent();
    // 이미 shell이 있으면 core도 있다. core-only intent는 창을 열지 않는다.
    else if (intent.kind === "core") return;
    else if (intent.kind === "agent-window") options.onAgentWindow();
    else if (intent.kind === "app" && options.onOpenApp) {
      options.onOpenApp(intent.app);
    } else onOpenWindow();
  });
}
