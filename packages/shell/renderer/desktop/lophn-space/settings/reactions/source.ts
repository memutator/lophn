// Reactions가 읽고 쓰는 통로. 새 일을 여는 domain event 다섯마다 고른 방식은 선언 설정
// (`reactions.<event>`)이다. 모양은 contracts(approvals의 reaction grant)에서 이 화면이 쓰는 것만 옮긴 것이다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

/** 새 일을 여는 domain event. 맡긴 call을 닫는 event는 끌 수 없어 여기 없다. */
export const REACTION_EVENTS = [
  "ProblemOpened",
  "ProblemReopened",
  "AppRestartHalted",
  "ReleaseActivationFailed",
  "ContextViolationFound",
] as const;

export type ReactionEvent = typeof REACTION_EVENTS[number];

/** 끔, 열고 묻지 않음, 물음. */
const REACTION_MODES = ["off", "open", "ask"] as const;

export type ReactionMode = typeof REACTION_MODES[number];

export type ReactionModes = Readonly<Record<ReactionEvent, ReactionMode>>;

export interface ReactionsSource {
  /** core 연결 상태를 듣는다. 준비되면 화면이 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  modes(): Promise<SourceResult<ReactionModes>>;
  /** 한 event의 방식을 정한다. 틀린 값이면 code가 거절 이유다. */
  choose(event: ReactionEvent, mode: ReactionMode): Promise<SourceResult<null>>;
}
