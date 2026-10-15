// gallery의 창에는 Electron preload가 없어 창 단추(최소화, 최대화, 닫기)가 그려지지 않는다. 화면 frame에만
// 눌러도 아무 일 없는 창 통로를 둔다. 실제 TopBar는 이 통로가 있어야 창 단추를 그리고 오른쪽 여백을 단추에 맡긴다.
import type {
  WindowControlReply,
  WindowControlsApi,
} from "../../../../packages/shell/ipc/window-controls.ts";

const REPLY: WindowControlReply = { ok: true, state: { maximized: false } };

export function installWindowApi(): void {
  const api: WindowControlsApi = {
    state: () => Promise.resolve(REPLY),
    minimize: () => Promise.resolve(REPLY),
    toggleMaximize: () => Promise.resolve(REPLY),
    close: () => Promise.resolve(REPLY),
    subscribe: () => () => {},
  };
  (globalThis as { lophnWindow?: WindowControlsApi }).lophnWindow = api;
}
