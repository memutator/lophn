import { err, ok, type Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import type {
  CommandDefinition,
  Input,
  Output,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { problemSyncDomain } from "../../../protocol/problems/mod.ts";
import { kindViolationFound } from "../../../protocol/events/mod.ts";
import { KINDS_DISPATCH_PRINCIPAL } from "../../../protocol/projects/mod.ts";
import { diffDomainProblems, type ExistingDomainProblem } from "./model.ts";

function handleSyncDomain(
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof problemSyncDomain>,
): Result<Output<typeof problemSyncDomain>, LophnError> {
  if (
    parseActor(ctx.actor)?.kind !== "machine" ||
    ctx.principal !== KINDS_DISPATCH_PRINCIPAL
  ) {
    return err({
      code: "forbidden",
      message: "kind 위반은 kinds dispatcher만 알린다",
    });
  }
  const existing: ExistingDomainProblem[] = tx.sql.all(
    "select id, identity, state, message from domain_problems where domain = ?",
    [input.domain],
  ).map((row) => ({
    id: String(row["id"]),
    identity: String(row["identity"]),
    state: row["state"] === "open" ? "open" : "resolved",
    message: String(row["message"]),
  }));
  const diff = diffDomainProblems({
    existing,
    incoming: input.violations,
    truncated: input.truncated,
  });
  const now = tx.now();
  for (const { id, violation: v, identity } of diff.insert) {
    tx.sql.run(
      `insert into domain_problems
         (id, domain, identity, source, kind, path, field, rule, message, state,
          opened_at, state_changed_at, last_seen_at, seq)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 1)`,
      [
        id,
        input.domain,
        identity,
        v.source,
        v.kind,
        v.path,
        v.field,
        v.rule,
        v.message,
        now,
        now,
        now,
      ],
    );
  }
  for (const { id, message } of diff.reopen) {
    tx.sql.run(
      `update domain_problems
       set state = 'open', message = ?, opened_at = ?, state_changed_at = ?,
           last_seen_at = ?, seq = seq + 1
       where id = ?`,
      [message, now, now, now, id],
    );
  }
  for (const { id, message } of diff.touch) {
    tx.sql.run(
      "update domain_problems set message = ?, last_seen_at = ? where id = ?",
      [message, now, id],
    );
  }
  for (const { id } of diff.resolve) {
    tx.sql.run(
      `update domain_problems
       set state = 'resolved', state_changed_at = ?, seq = seq + 1 where id = ?`,
      [now, id],
    );
  }
  // 이전에 없던 위반이 생겼을 때만 알린다. 줄거나 사라지는 것은 event가 아니다.
  const found = diff.insert.length + diff.reopen.length;
  if (found > 0) {
    tx.emit(kindViolationFound, input.domain, {
      domain: input.domain,
      count: found,
    });
  }
  return ok({
    opened: diff.insert.length,
    reopened: diff.reopen.length,
    resolved: diff.resolve.length,
    unchanged: diff.unchanged,
  });
}

export const syncDomainProblemsCommand: CommandDefinition<
  typeof problemSyncDomain
> = {
  route: problemSyncDomain,
  handle: handleSyncDomain,
};
