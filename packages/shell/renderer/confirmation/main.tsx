import type { ConfirmationFrameApi } from "./frame/api.ts";
import { ConfirmationScreen } from "./screen.tsx";

type Bridge = {
  lophnConfirmation?: ConfirmationFrameApi;
};

/**
 * 보호 preload가 연 API로 화면을 그린다. 사용자 slot·fork는 읽지 않는다. theme은 main이
 * 검증해 넘긴 token 값만 쓴다. preload가 없으면 아무것도 그리지 않는다.
 */
export function ConfirmationApp(
  { theme = {} }: { theme?: Record<string, string> },
) {
  const api = (globalThis as unknown as Bridge).lophnConfirmation;
  if (api === undefined) return null;
  return <ConfirmationScreen api={api} theme={theme} />;
}
