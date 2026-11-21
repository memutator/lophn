import { ok, type Result } from "../../base/mod.ts";
import type { StepEnding } from "../router/ports.ts";
import type { Sql, Tx } from "../../protocol/server/mod.ts";
import type { HandedLine } from "../../protocol/workflows/mod.ts";
import { STATE_CHANGED_TOPIC } from "../storage/ledger/after-commit.ts";
import type { RemoteStep } from "../../protocol/workflows/mod.ts";
import { readCall } from "../router/mod.ts";
import { lineFromRow } from "./rows.ts";
import { appendLine, loadInstance, updateInstance } from "./store.ts";

// 다른 컴퓨터로 넘긴 step(보낸 쪽 program인 call 행)과 instance를 잇는다. 이은 것은 그 step의 handed 줄(`remote.call`)뿐이다.

type Query = Pick<Sql, "get" | "all">;

// 그 call로 넘긴 handed 줄. 없으면 null이다.
export function remoteHandOf(sql: Query, call: string): HandedLine | null {
  const row = sql.get(
    `SELECT * FROM workflow_lines
     WHERE kind = 'handed' AND json_extract(data, '$.remote.call') = ?`,
    [call],
  );
  if (row === undefined) return null;
  const line = lineFromRow(row);
  return line.ok && line.value.kind === "handed" ? line.value : null;
}

// 그 instance가 다른 컴퓨터로 넘긴 step call 전부(넘긴 순서).
export function remoteCallsOf(sql: Query, instance: string): string[] {
  return sql
    .all(
      `SELECT json_extract(data, '$.remote.call') AS call FROM workflow_lines
       WHERE instance = ? AND kind = 'handed' AND json_extract(data, '$.remote.call') IS NOT NULL
       ORDER BY seq`,
      [instance],
    )
    .map((row) => String(row["call"]));
}

// 그 instance가 다른 컴퓨터로 넘긴 step마다 call 행의 지금 상태. ReadWorkflowInstance가 싣는다.
export function remoteStepsOf(sql: Query, instance: string): RemoteStep[] {
  const steps: RemoteStep[] = [];
  for (const call of remoteCallsOf(sql, instance)) {
    const hand = remoteHandOf(sql, call);
    const row = readCall({ sql }, call as never);
    if (hand?.remote == null || !row.ok || row.value === null) continue;
    steps.push({
      call: hand.remote.call,
      step: hand.step,
      machine: hand.remote.machine,
      computer: hand.remote.computer,
      state: row.value.state,
      delivery: row.value.delivery,
      fail_reason: row.value.fail_reason,
      session: row.value.remote_session,
    });
  }
  return steps;
}

// 사람이 읽는 글. 받는 쪽이 낸 이유마다 다른 컴퓨터에서 무슨 일이 있었는지 말한다.
export function remoteFailureText(
  computer: string,
  reason: StepEnding,
): string {
  switch (reason) {
    case "closed_there":
      return `The step was closed on ${computer} without a report.`;
    case "cancelled_here":
      return `The step was cancelled on this computer before ${computer} reported it.`;
    case "skipped":
      return `The person on ${computer} chose not to run this step.`;
    case "expired":
      return `The step did not reach ${computer} within seven days.`;
    case "old_version":
      return `${computer} runs an older lophn that cannot take this step; update lophn there.`;
    case "not_found":
      return `${computer} has no such agent, workspace or session for this step, or that workspace is private there.`;
    case "closed":
      return `The session on ${computer} is closed or the step was withdrawn.`;
    case "receiver_ended":
      return `The session on ${computer} ended without reporting.`;
    case "lophn_restarted":
      return `lophn on ${computer} restarted before the step was taken.`;
  }
}

// 그 call로 넘긴 step이 다른 컴퓨터에서 돌지 못하고 끝났다. not_handed 줄을 남긴다. 이어 넘기는 일은 agent나 사람의 hand_now다.
export function remoteStepFailed(
  tx: Tx,
  call: string,
  reason: StepEnding,
  announce: (tx: Tx, topic: string, data: unknown) => void,
): Result<void> {
  const hand = remoteHandOf(tx.sql, call);
  if (hand === null) return ok(undefined);
  const loaded = loadInstance(tx.sql, hand.instance);
  if (!loaded.ok) return loaded;
  const instance = loaded.value;
  if (instance === null) return ok(undefined);
  // StopWorkflow가 거둔 step: 같은 command가 남긴 stopped 줄이 말한다(한 command는 instance를 한 번 고친다).
  if (
    reason === "cancelled_here" &&
    lastKind(tx.sql, instance.id) === "stopped"
  ) {
    return ok(undefined);
  }
  appendLine(tx.sql, instance.id, tx.now(), {
    kind: "not_handed",
    by: { kind: "lophn" },
    step: hand.step,
    reason: "remote_failed",
    message: remoteFailureText(hand.remote?.computer ?? "", reason),
  });
  const updated = updateInstance(tx.sql, instance.id, {
    state: instance.state,
    current: instance.current,
    steps: instance.steps,
    finished_at: instance.finished_at,
  });
  if (!updated.ok) return updated;
  remoteStepChanged(tx, call, announce);
  return ok(undefined);
}

function lastKind(sql: Query, instance: string): string | null {
  const row = sql.get(
    "SELECT kind FROM workflow_lines WHERE instance = ? ORDER BY seq DESC LIMIT 1",
    [instance],
  );
  return row === undefined ? null : String(row["kind"]);
}

// 배달 상태가 바뀌었다. instance를 보는 화면이 다시 읽는다(행의 상태는 ReadWorkflowInstance의 remote_steps가 준다).
export function remoteStepChanged(
  tx: Tx,
  call: string,
  announce: (tx: Tx, topic: string, data: unknown) => void,
): void {
  const hand = remoteHandOf(tx.sql, call);
  if (hand === null) return;
  announce(tx, STATE_CHANGED_TOPIC, [
    { name: "workflow_instances", id: hand.instance },
  ]);
}
