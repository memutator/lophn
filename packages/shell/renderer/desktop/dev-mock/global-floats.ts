import {
  fakeGlobalFloatsBridge,
  type GlobalFloatsBridge,
} from "../../shell/global-floats/store.ts";

/**
 * 비어 있는 메모리 전역 float 통로. entry.tsx가 따로 넘기지 않아도 Desktop이 읽는 자리(preload가 두는 `lophnGlobalFloats`)에
 * 둔다. 다시 읽으면 처음처럼 빈 목록이다.
 */
export function installMockGlobalFloats(): GlobalFloatsBridge {
  const bridge = fakeGlobalFloatsBridge();
  (globalThis as { lophnGlobalFloats?: GlobalFloatsBridge }).lophnGlobalFloats =
    bridge;
  return bridge;
}
