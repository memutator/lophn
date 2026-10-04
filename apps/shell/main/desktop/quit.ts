// second-instance `--quit`의 종료 순서(desktop#R21). 창이 있으면 T55의 끄기
// 확인과 같은 경로를 쓴다. 창이 없으면 확인할 창이 없다는 사실을 log로 남기고
// core 정상 종료 순서를 밟는다. 일반 preload·renderer에 종료 통로를 두지 않는다.

export interface QuitWindowProbe {
  /** 진행 중 터미널·저장을 확인할 창이 있는지. */
  hasWindows(): boolean;
}

export interface QuitOptions {
  windows: QuitWindowProbe;
  /** core 정상 종료 순서. supervise child의 stop frame을 싣는다. */
  shutdownCore: () => void;
  /** Electron 종료. core pipe 종료 뒤에 부른다. */
  quitApp: () => void;
  /** 창이 있을 때의 끄기 확인(T55와 같은 경로). 창이 있으면 이 경로만 쓴다. */
  confirmWithWindows?: () => void;
  /** 확인할 창이 없을 때 남기는 log. */
  log?: (message: string) => void;
}

/** 명시 종료를 순서대로 밟는다. 자동 종료는 아니다(R21). */
export function requestQuit(options: QuitOptions): void {
  if (options.windows.hasWindows()) {
    // T55의 끄기 확인과 같은 경로. 창이 확인을 대신한다(architecture 7.3).
    if (options.confirmWithWindows !== undefined) {
      options.confirmWithWindows();
      return;
    }
    options.log?.("창이 있어 끄기 확인 경로로 보낸다");
    return;
  }
  // 창이 없으면 진행 중 터미널·저장을 확인할 창이 없다. 사실을 log로 남긴다.
  (options.log ?? defaultLog)(
    "확인할 창이 없어 끄기 확인 없이 core 종료 순서를 밟는다",
  );
  options.shutdownCore();
  options.quitApp();
}

function defaultLog(message: string): void {
  console.log(`[lophn] ${message}`);
}
