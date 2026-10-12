// glossary command가 같이 쓰는 규칙이다: 용어 비교, 쓸 수 있는 actor, 항목 수, event 내기, 거절 모양.
// 검사 순서와 상태 바꾸기는 commands-glossary.ts가 맡는다.
import { err, type ErrorCode, type Result } from "../../../base/mod.ts";
import type { GlossaryEntry } from "../../../contracts/documents/mod.ts";
import { emitEvent } from "./commands-common.ts";
import type {
  ContextApiActor,
  ContextApiDeps,
  ContextApiState,
} from "./state.ts";

export function rejected(code: ErrorCode, message: string): Result<never> {
  return err({ code, message });
}

// 용어 비교 키다. 앞뒤 공백을 자른 뒤 ASCII 대문자만 소문자로 바꾼다. 비ASCII 대소문자는 다른 글자이다.
export function termKey(term: string): string {
  return term.trim().replace(/[A-Z]+/g, (upper) => upper.toLowerCase());
}

// 항목을 쓸 수 있는 actor는 사람과 Context Engineer 역할의 agent뿐이다.
export function isGlossaryWriter(actor: ContextApiActor): boolean {
  return actor.kind === "user" ||
    (actor.kind === "agent" && actor.role === "context_engineer");
}

// 쓰기 주체가 이 항목을 고치거나 지울 수 있는가. isGlossaryWriter를 먼저 통과한 뒤에 쓴다.
// 사람은 어느 항목이든, Context Engineer는 agent가 정한 항목만이다.
export function mayChange(
  actor: ContextApiActor,
  entry: GlossaryEntry,
): boolean {
  return actor.kind === "user" || entry.set_by === "agent";
}

// 뜻을 정한 쪽이다. 사람이면 user, 그 밖의 쓰기 주체는 agent이다.
export function setterOf(actor: ContextApiActor): "user" | "agent" {
  return actor.kind === "user" ? "user" : "agent";
}

export function entriesIn(
  state: ContextApiState,
  context: string,
): GlossaryEntry[] {
  return [...state.glossary.values()].filter((entry) =>
    entry.context === context
  );
}

// 같은 context의 다른 항목이 이 용어를 쓰는가. except는 고치는 항목 자신이라 뺀다.
export function termTaken(
  state: ContextApiState,
  context: string,
  term: string,
  except?: string,
): boolean {
  const key = termKey(term);
  return entriesIn(state, context).some((entry) =>
    entry.id !== except && termKey(entry.term) === key
  );
}

// event 하나를 내고 항목의 revision(event seq)과 updated_at(event 시각)을 돌려준다.
export function emitGlossaryEvent(
  state: ContextApiState,
  deps: ContextApiDeps,
  event: {
    type: string;
    subject: string;
    actor: string;
    payload: Record<string, unknown>;
  },
): { revision: string; at: string } {
  const revision = emitEvent(state, deps, event);
  const at = state.events[state.events.length - 1]!.at;
  return { revision, at };
}
