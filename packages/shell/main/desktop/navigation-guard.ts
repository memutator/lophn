// shell 창의 navigation 규칙. Electron 없는 순수 함수다. main frame은 lophn-shell://desktop
// 밖으로 가지 않는다. subframe은 정하지 않는다(renderer에 iframe이 없고 pdf `<embed>`가
// Chromium 안쪽 frame을 쓴다). `<webview>` guest는 따로인 webContents라 여기 오지 않는다.
import { SHELL_SCHEME } from "./security.ts";

export type ShellNavigation =
  | { allow: true }
  | {
      allow: false;
      /** main frame의 http·https link다. open-external로 넘긴다. */
      external?: true;
    };

export function decideShellNavigation(input: {
  url: string;
  isMainFrame: boolean;
}): ShellNavigation {
  if (!input.isMainFrame) return { allow: true };
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { allow: false };
  }
  if (url.protocol === `${SHELL_SCHEME}:` && url.hostname === "desktop") {
    return { allow: true };
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    return { allow: false, external: true };
  }
  return { allow: false };
}
