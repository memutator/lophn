import {
  fakeGlobalFloatsBridge,
  type GlobalFloatsBridge,
} from "../../shell/global-floats/store.ts";

/**
 * 비어 있는 메모리 전역 float 통로. entry.tsx가 따로 넘기지 않아도 Desktop이 읽는 자리(preload가 두는 `lophnGlobalFloats`)에
 * 둔다. 다시 읽으면 처음처럼 빈 목록이다. Electron 창에서는 preload가 이미 둔 통로를 그대로 쓴다: contextBridge가 둔 값은
 * 읽기 전용이라 덮으면 throw하고 mock 창이 빈 화면이 된다.
 */
export function installMockGlobalFloats(): void {
  const scope = globalThis as { lophnGlobalFloats?: GlobalFloatsBridge };
  if (scope.lophnGlobalFloats === undefined) {
    scope.lophnGlobalFloats = fakeGlobalFloatsBridge();
  }
}
