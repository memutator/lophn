import { THEME_CHANNEL, type ThemeApi } from "../ipc/theme.ts";

interface ThemeTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

// 값만 보낸다. 실패해도 화면의 data-theme은 이미 바뀌었으므로 조용히 둔다.
export function createThemeApi(transport: ThemeTransport): ThemeApi {
  return Object.freeze(
    {
      set(theme) {
        void transport.invoke(THEME_CHANNEL, { theme }).catch(() => {});
      },
    } satisfies ThemeApi,
  );
}
