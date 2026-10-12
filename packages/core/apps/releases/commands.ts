// `release.prepare`: 신뢰된 준비 결과를 불변 prepared Release로 확정한다(apps/releases#R1, R5–R7).
// bundle 준비·테스트는 core 밖에서 끝났고 이 command는 짧은 확정만 한다. machine만 부르며
// coding agent의 통과·hash 주장은 받지 않는다: 같은 bundle hash의 통과한 app test는 Verification
// 사실을 읽는 port로, 새 coding 준비의 ticket claim은 coding-agent의 현재 claim 검사로 이 transaction
// 안에서 다시 확인한다. 긴 준비의 요청 때와 확정 때 모두 검사하므로 요청 쪽도 같은 검사를 부른다.
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type Activation,
  appSchema,
  type DataResult,
  type ReadyAttestation,
  type Release,
  releaseActivated,
  releaseActivationFailed,
  releaseActivationStarted,
  releaseCompleteActivation,
  releaseFailActivation,
  releasePrepare,
  releasePrepareBundle,
  releasePrepared,
  releaseSchema,
  releaseStartActivation,
  releaseSuperseded,
} from "../../../protocol/apps/mod.ts";
import { canonicalJson, validateBlueprint } from "../blueprint/mod.ts";
import { missingSdkPermission } from "./sdk-permissions.ts";
import {
  type ConnectionId,
  TicketClaimCheck,
  type TicketId,
} from "../../../protocol/coding-agent/mod.ts";
import { AppTestVerificationLookupPort } from "../../../protocol/problems/mod.ts";
import {
  type CommandDefinition,
  parseActor,
  type PortKey,
  type RequestContext,
  type Tx,
} from "../../../protocol/server/mod.ts";

import {
  appAccessDenied,
  authorizeApp,
  loadApp,
  replaceApp,
} from "../registration/mod.ts";
import { type AttemptGate, createDataRecordStore } from "../data/mod.ts";
import { activationInProgress, grantsSeq } from "../permissions/mod.ts";
import { manifestBytes } from "./bundle/manifest.ts";
import { declarationsOfBlueprint } from "./facts.ts";
import {
  insertRelease,
  loadActiveRelease,
  loadRelease,
  loadStoredBlueprint,
  nextReleaseNumber,
} from "./store.ts";
import {
  checkStartApproval,
  inProgress,
  ledgerSchema,
  nextEventSeq,
  pathFrom,
  storeActivation,
} from "./activation/state.ts";

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// 없는 앱과 범위 밖 앱은 같은 답이다.
function unreachableTarget(): Result<never> {
  return err({ code: "forbidden", message: "release target is not available" });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// 등록하지 않은 port는 fail-closed로 쓴다(없으면 unavailable).
function portOf<T>(tx: Pick<Tx, "port">, key: PortKey<T>): T | undefined {
  try {
    return tx.port(key);
  } catch {
    return undefined;
  }
}

// 새 coding 준비의 ticket 출처를 현재 claim으로 다시 확인한다. 요청 때 거절한 것과 같은 이유가
// 확정 때에도 거절이다(R6). 검사는 claim 기한을 연장하지 않는다.
export function checkPreparationClaim(
  tx: Pick<Tx, "port" | "now">,
  createdBy: string,
  source: { ticket: string; claim_seq: string } | undefined,
  // 준비 대상 앱. ticket은 이 앱의 것이어야 한다.
  app: string,
): Result<void> {
  const actor = parseActor(createdBy);
  if (actor === undefined) return invalid("created_by is not an actor");
  if (actor.kind !== "coding_agent") {
    return source === undefined
      ? ok(undefined)
      : invalid("ticket source needs a coding agent preparer");
  }
  // 새 coding 준비는 출처 없이 할 수 없다. claim 없는 수리 fallback을 입구로 쓰지 않는다(R6, R7).
  if (source === undefined) {
    return invalid("a coding preparation needs a ticket source");
  }
  const check = portOf(tx, TicketClaimCheck);
  if (check === undefined) {
    return unavailable("ticket claim check is unavailable");
  }
  let checked;
  try {
    checked = check({
      ticket: source.ticket as TicketId,
      claim_seq: source.claim_seq,
      connection: actor.id as ConnectionId,
      now: tx.now(),
    });
  } catch {
    return unavailable("ticket claim check is unavailable");
  }
  if (!checked.ok) return checked;
  if (!checked.value.ok) {
    return conflict(`ticket claim is not current: ${checked.value.reason}`);
  }
  // 다른 앱의 ticket으로 이 앱의 release를 준비하지 못한다. 없는 ticket과 같은 거절이다.
  if (checked.value.app !== app) {
    return conflict("ticket claim is not current: missing");
  }
  return ok(undefined);
}

export function createReleaseCommands(): {
  prepare: CommandDefinition<typeof releasePrepare>;
  prepareBundle: CommandDefinition<typeof releasePrepareBundle>;
  startActivation: CommandDefinition<typeof releaseStartActivation>;
  completeActivation: CommandDefinition<typeof releaseCompleteActivation>;
  failActivation: CommandDefinition<typeof releaseFailActivation>;
} {
  return {
    // activation 시작(apps/releases#R8, R12, R13, R16). 정확한 대상 release의 사람 approval을 적용한
    // 같은 transaction에서만 부른다(`/v1/approvals/apply`). 직접 부르면 approval 한 번 사용이 깨지므로
    // dispatch 전용이다. 앱마다 activation은 하나이고 시작 event의 seq가 그 시도의 이름이다.
    startActivation: {
      route: releaseStartActivation,
      dispatchable: true,
      dispatchOnly: true,
      handle(tx, ctx, input) {
        const found = loadRelease(tx.sql, input.release);
        if (!found.ok) return found;
        const release = found.value;
        if (release === null) return unreachableTarget();
        const app = loadApp(tx.sql, release.app);
        if (!app.ok) return app;
        if (app.value === null) return unreachableTarget();
        const access = authorizeApp(tx.port, ctx, releaseStartActivation.name, {
          kind: "command",
          before: app.value,
          after: app.value,
        });
        if (appAccessDenied(access)) return unreachableTarget();
        if (!access.ok) return access;
        if (app.value.status === "archived") {
          return conflict("archived app cannot activate a release");
        }
        // 이미 채택한 release나 진행 중인 release는 다시 시작하지 않는다.
        if (
          release.status !== "prepared" && release.status !== "superseded" &&
          release.status !== "failed"
        ) {
          return conflict("the release cannot be activated from its status");
        }
        const approved = checkStartApproval(tx, release.id, input);
        if (!approved.ok) return approved;
        if (activationInProgress(tx.sql, release.app)) {
          return conflict("an activation is in progress for the app");
        }
        const active = loadActiveRelease(tx.sql, release.app);
        if (!active.ok) return active;
        if ((active.value?.id ?? null) !== input.previous_release) {
          return conflict("the current release changed");
        }
        if (
          input.expected_grants_seq !== Number(grantsSeq(tx.sql, release.app))
        ) {
          return conflict("the grant set changed");
        }
        const schema = ledgerSchema(tx.sql, release.app);
        if (!schema.ok) return schema;
        if (input.expected_schema !== schema.value) {
          return conflict("the app data schema changed");
        }
        // 현재 schema와 같은 release만 바로 시작하고 다른 schema는 이어지는 앞으로의 경로가 있어야 한다.
        // 뒤로 가는 옛 release는 별도 restore 없이는 시작하지 않는다(R16).
        const path = pathFrom(release, input.expected_schema);
        if (!path.ok) return invalid(path.error.message);
        const startedSeq = nextEventSeq(tx.sql);
        const activation: Activation = {
          started_seq: startedSeq,
          previous_release: input.previous_release,
          approval: input.approval,
          expected_grants_seq: input.expected_grants_seq,
          expected_schema: input.expected_schema,
          backup_hash: null,
          data_change_invocation: null,
        };
        const emitted = tx.emit(releaseActivationStarted, release.id, {
          app: release.app,
          started_seq: startedSeq,
          previous_release: input.previous_release,
          approval: input.approval,
          expected_grants_seq: input.expected_grants_seq,
          expected_schema: input.expected_schema,
        });
        if (emitted !== startedSeq) {
          return err({ code: "internal", message: "activation seq mismatch" });
        }
        storeActivation(tx, release.id, "activating", activation, null);
        return ok({ status: "activating" as const, started_seq: startedSeq });
      },
    },
    // activation 확정(apps/releases#R12, R14). 같은 시도·이전 활성 참조·grant 집합·approval과 실제 데이터
    // 결과·준비 확인(hash·handler·schema)을 다시 확인한 뒤 새 active 참조, 이전 superseded, 앱 이름·설명
    // 갱신(첫 성공은 run_enabled)을 한 transaction으로 바꾼다. 응답을 잃은 재전송은 같은 결과를 돌려준다.
    completeActivation: {
      route: releaseCompleteActivation,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx);
        if (!actor.ok) return actor;
        // 없는 release·범위 밖 앱·다른 시도는 같은 답이다.
        const absent = () => conflict("no such activation is in progress");
        const found = loadRelease(tx.sql, input.release);
        if (!found.ok) return found;
        if (found.value === null) return absent();
        const app = loadApp(tx.sql, found.value.app);
        if (!app.ok) return app;
        if (app.value === null) return absent();
        const access = authorizeApp(
          tx.port,
          ctx,
          releaseCompleteActivation.name,
          { kind: "command", before: app.value, after: app.value },
        );
        if (!access.ok) {
          return appAccessDenied(access) ? absent() : access;
        }
        const finished = found.value;
        if (
          finished.status === "active" &&
          finished.activation?.started_seq === input.started_seq
        ) {
          return ok({
            status: "active" as const,
            previous_release: finished.activation.previous_release,
          });
        }
        const progress = inProgress(finished, input.started_seq);
        if (!progress.ok) return progress;
        const release = progress.value;
        const activation = release.activation;
        const active = loadActiveRelease(tx.sql, release.app);
        if (!active.ok) return active;
        if ((active.value?.id ?? null) !== activation.previous_release) {
          return conflict("the current release changed");
        }
        if (
          activation.expected_grants_seq !==
            Number(grantsSeq(tx.sql, release.app))
        ) {
          return conflict("the grant set changed");
        }
        const approval = tx.sql.get(
          "SELECT accepted_seq FROM approval_uses WHERE approval = ?",
          [activation.approval],
        );
        if (
          approval === undefined ||
          String(approval.accepted_seq) !== activation.started_seq
        ) {
          return conflict("the approval is not the one that started this");
        }
        const stored = loadStoredBlueprint(tx.sql, release.id);
        if (!stored.ok) return stored;
        if (stored.value === null) return absent();
        const proven = checkReady(tx, release, activation, input, stored.value);
        if (!proven.ok) return proven;
        const nextApp = {
          ...app.value,
          name: stored.value.blueprint.name,
          description: stored.value.blueprint.description,
          active_release: release.id,
          // 첫 성공만 실행을 허용한다. 사람이 멈춘 앱의 다음 release가 실행 허용을 되돌리지 않는다.
          run_enabled: active.value === null ? true : app.value.run_enabled,
        };
        if (active.value !== null) {
          storeActivation(
            tx,
            active.value.id,
            "superseded",
            active.value.activation,
            active.value.failure,
          );
          tx.emit(releaseSuperseded, active.value.id, {
            release: release.id,
            started_seq: input.started_seq,
          });
        }
        storeActivation(tx, release.id, "active", activation, null);
        const seq = tx.emit(releaseActivated, release.id, {
          started_seq: input.started_seq,
          previous_release: activation.previous_release,
          data_schema: release.data_schema,
        });
        const next = appSchema.safeParse({ ...nextApp, revision: seq });
        if (!next.success) {
          return unavailable("blueprint name and description are not valid");
        }
        const replaced = replaceApp(tx, next.data);
        if (!replaced.ok) return replaced;
        return ok({
          status: "active" as const,
          previous_release: activation.previous_release,
        });
      },
    },
    // activation 실패(apps/releases#R15). 실패 근거와 이전 활성 참조를 남기고 알림 계기 event를 낸다.
    // 데이터가 바뀌었을 수 있는 시도(backup 확정)는 복원 결과가 있어야 실패로 닫는다.
    failActivation: {
      route: releaseFailActivation,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx);
        if (!actor.ok) return actor;
        const absent = () => conflict("no such activation is in progress");
        const found = loadRelease(tx.sql, input.release);
        if (!found.ok) return found;
        if (found.value === null) return absent();
        const app = loadApp(tx.sql, found.value.app);
        if (!app.ok) return app;
        if (app.value === null) return absent();
        const access = authorizeApp(
          tx.port,
          ctx,
          releaseFailActivation.name,
          { kind: "command", before: app.value, after: app.value },
        );
        if (!access.ok) {
          return appAccessDenied(access) ? absent() : access;
        }
        if (
          found.value.status === "failed" &&
          found.value.activation?.started_seq === input.started_seq
        ) {
          return ok({ status: "failed" as const });
        }
        const progress = inProgress(found.value, input.started_seq);
        if (!progress.ok) return progress;
        const release = progress.value;
        const records = createDataRecordStore(tx);
        if (
          release.activation.backup_hash !== null &&
          records.find(release.id, input.started_seq, "restore") === null
        ) {
          return conflict("the backed up data is not restored");
        }
        const activation: Activation = {
          ...release.activation,
          data_change_invocation: input.invocation ??
            release.activation.data_change_invocation,
        };
        storeActivation(tx, release.id, "failed", activation, input.failure);
        tx.emit(releaseActivationFailed, release.id, {
          started_seq: input.started_seq,
          failure: input.failure,
          ...(input.invocation === undefined
            ? {}
            : { invocation: input.invocation }),
        });
        return ok({ status: "failed" as const });
      },
    },
    // 준비 접수의 요청 때 검사다(apps/releases#R6). 앱 범위·source 연결·ticket claim을 이 transaction에서
    // 확인하고 아무것도 기록하지 않는다. 실제 준비는 supervisor 메모리 진행이고 core는 이 검사를 통과한
    // 요청만 그쪽으로 넘긴다(apps/core/apps-control.ts의 `withReleasePreparation`). 범위 밖·없는 앱·
    // source가 없는 앱은 같은 거절이다.
    prepareBundle: {
      route: releasePrepareBundle,
      handle(tx, ctx, input) {
        const kind = parseActor(ctx.actor)?.kind;
        if (kind !== "coding_agent" && kind !== "machine") {
          return unreachableTarget();
        }
        const app = loadApp(tx.sql, input.app);
        if (!app.ok) return app;
        if (app.value === null || app.value.source_path === null) {
          return unreachableTarget();
        }
        const access = authorizeApp(tx.port, ctx, releasePrepareBundle.name, {
          kind: "app",
          app: app.value,
        });
        if (appAccessDenied(access)) return unreachableTarget();
        if (!access.ok) return access;
        if (app.value.status === "archived") {
          return conflict("archived app cannot prepare a release");
        }
        if (input.ticket_source !== undefined) {
          const claim = checkPreparationClaim(
            tx,
            ctx.actor,
            input.ticket_source,
            input.app,
          );
          if (!claim.ok) return claim;
        }
        return ok({
          request_key: input.request_key,
          status: "preparing" as const,
          bundle_hash: null,
          blueprint_hash: null,
          manifest: null,
        });
      },
    },
    prepare: {
      route: releasePrepare,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx);
        if (!actor.ok) return actor;
        const app = loadApp(tx.sql, input.app);
        if (!app.ok) return app;
        if (app.value === null) return unreachableTarget();
        const access = authorizeApp(tx.port, ctx, releasePrepare.name, {
          kind: "app",
          app: app.value,
        });
        if (appAccessDenied(access)) return unreachableTarget();
        if (!access.ok) return access;
        if (app.value.status === "archived") {
          return conflict("archived app cannot prepare a release");
        }
        // 정규 blueprint는 검증기를 통과한 것만 hash로 고정한다(apps/blueprint#R16).
        const validated = validateBlueprint(input.blueprint, {
          app: input.app,
        });
        if (!validated.ok) return invalid(validated.error.message);
        const blueprint = validated.value;
        const canonical = canonicalJson(blueprint as never);
        if (sha256(canonical) !== input.blueprint_hash) {
          return invalid("blueprint does not match its hash");
        }
        // bundle 안 manifest가 실제로 이 blueprint와 이 hash를 가리켜야 한다.
        const manifest = input.manifest;
        if (
          sha256(new TextDecoder().decode(manifestBytes(manifest))) !==
            input.bundle_hash
        ) {
          return invalid("manifest does not match the bundle hash");
        }
        const pinned = manifest.files.find((file) =>
          file.path === "blueprint.json"
        );
        if (pinned?.hash !== input.blueprint_hash) {
          return invalid("bundle blueprint.json does not match the blueprint");
        }
        if (
          canonicalJson(blueprint.sdk_dependencies as never) !==
            canonicalJson(
              [...manifest.sdk_dependencies].sort((a, b) =>
                a.name.localeCompare(b.name)
              ) as never,
            )
        ) {
          return invalid("manifest sdk dependencies differ from the blueprint");
        }
        const missing = missingSdkPermission(blueprint);
        if (missing !== undefined) {
          return err({
            code: "invalid_input",
            message: missing.message,
            details: {
              package: missing.package,
              permissions: [...missing.permissions],
            },
          });
        }
        const chain = checkDataChanges(input.data_changes, input.data_schema);
        if (!chain.ok) return chain;
        const tests = checkTests(tx, input);
        if (!tests.ok) return tests;
        const claim = checkPreparationClaim(
          tx,
          input.created_by,
          input.ticket_source,
          input.app,
        );
        if (!claim.ok) return claim;
        const id = tx.newId("rel");
        const declarations = declarationsOfBlueprint(id, blueprint);
        if (declarations === undefined) {
          return invalid("blueprint automations do not match their commands");
        }
        const release = releaseSchema.safeParse({
          id,
          app: input.app,
          number: nextReleaseNumber(tx.sql, input.app),
          code_commit: input.commit,
          bundle_hash: input.bundle_hash,
          blueprint_hash: input.blueprint_hash,
          data_schema: input.data_schema,
          data_changes: input.data_changes,
          tests: [...input.tests].sort(),
          ticket_source: input.ticket_source ?? null,
          created_by: input.created_by,
          created_at: tx.now(),
          status: "prepared",
          activation: null,
          failure: null,
        });
        if (!release.success) return invalid("invalid release");
        tx.emit(releasePrepared, id, {
          app: release.data.app,
          number: release.data.number,
          code_commit: release.data.code_commit,
          bundle_hash: release.data.bundle_hash,
          blueprint_hash: release.data.blueprint_hash,
          data_schema: release.data.data_schema,
          data_changes: release.data.data_changes,
          tests: release.data.tests,
          ticket_source: release.data.ticket_source,
          created_by: release.data.created_by,
        });
        insertRelease(tx, release.data, canonical, declarations);
        return ok({ release: release.data });
      },
    },
  };
}

function requireMachine(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine"
    ? ok(undefined)
    : err({ code: "forbidden", message: "release.prepare is machine only" });
}

// migration 단계는 끊김 없이 이어지고 마지막 도착이 release의 schema다(apps/data#R3).
function checkDataChanges(
  changes: readonly { from: number; to: number }[],
  dataSchema: number,
): Result<void> {
  for (let index = 1; index < changes.length; index++) {
    if (changes[index].from !== changes[index - 1].to) {
      return invalid("data changes are not a continuous path");
    }
  }
  if (changes.length > 0 && changes[changes.length - 1].to !== dataSchema) {
    return invalid("data changes do not end at the data schema");
  }
  return ok(undefined);
}

// 같은 bundle hash의 통과한 이 앱 app test만 근거다. 다른 앱·다른 종류·다른 hash의 통과와
// 없는 참조는 구별 없이 같은 거절이다(R5).
function checkTests(
  tx: Pick<Tx, "port">,
  input: { app: string; bundle_hash: string; tests: readonly string[] },
): Result<void> {
  const lookup = portOf(tx, AppTestVerificationLookupPort);
  if (lookup === undefined) {
    return unavailable("app test records are unavailable");
  }
  for (const id of input.tests) {
    let found;
    try {
      found = lookup(id);
    } catch {
      return unavailable("app test records are unavailable");
    }
    if (!found.ok) return found;
    const fact = found.value;
    if (
      fact === null || fact.app !== input.app || fact.kind !== "app_test" ||
      fact.bundle_hash !== input.bundle_hash
    ) {
      return invalid("tests must be app tests of the same bundle hash");
    }
    if (fact.result !== "pass") {
      return unavailable("the app test did not pass");
    }
  }
  return ok(undefined);
}

// complete가 확인하는 실제 데이터 결과와 준비 확인이다(apps/releases#R14). hash·handler·schema·연결이 하나라도
// 맞지 않으면 채택하지 않는다. 필요한 migration이 backup 확정과 변경 결과 없이 끝났다는 주장도 받지 않는다.
function checkReady(
  tx: Pick<Tx, "sql">,
  release: Release,
  activation: Activation,
  input: {
    started_seq: string;
    result: DataResult;
    attestation: ReadyAttestation;
  },
  stored: { declarations: { commands: readonly string[] } },
): Result<void> {
  const { result, attestation } = input;
  if (
    result.release !== release.id || result.activation_seq !== input.started_seq
  ) {
    return conflict("the data result is for another activation");
  }
  if (!result.integrity_ok || result.data_schema !== release.data_schema) {
    return unavailable("the app data is not at the release schema");
  }
  if (release.data_schema !== activation.expected_schema) {
    const records = createDataRecordStore(tx);
    const backup = records.find(release.id, input.started_seq, "backup");
    const change = records.find(release.id, input.started_seq, "change");
    if (
      backup === null || change === null ||
      change.dataSchema !== release.data_schema ||
      result.invocation !== change.invocation
    ) {
      return unavailable("the data change is not recorded");
    }
  }
  const declared = [...stored.declarations.commands].sort();
  const reported = [...attestation.commands].sort();
  if (
    attestation.release !== release.id ||
    attestation.bundle_hash !== release.bundle_hash ||
    attestation.data_schema !== release.data_schema ||
    declared.length !== reported.length ||
    declared.some((key, index) => key !== reported[index])
  ) {
    return unavailable("the started app does not match the release");
  }
  return ok(undefined);
}

// record_backup·record_data_change·record_data_restore가 부르는 시도 확인이다(apps/data#R4). 진행 중인 같은
// 시도의 release만 받고 비교 기준(실제 schema)이 다르면 conflict다. 확정한 참조는 그 시도에 남긴다.
export const activationAttemptGate: AttemptGate = {
  check(tx, attempt) {
    const found = loadRelease(tx.sql, attempt.release);
    if (!found.ok) return found;
    const progress = inProgress(found.value, attempt.activationSeq);
    if (!progress.ok) return progress;
    const release = progress.value;
    const expected = release.activation.expected_schema;
    if (attempt.kind === "backup") {
      if (attempt.dataSchema !== expected) {
        return conflict("the backup is not of the expected schema");
      }
      if (release.data_schema === expected) {
        return conflict("the release needs no data change");
      }
    }
    if (
      attempt.kind === "change" && attempt.dataSchema !== release.data_schema
    ) {
      return conflict("the data is not at the release schema");
    }
    if (attempt.kind === "restore" && attempt.dataSchema !== expected) {
      return conflict("the restored data is not at the expected schema");
    }
    return ok(undefined);
  },
  record(tx, attempt) {
    if (attempt.kind === "restore") return;
    const found = loadRelease(tx.sql, attempt.release);
    if (!found.ok || found.value === null || found.value.activation === null) {
      return;
    }
    const activation: Activation = {
      ...found.value.activation,
      ...(attempt.kind === "backup" ? { backup_hash: attempt.backupHash } : {}),
      ...(attempt.kind === "change"
        ? { data_change_invocation: attempt.invocation }
        : {}),
    };
    storeActivation(
      tx,
      attempt.release,
      found.value.status,
      activation,
      found.value.failure,
    );
  },
};
