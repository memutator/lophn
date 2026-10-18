// Browser 항목이 읽고 쓰는 통로. 화면은 이 interface만 보고 shell IPC(`window.lophnBrowser`)는 window-source.ts만 안다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

export interface BrowserSettingsSource {
  /** browser 탭의 cookie, site data, cache를 지우고 열린 탭을 다시 load한다. */
  clearData(): Promise<SourceResult<null>>;
}
