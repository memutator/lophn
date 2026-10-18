// Browser 항목이 읽고 쓰는 통로. 화면은 이 interface만 보고 shell IPC(`window.lophnBrowser`)는 window-source.ts만 안다.
import type { BookmarkList } from "../../../../ipc/browser.ts";
import type { SourceResult } from "../source.ts";

export type { BookmarkList, SourceResult };

export interface BrowserSettingsSource {
  /** browser 탭의 cookie, site data, cache를 지우고 열린 탭을 다시 load한다. */
  clearData(): Promise<SourceResult<null>>;
  /** bookmark 목록. 파일이 깨져 있으면 오류가 아니라 `corrupt` 상태다. 실패한 code는 BookmarkReason이다. */
  bookmarks(): Promise<SourceResult<BookmarkList>>;
  updateBookmark(
    input: { id: string; title: string; url: string },
  ): Promise<SourceResult<null>>;
  removeBookmark(id: string): Promise<SourceResult<null>>;
  /** 다른 창에서 목록이 바뀌면 부른다. 받은 쪽이 다시 읽는다. 끄는 함수를 돌려준다. */
  watchBookmarks(listener: () => void): () => void;
}
