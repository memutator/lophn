import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type AgentId,
  isHarnessRuntime,
  type Place,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import {
  type AgentSessionRow,
  loadSession,
  nextSessionSeq,
  placeOf,
} from "../session/model.ts";
import { harnessEnabledIn } from "../session/harness.ts";
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

export function startSession(
  tx: Tx,
  deps: OpenDeps,
  input: {
    id: string;
    agent: AgentId;
    place: Place | null;
    // fork는 출처의 제목, model 선택, 출처 표시를 이어받는다. skip은 가져가지 않는다:
    // 새 session은 정의의 기본값으로 시작한다(place-session의 fork가 허락을 가져가지 않는 것과 같은 이유).
    inherit?: {
      title: string | null;
      model_selection: string | null;
      forked_from: { session: string; through_seq: bigint } | null;
    };
  },
): Result<AgentSessionRow> {
  const definition = deps.agents.agent(input.agent);
  if (definition === null) return fail("not_found", "agent not found");
  // harness runtime의 session은 열 때 그 harness로 정해 바뀌지 않는다. 설정이 꺼져 있으면 열지 않는다.
  const harness = isHarnessRuntime(definition.runtime)
    ? definition.runtime
    : null;
  if (harness !== null && !harnessEnabledIn(tx.sql)) {
    return err({ code: "unavailable", message: "harness is turned off" });
  }
  const place = input.place;
  if (place !== null) {
    const usable = placeUsable(deps, place);
    if (!usable.ok) return usable;
  }
  const seq = nextSessionSeq(tx);
  const kind = place?.kind ?? null;
  const id = place?.id ?? null;
  const inherit = input.inherit;
  tx.sql.run(
    `insert into sessions (id, agent, project, app, place_kind,
       place_id, title, lifecycle, forked_from_session, forked_from_through_seq,
       model_selection, skip, harness, created_seq, state_seq)
     values (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.agent,
      kind === "project" ? id : null,
      kind === "app" ? id : null,
      kind,
      id,
      inherit?.title ?? null,
      inherit?.forked_from?.session ?? null,
      inherit?.forked_from?.through_seq ?? null,
      inherit?.model_selection ?? null,
      definition.skip ? 1 : 0,
      harness,
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
      agent: row.agent,
      place: placeOf(row),
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
