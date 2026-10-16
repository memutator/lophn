// 전역 팔레트. OS 전역 단축키는 CommandOrControl+Shift+K 하나만 등록한다.
// 다른 앱에 focus가 있어도 lophn 창을 앞으로 가져와 lophn 전체 팔레트를 연다. 창 안 팔레트
// (CommandOrControl+K, 지금 공간의 행을 여닫는다)와 다른 동작이다. 전역 Ctrl+K는 등록하지 않는다.
// 등록이 실패하면 사용 불가로 안내하고 다른 key를 대신 차지하지 않는다. 종료 때 자기 key만 푼다.
// Electron globalShortcut은 adapter 뒤에 둔다. 테스트와 headless는 실제 OS에 등록하지 않는다.
import { GLOBAL_PALETTE_ACCELERATOR } from "../../ipc/shortcuts.ts";

export interface GlobalShortcutPort {
  /** 등록했으면 true. 다른 앱이 이미 쓰면 false이거나 throw한다. */
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

type GlobalPaletteState = "registered" | "unavailable";

interface GlobalPaletteOptions {
  port: GlobalShortcutPort;
  /** 키를 누르면 부른다. 창을 앞으로 가져와 전역 팔레트를 연다. */
  onPalette(): void;
  /** 등록 실패를 안내한다. 한 번만 부른다. */
  unavailable?(): void;
  log?(message: string): void;
}

export interface GlobalPalette {
  readonly state: GlobalPaletteState;
  /** 종료 때 자기 key만 푼다. 여러 번 불러도 한 번만 푼다. */
  dispose(): void;
}

export function installGlobalPalette(
  options: GlobalPaletteOptions,
): GlobalPalette {
  const log = options.log ?? defaultLog;
  let registered = false;
  try {
    registered = options.port.register(
      GLOBAL_PALETTE_ACCELERATOR,
      () => options.onPalette(),
    );
  } catch {
    registered = false;
  }
  if (!registered) {
    // 다른 key로 대신 등록하지 않는다. 창 안 팔레트는 그대로 쓸 수 있다.
    log(`전역 팔레트 ${GLOBAL_PALETTE_ACCELERATOR}를 등록하지 못했다`);
    options.unavailable?.();
  }
  let disposed = false;
  return {
    state: registered ? "registered" : "unavailable",
    dispose() {
      if (disposed) return;
      disposed = true;
      if (registered) options.port.unregister(GLOBAL_PALETTE_ACCELERATOR);
    },
  };
}

function defaultLog(message: string): void {
  console.log(`[lophn] ${message}`);
}
