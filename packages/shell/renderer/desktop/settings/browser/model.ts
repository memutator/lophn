// Settings › Browser › Links의 줄 목록. 값은 core 선언 설정이고 main의 bridge가 요청마다 읽는다.
import type { MessageKey } from "@lophn/wording";

import type { LinkId, LinkWhere } from "./source.ts";

interface LinkRow {
  readonly id: LinkId;
  /** 설정 선언의 key. */
  readonly settingKey: string;
  readonly name: MessageKey;
  readonly help: MessageKey;
  readonly options: readonly {
    readonly value: LinkWhere;
    readonly label: MessageKey;
  }[];
}

const WHERE_OPTIONS = [
  { value: "browser_tab", label: "settings.label.link-browser-tab" },
  { value: "system_browser", label: "settings.label.link-system-browser" },
] as const;

export const LINK_ROWS: readonly LinkRow[] = [
  {
    id: "web_links",
    settingKey: "shell.browser.web_links",
    name: "settings.label.web-links",
    help: "settings.note.web-links",
    options: WHERE_OPTIONS,
  },
  {
    id: "local_links",
    settingKey: "shell.browser.local_links",
    name: "settings.label.local-links",
    help: "settings.note.local-links",
    options: WHERE_OPTIONS,
  },
];

/** 선언의 기본값과 같다. 저장된 값이 선택지 밖이면 쓴다. */
export const LINK_DEFAULT: LinkWhere = "browser_tab";
