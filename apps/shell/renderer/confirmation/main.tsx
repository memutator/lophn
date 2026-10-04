import { createRoot } from "react-dom/client";

import type { ConfirmationFrameApi } from "./frame/api.ts";
import { ConfirmationScreen } from "./screen.tsx";

type Bridge = {
  lophnConfirmation?: ConfirmationFrameApi;
};

// 사용자 slot·fork는 읽지 않는다. theme은 main이 검증해 넘긴 token 값만 쓴다.
export function mountConfirmation(
  root: HTMLElement,
  api: ConfirmationFrameApi,
  theme: Record<string, string>,
): void {
  createRoot(root).render(<ConfirmationScreen api={api} theme={theme} />);
}

const bridge = globalThis as unknown as Bridge;
const node = document.getElementById("root");
if (node !== null && bridge.lophnConfirmation !== undefined) {
  mountConfirmation(node, bridge.lophnConfirmation, {});
}
