// Browser 항목이 읽고 쓰는 통로. shell IPC(`window.lophnBrowser`)는 window-source.ts만 안다. link 열 곳·기기·login은
// 화면이 core를 useCoreRead로 읽는다.
import type { BrowserProfile } from "../../../../../protocol/secrets/browser-vault.ts";
import type { BookmarkList } from "../../../../ipc/browser.ts";
import type { SourceResult } from "../source.ts";

export type { BookmarkList, BrowserProfile, SourceResult };

export type LinkId = "web_links" | "local_links";
export type LinkWhere = "browser_tab" | "system_browser";
/** 지금 값. 사람이 고르지 않았으면 선언의 기본값이다. */
export type LinkValues = Readonly<Record<LinkId, LinkWhere>>;

export type DeviceOs = "ios" | "android";
/** 설정 `shell.devices`의 한 줄. 범위는 core의 선언이 본다. */
export interface Device {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly os: DeviceOs;
  /** phone pairing이 넣은 항목의 기기 id. 고쳐도 남긴다(core가 이 칸으로 그 기기의 항목을 찾는다). */
  readonly device?: string;
}

/** 사람이 고치는 login 한 줄. password·TOTP 유무만 알고 값은 모른다. profile은 login이 속한 browser profile이고 null이 기본이다. */
export interface LoginRow {
  readonly id: string;
  readonly profile: string | null;
  readonly label: string;
  readonly origin: string;
  readonly username: string;
  readonly note: string;
  readonly password: boolean;
  readonly totp: boolean;
}

export type LoginForm = Omit<LoginRow, "id" | "profile" | "password" | "totp">;

export interface BrowserSettingsSource {
  /** browser profile 하나(null은 기본)의 cookie, site data, cache를 지우고 그 profile의 열린 탭을 다시 load한다. */
  clearData(profile: string | null): Promise<SourceResult<null>>;
  /** bookmark 목록. 파일이 깨져 있으면 오류가 아니라 `corrupt` 상태다. 실패한 code는 BookmarkReason이다. */
  bookmarks(): Promise<SourceResult<BookmarkList>>;
  updateBookmark(input: {
    id: string;
    title: string;
    url: string;
  }): Promise<SourceResult<null>>;
  removeBookmark(id: string): Promise<SourceResult<null>>;
  /** terminal에서 연 주소와 Ctrl/Cmd-click한 link를 열 곳(core 선언 설정)의 한 줄을 정한다. 거절되면 code가 이유다. */
  chooseLink(id: LinkId, value: LinkWhere): Promise<SourceResult<null>>;
  /** 등록한 기기들(core 선언 설정)의 목록 전체를 바꾼다. 이름이 겹치거나 범위 밖이면 거절되고 code가 이유다. */
  saveDevices(list: readonly Device[]): Promise<SourceResult<null>>;
  /** 이 컴퓨터가 profile과 저장 login을 다른 컴퓨터와 맞출지(core의 사람만 바꾸는 설정)를 정한다. */
  chooseShare(on: boolean): Promise<SourceResult<null>>;
  /** browser profile 하나를 만들거나(id 없음) 고친다. 이름이 겹치거나 수가 넘치면 `conflict`다. 값은 그 profile의 id다. */
  saveProfile(input: {
    id?: string;
    name: string;
    color: BrowserProfile["color"];
  }): Promise<SourceResult<string>>;
  /** browser profile과 그 profile의 login을 지운다(partition data는 앞서 clearData로 지운다). */
  deleteProfile(id: string): Promise<SourceResult<null>>;
  /** login을 저장한다. id가 없으면 새로 만들고 그때만 profile(null은 기본)이 쓰인다. 있는 login은 profile을 옮기지 않는다. */
  saveLogin(
    input: LoginForm & { id?: string; profile?: string | null },
  ): Promise<SourceResult<null>>;
  deleteLogin(id: string): Promise<SourceResult<null>>;
  /** 보호 입력 창을 열고 닫힐 때까지 기다린다. `stored`면 값이 올라가 있다. 값은 이 통로를 지나지 않는다. */
  enterLoginSecret(
    login: LoginRow,
    field: "password" | "totp",
  ): Promise<SourceResult<"stored" | "cancelled">>;
  /** 다른 창에서 목록이 바뀌면 부른다. 받은 쪽이 다시 읽는다. 끄는 함수를 돌려준다. */
  watchBookmarks(listener: () => void): () => void;
}
