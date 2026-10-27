// Browser 항목이 읽고 쓰는 통로. 화면은 이 interface만 보고 shell IPC(`window.lophnBrowser`)는 window-source.ts만 안다.
import type { BookmarkList } from "../../../../ipc/browser.ts";
import type { SourceResult } from "../source.ts";

export type { BookmarkList, SourceResult };

export type LinkId = "web_links" | "local_links";
export type LinkWhere = "browser_tab" | "system_browser";
/** 지금 값. 사람이 고르지 않았으면 선언의 기본값이다. */
export type LinkValues = Readonly<Record<LinkId, LinkWhere>>;

export interface BrowserSettingsSource {
  /** browser 탭의 cookie, site data, cache를 지우고 열린 탭을 다시 load한다. */
  clearData(): Promise<SourceResult<null>>;
  /** bookmark 목록. 파일이 깨져 있으면 오류가 아니라 `corrupt` 상태다. 실패한 code는 BookmarkReason이다. */
  bookmarks(): Promise<SourceResult<BookmarkList>>;
  updateBookmark(input: {
    id: string;
    title: string;
    url: string;
  }): Promise<SourceResult<null>>;
  removeBookmark(id: string): Promise<SourceResult<null>>;
  /** terminal에서 연 주소와 Ctrl/Cmd-click한 link를 열 곳. core 선언 설정이다. */
  links(): Promise<SourceResult<LinkValues>>;
  /** 한 줄의 값을 정한다. 거절되면 code가 이유다. */
  chooseLink(id: LinkId, value: LinkWhere): Promise<SourceResult<null>>;
  /** 다른 창에서 목록이 바뀌면 부른다. 받은 쪽이 다시 읽는다. 끄는 함수를 돌려준다. */
  watchBookmarks(listener: () => void): () => void;
}
