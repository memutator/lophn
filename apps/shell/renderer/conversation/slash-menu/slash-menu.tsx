// 입력칸에서 `/`를 치면 composer 위로 뜨는 명령 메뉴(shell/desktop#R45, lophn-agent/commands#R1·R6·R8·R11).
// 목록·묶음·거르기·예약 이름은 lophn-agent/commands(registry·list)가 계산해 props로 주고, 이 component는
// 받은 묶음을 순서대로 그리며 query와 맞는 글자를 굵게 한다. renderer는 contracts·design·sdk만 import하므로
// 그 모듈을 부르는 연결은 core source 쪽 몫이다.
import type { ReactNode } from "react";

/** contract CommandEntry에서 이 화면이 읽는 field. */
export interface SlashEntryView {
  /** `/` 뒤에 치는 이름(compact, eval-metrics). */
  readonly name: string;
  /** built-in·role 명령의 메뉴 제목(Compact). skill은 null이라 이름을 보인다. */
  readonly title: string | null;
  readonly description: string;
  readonly source: "builtin" | "role" | "skill";
  /** 같은 이름 skill이 둘 이상일 때만 있다. 아니면 출처를 달지 않는다(commands#R7). */
  readonly skillOrigin: "place" | "workspace" | null;
  /** 일하는 중 사용 여부. blocked는 못 쓰고, run·queue는 쓴다. */
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
  /** 맞는 명령이 없는 `/…`을 제출했다. 명령으로도 일반 메시지로도 보내지 않는다(commands#R11). */
  | { readonly kind: "unknown"; readonly name: string }
  /** 같은 이름 skill이 둘 이상이라 어느 것인지 고르게 한다(commands#R6). */
  | {
    readonly kind: "choose_skill";
    readonly name: string;
    readonly candidates: readonly SlashEntryView[];
  };

export interface SlashMenuProps {
  /** 둘째 묶음 이름이자 "Not while … is working"의 주어. */
  agentName: string;
  /** `/` 뒤에 친 글자. 맞는 글자를 굵게 하는 데만 쓰고 거르기는 하지 않는다. */
  query: string;
  /** 일하는 중인지(run이 돌거나 질문·승인을 기다림). */
  working: boolean;
  state: SlashMenuState;
  /** 보이는 줄을 위에서 아래로 센 번호. 키보드 이동은 부모가 한다. */
  highlightedIndex: number;
  /** 줄을 골랐다. 일하는 중에 못 쓰는(흐린) 줄은 부르지 않는다. */
  onPick: (entry: SlashEntryView) => void;
}

export function SlashMenu(_props: SlashMenuProps): ReactNode {
  throw new Error("not implemented: agent-I24");
}
