import { err, ok, type Result } from "../../base/mod.ts";
import {
  checkpointRevert,
  finishRevert,
  revertApplied,
  revertBlocked,
  revertFinished,
  revertRun,
  revertStarted,
} from "../../contracts/lophn-agent/mod.ts";
import type { RevertRunGroup } from "./model.ts";
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
  type Capability,
  type ChangeOutcome,
  type ChangeResult,
  decide,
  hasRestorable,
  headSeq,
  loadRevert,
  loadRunRef,
  matchInput,
  type Outcome,
  type ReasonCode,
  resultCounts,
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
// 남으며(R5) 같은 요청을 반복해도 한 번만 적용된다(R8). 앱 되돌림 단계가 있는 revert(R10)는
// ledger 적용 없이 applying 헤더와 미확정 행만 저장하고 끝난다: 실제 앱 호출은 이 command를
// 부른 쪽(productId runtime)이 앱의 선언된 revert command를 직접 부르고, 단계 하나마다
// CheckpointRevert를, 전체가 끝났으면 FinishRevert를 다시 부른다. 단계 기록은 step_key로
// 같은 시도를 한 번만 받고(R8), 시작 전 실패는 blocked, 시작 뒤 실패·충돌·응답 유실은
// 실제 복원·미시작·불명확을 행마다 보존한다(R11). 네트워크와 ledger를 한 transaction으로
// 주장하지 않는다.

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
  insertChanges(tx, input.id, changes);
}

// applying 헤더는 결과 event가 없다(state_seq만, result_seq는 null). 앱 단계 기록이 state_seq를
// 바꾸고 FinishRevert가 최종 결과 event로 result_seq를 한 번 채운다.
function recordApplying(
  tx: Tx,
  input: {
    id: string;
    run: string;
    allow_partial: boolean;
    preview_hash: string;
  },
  seq: string,
  changes: readonly ChangeResult[],
): void {
  tx.sql.run(
    `insert into reverts
       (id, run, allow_partial, outcome, preview_hash, created_seq, state_seq, result_seq)
     values (?, ?, ?, 'applying', ?, ?, ?, null)`,
    [
      input.id,
      input.run,
      input.allow_partial ? 1 : 0,
      input.preview_hash,
      BigInt(seq),
      BigInt(seq),
    ],
  );
  insertChanges(tx, input.id, changes);
}

function insertChanges(
  tx: Tx,
  revert: string,
  changes: readonly ChangeResult[],
): void {
  for (const change of changes) {
    tx.sql.run(
      `insert into revert_changes
         (revert, ordinal, owner, target, capability, result, reason, app_revert)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        revert,
        change.ordinal,
        change.owner,
        change.target,
        change.capability,
        change.result,
        change.reason,
        change.app_revert === null ? null : JSON.stringify(change.app_revert),
      ],
    );
    for (const source of change.source_seqs) {
      tx.sql.run(
        `insert into revert_change_sources (revert, ordinal, source_seq)
         values (?, ?, ?)`,
        [revert, change.ordinal, BigInt(source)],
      );
    }
    for (const restored of change.restored_seqs) {
      tx.sql.run(
        `insert into revert_change_compensations (revert, ordinal, restored_seq)
         values (?, ?, ?)`,
        [revert, change.ordinal, BigInt(restored)],
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
    results: resultCounts(changes),
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

// 앱 단계가 있는 묶음만 골라 원래 호출 역순(ordinal 내림)으로 정렬한다.
function appGroups(groups: readonly RevertGroup[]): RevertGroup[] {
  return groups.filter((group) => group.app_revert !== null)
    .sort((a, b) => b.ordinal - a.ordinal);
}

export function createRevertCommands(deps: RevertDeps): {
  run: CommandDefinition<typeof revertRun>;
  checkpoint: CommandDefinition<typeof checkpointRevert>;
  finish: CommandDefinition<typeof finishRevert>;
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
        const groups = buildGroups(tx, input.run, deps.owners, input.id);
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
        const steps = appGroups(groups);
        // 앱 복원 준비는 문서 restore 준비(prepared)와 같은 입력 항목이다. 앱 단계가 있으면
        // 준비 검사는 그 단계를 부르는 쪽이 direct call에서 한다.
        const readiness = new Map<number, ReasonCode | null>();
        for (const group of groups) {
          if (group.capability !== "reversible") continue;
          if (group.app_revert !== null) continue;
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
        if (steps.length > 0) {
          // 앱 단계가 있다: ledger 적용 없이 applying 헤더·미확정 행만 저장한다(R10).
          // ledger 복원은 FinishRevert가 앱 단계가 모두 끝난 뒤 한다(R11).
          const changes = resultsOf(groups, new Map(), null);
          const seq = tx.emit(revertStarted, input.id, {
            run: input.run,
            preview_hash: input.preview_hash,
            steps: steps.map((group) => group.app_revert!.step_key),
          });
          recordApplying(tx, input, seq, changes);
          return ok({
            id: input.id,
            run: input.run,
            outcome: "applying",
            result_seq: null,
            replayed: false,
          });
        }
        if (!hasRestorable(groups)) {
          return reject("invalid_input", "the run has nothing to restore");
        }
        // 가능한 변경 전체를 나중 변경부터 소유 concern의 새 변경으로 되돌린다. 하나라도 실패하면
        // 오류로 끝나 이 transaction의 모든 복원이 함께 취소된다(일부만 남지 않는다).
        const restored = new Map<number, string[]>();
        const order = groups.filter((group) =>
          group.capability === "reversible"
        )
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
          results: resultCounts(changes),
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
    checkpoint: {
      route: checkpointRevert,
      handle(tx, ctx, input: Input<typeof checkpointRevert>) {
        // 호출은 이 command를 부르는 productId runtime이 하고, 단계 기록만 machine이 한다.
        if (parseActor(ctx.actor)?.kind !== "machine") {
          return reject("forbidden", "only the runtime records a step");
        }
        const revert = loadRevert(tx, input.revert);
        if (revert === undefined) {
          return reject("not_found", "revert not found");
        }
        if (revert.outcome !== "applying") {
          return reject("conflict", "the revert is not applying");
        }
        // step_key 조회로 같은 단계의 반복 기록을 한 번만 받는다(R8).
        const row = tx.sql.get(
          `select ordinal, result, app_revert from revert_changes
           where revert = ? and app_revert is not null
             and json_extract(app_revert, '$.step_key') = ?`,
          [input.revert, input.step_key],
        );
        if (row === undefined) {
          return reject("not_found", "no step has this step_key");
        }
        if (String(row["result"]) !== "unchanged") {
          // 이미 결과가 확정한 단계다. 같은 기록은 다시 바꾸지 않는다(R8).
          if (String(row["result"]) === input.result) {
            return ok({
              revert: input.revert,
              step_key: input.step_key,
              recorded: false,
            });
          }
          return reject(
            "conflict",
            "this step already has a different result",
          );
        }
        const binding = JSON.parse(String(row["app_revert"])) as {
          invocation: string;
        };
        if (binding.invocation !== input.invocation) {
          return reject(
            "invalid_input",
            "the invocation is not the one this step drove",
          );
        }
        // 아직 미확정 unchanged 행만 실제 결과로 바꾼다. 복원된 것은 아니다.
        tx.sql.run(
          `update revert_changes set result = ?, reason = ?
           where revert = ? and ordinal = ?`,
          [
            input.result,
            input.result === "failure" ? "app_failed" : "app_uncertain",
            input.revert,
            Number(row["ordinal"]),
          ],
        );
        // 앱 단계가 있으면 state_seq가 단계마다 바뀐다. revert_changes에는 그 열이 없으므로
        // 헤더 state_seq만 단계마다 바꾼다.
        tx.sql.run(
          `update reverts set state_seq = state_seq + 1 where id = ?`,
          [input.revert],
        );
        return ok({
          revert: input.revert,
          step_key: input.step_key,
          recorded: true,
        });
      },
    },
    finish: {
      route: finishRevert,
      handle(tx, ctx, input: Input<typeof finishRevert>) {
        if (parseActor(ctx.actor)?.kind !== "machine") {
          return reject("forbidden", "only the runtime finishes a revert");
        }
        const revert = loadRevert(tx, input.revert);
        if (revert === undefined) {
          return reject("not_found", "revert not found");
        }
        if (revert.outcome !== "applying") {
          return reject("conflict", "the revert is not applying");
        }
        const rows = tx.sql.all(
          `select ordinal, owner, target, capability, result, reason, app_revert
             from revert_changes where revert = ? order by ordinal`,
          [input.revert],
        );
        const changes: {
          ordinal: number;
          owner: string;
          target: string | null;
          capability: string;
          result: string;
          reason: string | null;
          app_revert: {
            app: string;
            release: string;
            command: string;
            invocation: string;
            step_key: string;
          } | null;
          sources: string[];
        }[] = [];
        for (const row of rows) {
          const sources = tx.sql.all(
            `select cast(source_seq as text) as seq from revert_change_sources
             where revert = ? and ordinal = ? order by source_seq`,
            [input.revert, Number(row["ordinal"])],
          ).map((item) => String(item["seq"]));
          changes.push({
            ordinal: Number(row["ordinal"]),
            owner: String(row["owner"]),
            target: row["target"] === null ? null : String(row["target"]),
            capability: String(row["capability"]),
            result: String(row["result"]),
            reason: row["reason"] === null ? null : String(row["reason"]),
            app_revert: row["app_revert"] === null
              ? null
              : JSON.parse(String(row["app_revert"])),
            sources,
          });
        }
        const app = changes.filter((change) => change.app_revert !== null);
        // step_keys는 모든 앱 단계를 덮는다. 덮지 않으면 입력이 어긋난 것이다.
        if (
          app.length !== input.step_keys.length ||
          !app.every((change) =>
            input.step_keys.includes(change.app_revert!.step_key)
          )
        ) {
          return reject(
            "invalid_input",
            "the step keys are not the steps of this revert",
          );
        }
        // machine이 건넨 groups은 저장된 reversible 묶음의 준비 결과다(R11). source_seqs로
        // 묶음에 맞춘다. 어긋난 묶음은 invalid_input이다.
        const prepared = new Map<number, RevertRunGroup>();
        if (input.groups !== undefined) {
          const bySource = new Map(changes.map((change) => [
            change.sources.join(","),
            change,
          ]));
          for (const given of input.groups) {
            const change = bySource.get(given.source_seqs.join(","));
            if (change === undefined || change.app_revert !== null) {
              return reject(
                "invalid_input",
                "a group is not a stored group of this revert",
              );
            }
            prepared.set(change.ordinal, given);
          }
        }
        // 미확정 단계 하나라도 있으면 결과가 남는다: 기록된 실패는 partial, 기록된 응답
        // 유실과 기록이 없는 단계는 uncertain, 나머지는 전체 적용이다(R11).
        const unrecorded = app.filter((change) =>
          change.result === "unchanged"
        );
        const failed = app.filter((change) => change.result === "failure");
        const uncertain = app.filter((change) => change.result === "uncertain");
        let outcome: Outcome;
        if (uncertain.length + unrecorded.length > 0) {
          outcome = "uncertain";
        } else if (failed.length > 0) {
          outcome = "partial";
        } else {
          outcome = "applied";
        }
        const restored = new Map<number, string[]>();
        if (
          failed.length === 0 && uncertain.length === 0 &&
          unrecorded.length === 0
        ) {
          // 앱 단계가 전부 복원됐을 때만 ledger reversible 묶음을 뒤에서부터 복원한다.
          // 저장된 행은 아직 미확정 placeholder다. 준비가 없으면 그대로 unchanged다.
          const order = [...changes].sort((a, b) => b.ordinal - a.ordinal);
          for (const change of order) {
            if (
              change.capability !== "reversible" || change.app_revert !== null
            ) {
              continue;
            }
            const given = prepared.get(change.ordinal);
            if (given === undefined) continue;
            const owner = ownerOf(change.owner);
            if (owner === undefined) {
              return reject("unavailable", "no owner can restore this group");
            }
            const group: RevertGroup = {
              ordinal: change.ordinal,
              owner: change.owner,
              target: change.target,
              source_seqs: change.sources,
              capability: "reversible",
              reason: null,
              comparison: given.comparison,
              before_ref: null,
              dependencies: [],
              app_revert: null,
            };
            const before = headSeq(tx.sql);
            const done = owner.restore(tx, group, given);
            if (!done.ok) return done;
            restored.set(change.ordinal, seqsBetween(tx.sql, before));
          }
        }
        const finalChanges: ChangeResult[] = changes.map((change) => {
          const seqs = restored.get(change.ordinal) ?? [];
          if (change.app_revert !== null) {
            // 앱 단계: machine이 기록한 결과를 그대로 확정한다. 기록이 없는 단계는
            // 시작했으나 결과를 모르는 것이므로 불명확이다(R11).
            return {
              ordinal: change.ordinal,
              owner: change.owner,
              target: change.target,
              source_seqs: change.sources,
              capability: "reversible",
              result: change.result === "unchanged"
                ? ("uncertain" as ChangeOutcome)
                : (change.result as ChangeOutcome),
              reason: change.result === "unchanged"
                ? "app_uncertain"
                : (change.reason as ReasonCode | null),
              restored_seqs: [],
              app_revert: null,
            };
          }
          // 제약이 견준 값이다(check table 열의 CHECK). 바꾸지 않고 읽는다.
          const capability = change.capability as Capability;
          if (capability === "reversible") {
            return {
              ordinal: change.ordinal,
              owner: change.owner,
              target: change.target,
              source_seqs: change.sources,
              capability,
              result: seqs.length > 0
                ? "restored" as const
                : "unchanged" as const,
              reason: seqs.length > 0
                ? null
                : (change.reason as ReasonCode | null),
              restored_seqs: seqs,
              app_revert: null,
            };
          }
          return {
            ordinal: change.ordinal,
            owner: change.owner,
            target: change.target,
            source_seqs: change.sources,
            capability,
            result: change.result as ChangeOutcome,
            reason: change.reason as ReasonCode | null,
            restored_seqs: seqs,
            app_revert: null,
          };
        });
        const partial = finalChanges.some((change) =>
          change.capability === "irreversible"
        );
        const seq = outcome === "applied"
          ? tx.emit(revertApplied, input.revert, {
            run: revert.run,
            allow_partial: revert.allow_partial,
            partial,
            results: resultCounts(finalChanges),
          })
          : tx.emit(revertFinished, input.revert, {
            run: revert.run,
            outcome,
            results: resultCounts(finalChanges),
          });
        // 최종 행은 이 transaction에서 한 번 확정한다. 나머지 열은 그대로다.
        for (const change of finalChanges) {
          if (restored.has(change.ordinal)) {
            tx.sql.run(
              `update revert_changes
               set result = ?, reason = ?, app_revert = null
               where revert = ? and ordinal = ?`,
              [change.result, change.reason, input.revert, change.ordinal],
            );
            for (const restoredSeq of change.restored_seqs) {
              tx.sql.run(
                `insert into revert_change_compensations (revert, ordinal, restored_seq)
                 values (?, ?, ?)`,
                [input.revert, change.ordinal, BigInt(restoredSeq)],
              );
            }
          } else if (change.result !== "unchanged") {
            tx.sql.run(
              `update revert_changes set app_revert = null
               where revert = ? and ordinal = ?`,
              [input.revert, change.ordinal],
            );
          }
        }
        tx.sql.run(
          `update reverts
           set outcome = ?, state_seq = state_seq + 1, result_seq = ?
           where id = ?`,
          [outcome, BigInt(seq), input.revert],
        );
        return ok({
          id: input.revert,
          run: revert.run,
          outcome,
          result_seq: seq,
          replayed: false,
        });
      },
    },
  };
}
