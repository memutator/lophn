import { CONFIRMATION_OPEN_CHANNEL } from "../ipc/confirmation-channels.ts";

export interface OpenTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

/**
 * 일반 shell 창의 보호 창 열기. 창을 열 뿐 결정을 제출하지 못한다. 부모는 main이 IPC를
 * 보낸 창으로 정하고 입력 모양도 main이 검사한다. 통로 실패는 고정 오류로 바꾸고 Electron
 * 오류 문장은 넘기지 않는다.
 */
export function createConfirmationOpener(
  transport: OpenTransport,
): (intent: unknown) => Promise<unknown> {
  return async (intent) => {
    try {
      return await transport.invoke(CONFIRMATION_OPEN_CHANNEL, intent);
    } catch {
      return { code: "unavailable", message: "Confirmation is unavailable" };
    }
  };
}
