import { err, ok, type Result } from "../../base/mod.ts";
import {
  revertApplied,
  revertBlocked,
  revertRun,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  type Input,
  type Output,
  parseActor,
  type Tx,
} from "../../contracts/platform/mod.ts";
import {
  activeRevert,
  bindingHash,
  buildGroups,
  type ChangeResult,
  decide,
  hasRestorable,
  headSeq,
  loadRevert,
  loadRunRef,
  matchInput,
  type Outcome,
  type ReasonCode,
  resultsHash,
  resultsOf,
  type RevertGroup,
  type RevertOwner,
  type RevertRecordRow,
  seqsBetween,
} from "./model.ts";

// RevertRun은 종료한 run의 확정 변경 전체를 소유 concern의 새 변경으로 되돌리는 사람의 결정이다.
// 같은 transaction에서 현재 판을 전부 다시 판정해 사람이 본 preview와 비교하고(R3, R4), 막을
// 이유가 없을 때만 복원 가능한 묶음 전체를 한 번에 적용한다(R7). 막으면 어떤 변경도 하지 않고
// 현재 판정의 blocked 결과를 저장한다. 복원은 과거 사실을 지우지 않고 owner의 새 변경으로
// 남으며(R5) 같은 요청을 반복해도 한 번만 적용된다(R8). 앱 복원 단계가 있는 revert는 이
// 작업에 없다(lophn-agent#T48).

export type RevertDeps = {
  // 소유 concern별 분류·복원. 앞선 owner가 먼저 event type을 맡는다.
  owners: readonly RevertOwner[];
};

type Code =
  | "invalid_input"
  | "forbidden"
  | "conflict"
  | "not_found"
  | "unavailable";

function reject(code: Code, message: string): Result<never> {
  return err({ code, message });
}

type Header = Output<typeof revertRun>;

function headerOf(row: RevertRecordRow, replayed: boolean): Header {
  return {
    id: row.id,
    run: row.run,
    outcome: row.outcome,
    result_seq: row.result_seq,
    replayed,
  };
}

function record(
  tx: Tx,
  input: {
    id: string;
    run: string;
    allow_partial: boolean;
    preview_hash: string;
  },
  outcome: Exclude<Outcome, "applying">,
  seq: string,
  changes: readonly ChangeResult[],
): void {
  tx.sql.run(
    `insert into reverts
       (id, run, allow_partial, outcome, preview_hash, created_seq, state_seq, result_seq)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.run,
      input.allow_partial ? 1 : 0,
      outcome,
      input.preview_hash,
      BigInt(seq),
      BigInt(seq),
      BigInt(seq),
    ],
  );
  for (const change of changes) {
    tx.sql.run(
      `insert into revert_changes
         (revert, ordinal, owner, target, capability, result, reason_blob, app_revert)
       values (?, ?, ?, ?, ?, ?, ?, null)`,
      [
        input.id,
        change.ordinal,
        change.owner,
        change.target,
        change.capability,
        change.result,
        change.reason_blob,
      ],
    );
    for (const source of change.source_seqs) {
      tx.sql.run(
        `insert into revert_change_sources (revert, ordinal, source_seq)
         values (?, ?, ?)`,
        [input.id, change.ordinal, BigInt(source)],
      );
    }
    for (const restored of change.restored_seqs) {
      tx.sql.run(
        `insert into revert_change_compensations (revert, ordinal, restored_seq)
         values (?, ?, ?)`,
        [input.id, change.ordinal, BigInt(restored)],
      );
    }
  }
}

function blocked(
  tx: Tx,
  input: Input<typeof revertRun>,
  groups: readonly RevertGroup[],
  reason: ReasonCode,
): Result<Header> {
  const changes = resultsOf(groups, new Map(), reason);
  const seq = tx.emit(revertBlocked, input.id, {
    run: input.run,
    changes: resultsHash(changes),
  });
  record(tx, input, "blocked", seq, changes);
  return ok({
    id: input.id,
    run: input.run,
    outcome: "blocked",
    result_seq: seq,
    replayed: false,
  });
}

export function createRevertCommands(deps: RevertDeps): {
  run: CommandDefinition<typeof revertRun>;
} {
  const ownerOf = (concern: string) =>
    deps.owners.find((owner) => owner.concern === concern);
  return {
    run: {
      route: revertRun,
      handle(tx, ctx, input: Input<typeof revertRun>, compare) {
        // 사람만 요청한다. agent가 대신 적용하거나 원래 run을 다시 시작하는 길은 없다(R2).
        if (parseActor(ctx.actor)?.kind !== "user") {
          return reject("forbidden", "only a person reverts a run");
        }
        if (compare.preview_hash !== input.preview_hash) {
          return reject("conflict", "the decision is not for this preview");
        }
        // 같은 시도의 반복은 저장된 현재 결과를 돌려주고 다시 적용하지 않는다(R8).
        const prior = loadRevert(tx, input.id);
        if (prior !== undefined) {
          if (
            prior.run !== input.run ||
            prior.allow_partial !== input.allow_partial ||
            prior.preview_hash !== input.preview_hash
          ) {
            return reject(
              "conflict",
              "the same revert id had other content",
            );
          }
          return ok(headerOf(prior, true));
        }
        const run = loadRunRef(tx, input.run);
        if (run === undefined) return reject("not_found", "run not found");
        // 진행 중이거나 사람을 기다리는 run은 먼저 멈춰 실제 종료를 확인해야 한다(R1).
        if (run.state !== "finished") {
          return reject("conflict", "the run has not finished");
        }
        if (activeRevert(tx, input.run) !== undefined) {
          return reject("conflict", "the run already has a revert");
        }
        const groups = buildGroups(tx, input.run, deps.owners);
        if (groups.length === 0) {
          return reject("invalid_input", "the run has no confirmed change");
        }
        // 사람이 본 판이 아니면 고정 내용을 적용하지 않고 현재 판정의 blocked 결과를 남긴다.
        // 조용히 고쳐서 적용하지 않는다(R4).
        if (bindingHash(input.run, groups) !== input.preview_hash) {
          return blocked(tx, input, groups, "stale_preview");
        }
        const matched = matchInput(groups, input.groups);
        if (!matched.ok) return matched;
        const readiness = new Map<number, ReasonCode | null>();
        for (const group of groups) {
          if (group.capability !== "reversible") continue;
          const owner = ownerOf(group.owner);
          const item = matched.value.get(group.source_seqs.join(","));
          if (owner === undefined || item === undefined) {
            return reject("unavailable", "no owner can restore this group");
          }
          const ready = owner.ready?.(group, item) ?? ok(null);
          if (!ready.ok) return ready;
          readiness.set(group.ordinal, ready.value);
        }
        const decision = decide(groups, input.allow_partial, readiness);
        if (decision.kind === "blocked") {
          return blocked(tx, input, groups, decision.reason);
        }
        if (!hasRestorable(groups)) {
          return reject("invalid_input", "the run has nothing to restore");
        }
        // 가능한 변경 전체를 나중 변경부터 소유 concern의 새 변경으로 되돌린다. 하나라도 실패하면
        // 오류로 끝나 이 transaction의 모든 복원이 함께 취소된다(일부만 남지 않는다).
        const restored = new Map<number, string[]>();
        const order = groups.filter((group) => group.capability === "reversible")
          .sort((a, b) => b.ordinal - a.ordinal);
        for (const group of order) {
          const owner = ownerOf(group.owner) as RevertOwner;
          const item = matched.value.get(group.source_seqs.join(","));
          const before = headSeq(tx.sql);
          const done = owner.restore(tx, group, item!);
          if (!done.ok) return done;
          restored.set(group.ordinal, seqsBetween(tx.sql, before));
        }
        const changes = resultsOf(groups, restored, null);
        const partial = groups.some((group) =>
          group.capability === "irreversible"
        );
        const seq = tx.emit(revertApplied, input.id, {
          run: input.run,
          allow_partial: input.allow_partial,
          partial,
          changes: resultsHash(changes),
        });
        record(tx, input, "applied", seq, changes);
        return ok({
          id: input.id,
          run: input.run,
          outcome: "applied",
          result_seq: seq,
          replayed: false,
        });
      },
    },
  };
}
