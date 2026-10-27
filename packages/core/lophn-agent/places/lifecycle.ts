import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  agentIdentityOf,
  type AgentRef,
  type Place,
  placeOfAgentRef,
  rolePlaceFits,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import {
  agentRefOf,
  type AgentSessionRow,
  loadSession,
  nextSessionSeq,
  placeOf,
} from "../session/model.ts";
import type { EndDeps, OpenDeps, PlaceDeps } from "./ports.ts";

// session을 열고 끝내는 규칙. command(`OpenSession`, `ArchiveSession`, `DeleteSession`)와 Router의
// SessionDirectory가 같이 쓴다.

function fail<T = never>(
  code: "not_found" | "conflict" | "invalid_input",
  message: string,
): Result<T> {
  return err({ code, message });
}

// place(project나 앱)가 지금 session을 열 수 있는 곳인지. 없거나 보관됐으면 conflict다.
function placeUsable(deps: PlaceDeps, place: Place): Result<void> {
  const info =
    place.kind === "project"
      ? deps.projects.project(place.id as Id<"prj">)
      : deps.apps.app(place.id as Id<"app">);
  if (info === null) return fail("conflict", "the place does not exist");
  if (info.archived) return fail("conflict", "the place is archived");
  return ok(undefined);
}

// agent가 놓이는 place와 새 session의 skip 기본값(Operator 정의의 칸, Operator가 아니면 false)을 정한다.
// place를 가진 agent는 그 place가 열 수 있는 곳이어야 한다.
function placeOfAgent(
  deps: PlaceDeps,
  agent: AgentRef,
): Result<{ place: Place | null; skip: boolean }> {
  let place = placeOfAgentRef(agent);
  let skip = false;
  if (place === undefined) {
    const operator = deps.operators.operator(agentIdentityOf(agent).value!);
    if (operator === null) return fail("not_found", "operator not found");
    place = operator.place;
    skip = operator.skip;
  }
  if (!rolePlaceFits(agent.role, place)) {
    return fail("invalid_input", "the place does not fit the role");
  }
  if (place !== null) {
    const usable = placeUsable(deps, place);
    if (!usable.ok) return usable;
  }
  return ok({ place, skip });
}

export function startSession(
  tx: Tx,
  deps: OpenDeps,
  input: {
    id: string;
    agent: AgentRef;
    // fork는 출처의 제목, model 선택, 출처 표시를 이어받는다. skip은 가져가지 않는다:
    // 새 session은 정의의 기본값으로 시작한다(place-session의 fork가 허락을 가져가지 않는 것과 같은 이유).
    inherit?: {
      title: string | null;
      model_selection: string | null;
      forked_from: { session: string; through_seq: bigint } | null;
    };
  },
): Result<AgentSessionRow> {
  const opened = placeOfAgent(deps, input.agent);
  if (!opened.ok) return opened;
  const place = opened.value.place;
  const seq = nextSessionSeq(tx);
  const kind = place?.kind ?? null;
  // place를 ref가 말하지 못하는 agent(Operator)는 자기 ID가 정체성 열에 들어간다.
  const operatorId =
    placeOfAgentRef(input.agent) === undefined
      ? agentIdentityOf(input.agent).value
      : null;
  const id = place?.id ?? null;
  const inherit = input.inherit;
  tx.sql.run(
    `insert into sessions (id, role, project, app, operator, place_kind,
       place_id, title, lifecycle, forked_from_session, forked_from_through_seq,
       model_selection, skip, created_seq, state_seq)
     values (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.agent.role,
      kind === "project" ? id : null,
      kind === "app" ? id : null,
      operatorId,
      kind,
      id,
      inherit?.title ?? null,
      inherit?.forked_from?.session ?? null,
      inherit?.forked_from?.through_seq ?? null,
      inherit?.model_selection ?? null,
      opened.value.skip ? 1 : 0,
      seq,
      seq,
    ],
  );
  const row = loadSession(tx, input.id)!;
  deps.publish({
    session: row.id as Id<"ses">,
    type: "SessionStarted",
    at: tx.now(),
    payload: {
      agent: agentRefOf(row),
      place: placeOf(row),
      external_session: null,
      revived: false,
    },
  });
  return ok(row);
}

// archive와 지움이 묶는 영향이다. 모두 같은 tx 안이다. 보낸 call의 답은 받은 session에만 남으므로 하지 않는다.
export function endSession(
  tx: Tx,
  deps: EndDeps,
  session: AgentSessionRow,
  reason: "archived" | "deleted",
): Result<void> {
  const id = session.id as Id<"ses">;
  const interrupted = deps.interruptRunningTurns(tx, id);
  if (!interrupted.ok) return interrupted;
  const failed = deps.effects.failReceivedCalls(tx, id);
  if (!failed.ok) return failed;
  const cancelled = deps.effects.cancelPendingRequests(tx, id);
  if (!cancelled.ok) return cancelled;
  deps.clearInbox(tx, id);
  deps.publish(tx, {
    session: id,
    type: "SessionEnded",
    at: tx.now(),
    payload: { reason },
  });
  return ok(undefined);
}
