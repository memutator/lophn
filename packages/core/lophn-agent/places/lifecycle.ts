import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type AgentRef,
  type Place,
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
function placeUsable(
  deps: PlaceDeps,
  place: Place,
): Result<void> {
  const info = place.kind === "project"
    ? deps.projects.project(place.id as Id<"prj">)
    : deps.apps.app(place.id as Id<"app">);
  if (info === null) return fail("conflict", "the place does not exist");
  if (info.archived) return fail("conflict", "the place is archived");
  return ok(undefined);
}

// agent가 놓이는 place를 정한다. place를 가진 agent는 그 place가 열 수 있는 곳이어야 한다.
export function placeOfAgent(
  deps: PlaceDeps,
  agent: AgentRef,
): Result<Place | null> {
  let place: Place | null;
  switch (agent.role) {
    case "lophn":
      place = null;
      break;
    case "project_manager":
      place = { kind: "project", id: agent.project };
      break;
    case "app_engineer":
      place = { kind: "app", id: agent.app };
      break;
    case "operator": {
      const operator = deps.operators.operator(agent.agent);
      if (operator === null) return fail("not_found", "operator not found");
      place = operator.place;
      break;
    }
  }
  if (!rolePlaceFits(agent.role, place)) {
    return fail("invalid_input", "the place does not fit the role");
  }
  if (place !== null) {
    const usable = placeUsable(deps, place);
    if (!usable.ok) return usable;
  }
  return ok(place);
}

export type OpeningContext = { source_seq: string; target: string };

export function startSession(
  tx: Tx,
  deps: OpenDeps,
  input: {
    id: string;
    agent: AgentRef;
    opening: OpeningContext | null;
    // fork는 출처의 제목, model 선택, 출처 표시를 이어받는다.
    inherit?: {
      title: string | null;
      model_selection: string | null;
      forked_from: { session: string; through_seq: bigint } | null;
    };
  },
): Result<AgentSessionRow> {
  const place = placeOfAgent(deps, input.agent);
  if (!place.ok) return place;
  const seq = nextSessionSeq(tx);
  const kind = place.value?.kind ?? null;
  const id = place.value?.id ?? null;
  const inherit = input.inherit;
  tx.sql.run(
    `insert into sessions (id, role, project, app, operator, place_kind,
       place_id, title, lifecycle, forked_from_session, forked_from_through_seq,
       opening_source_seq, opening_target, model_selection, created_seq,
       state_seq)
     values (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.agent.role,
      kind === "project" ? id : null,
      kind === "app" ? id : null,
      input.agent.role === "operator" ? input.agent.agent : null,
      kind,
      id,
      inherit?.title ?? null,
      inherit?.forked_from?.session ?? null,
      inherit?.forked_from?.through_seq ?? null,
      input.opening === null ? null : BigInt(input.opening.source_seq),
      input.opening?.target ?? null,
      inherit?.model_selection ?? null,
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
  deps.effects.forgetSessionGrants(id);
  deps.clearInbox(id);
  deps.publish({
    session: id,
    type: "SessionEnded",
    at: tx.now(),
    payload: { reason },
  });
  return ok(undefined);
}
