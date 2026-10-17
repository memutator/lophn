import { APPEARANCE_CHANNEL, type AppearanceApi } from "../ipc/appearance.ts";

interface AppearanceTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

// 값만 보낸다. 실패해도 화면의 data-theme은 이미 바뀌었으므로 조용히 둔다.
export function createAppearanceApi(
  transport: AppearanceTransport,
): AppearanceApi {
  return Object.freeze(
    {
      set(appearance) {
        void transport.invoke(APPEARANCE_CHANNEL, appearance).catch(() => {});
      },
    } satisfies AppearanceApi,
  );
}
