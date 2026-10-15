// `/` 명령 메뉴가 받는 화면 값. CSS를 부르는 component 없이 type만 가져올 수 있게 따로 둔다.

/** contract CommandEntry에서 이 화면이 읽는 field. */
export interface SlashEntryView {
  /** `/` 뒤에 치는 이름(compact, eval-metrics). */
  readonly name: string;
  /** built-in·role 명령의 메뉴 제목(Compact). skill은 null이라 이름을 보인다. */
  readonly title: string | null;
  readonly description: string;
  readonly source: "builtin" | "role" | "skill";
  /** 메뉴는 읽지 않는다. 같은 이름이면 마지막 층이 덮어 출처를 달지 않는다. 옛 source가 아직 채운다. */
  readonly skillOrigin: "builtin" | "global" | "project" | null;
  /** 메뉴는 읽지 않는다. 일하는 중 고른 명령은 모두 다음 turn에 들어간다. 옛 source가 아직 채운다. */
  readonly whileRunning: "run" | "queue" | "blocked";
}

/** Commands · <agent 이름> · Skills 중 하나. 맞는 명령이 없는 묶음은 목록에 없다. */
export interface SlashGroupView {
  readonly source: SlashEntryView["source"];
  /** 묶음 머리 글. 둘째 묶음은 agent 이름이다. */
  readonly title: string;
  readonly entries: readonly SlashEntryView[];
}

export type SlashMenuState =
  /** 묶음 목록. */
  | { readonly kind: "list"; readonly groups: readonly SlashGroupView[] }
  /** 맞는 명령이 없는 `/…`을 제출했다. 명령으로도 일반 메시지로도 보내지 않는다. */
  | { readonly kind: "unknown"; readonly name: string };
