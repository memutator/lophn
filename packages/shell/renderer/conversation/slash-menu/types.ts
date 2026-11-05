// `/` 명령 메뉴가 받는 화면 값. CSS를 부르는 component 없이 type만 가져올 수 있게 따로 둔다.
import type { AcpCommand } from "../../../../protocol/acp/mod.ts";

/** contract CommandEntry에서 이 화면이 읽는 field. */
export interface SlashEntryView {
  /** `/` 뒤에 치는 이름(compact, eval-metrics). */
  readonly name: string;
  /** built-in 명령의 메뉴 제목(Compact). skill은 null이라 이름을 보인다. */
  readonly title: string | null;
  readonly description: string;
  readonly source: AcpCommand["source"];
}

/** Commands · Skills 중 하나. 맞는 명령이 없는 묶음은 목록에 없다. */
export interface SlashGroupView {
  readonly source: SlashEntryView["source"];
  /** 묶음 머리 글. */
  readonly title: string;
  readonly entries: readonly SlashEntryView[];
}

export type SlashMenuState =
  /** 묶음 목록. */
  | { readonly kind: "list"; readonly groups: readonly SlashGroupView[] }
  /** 맞는 명령이 없는 `/…`을 제출했다. 명령으로도 일반 메시지로도 보내지 않는다. */
  | { readonly kind: "unknown"; readonly name: string };
