// `/` 명령 메뉴가 받는 화면 값. CSS를 부르는 component 없이 type만 가져올 수 있게 따로 둔다.
import type {
  AcpCommand,
  AcpCommandOpens,
} from "../../../../protocol/acp/mod.ts";

/** contract CommandEntry에서 이 화면이 읽는 field. */
export interface SlashEntryView {
  /** `/` 뒤에 치는 이름(compact, eval-metrics). */
  readonly name: string;
  readonly description: string;
  /** null이면 인자를 받지 않는다. */
  readonly argumentHint: string | null;
  readonly source: AcpCommand["source"];
  /** 화면이 여는 동작. null이면 CLI에 `run_command`로 보낸다. */
  readonly opens: AcpCommandOpens | null;
  /** 이름이 아니라 이 별칭이 맞았으면 그 별칭. */
  readonly alias: string | null;
}

/** 머리 글이 있는 묶음의 종류. plugin과 MCP, 사람 명령 file 둘은 각각 한 묶음이다. */
export type SlashGroupKey =
  | "app"
  | "harness"
  | "skill"
  | "extension"
  | "custom";

export interface SlashGroupView {
  readonly key: SlashGroupKey;
  readonly entries: readonly SlashEntryView[];
}

/** 메뉴의 두 꼴: `/`만 쳤을 때의 묶음, 글자를 쳤을 때 순위대로 선 한 목록. */
export type SlashListState =
  | { readonly kind: "groups"; readonly groups: readonly SlashGroupView[] }
  | { readonly kind: "ranked"; readonly entries: readonly SlashEntryView[] };

export type SlashMenuState =
  | SlashListState
  /** 맞는 명령이 없는 `/…`을 제출했다. 명령으로도 일반 메시지로도 보내지 않는다. */
  | { readonly kind: "unknown"; readonly name: string };
