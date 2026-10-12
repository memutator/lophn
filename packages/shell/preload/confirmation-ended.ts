import {
  CONFIRMATION_ENDED_CHANNEL,
  CONFIRMATION_ENDED_KINDS,
  type ConfirmationEnded,
} from "../ipc/confirmation-channels.ts";

export interface EndedTransport {
  on(
    channel: string,
    listener: (event: unknown, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    listener: (event: unknown, payload: unknown) => void,
  ): void;
}

/**
 * 일반 shell 창이 자기가 연 확인의 끝남 알림을 받는 구독. main은 확인을 연 창에게만 보내고,
 * 여기서는 windowId와 끝난 종류 두 값만 모양을 확인해 넘긴다. Electron event는 넘기지 않는다.
 */
export function createConfirmationEndedSubscriber(
  transport: EndedTransport,
): (listener: (ended: ConfirmationEnded) => void) => () => void {
  return (listener) => {
    const callback = (_event: unknown, payload: unknown) => {
      const value = payload as Partial<ConfirmationEnded> | null;
      if (
        typeof value?.windowId !== "string" || value.windowId === "" ||
        !(CONFIRMATION_ENDED_KINDS as readonly unknown[]).includes(value.ended)
      ) return;
      listener({ windowId: value.windowId, ended: value.ended! });
    };
    transport.on(CONFIRMATION_ENDED_CHANNEL, callback);
    return () => transport.removeListener(CONFIRMATION_ENDED_CHANNEL, callback);
  };
}
