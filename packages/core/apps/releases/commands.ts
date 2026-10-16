// `release.prepare`: 신뢰된 준비 결과를 불변 prepared Release로 확정한다.
// bundle 준비·테스트는 core 밖에서 끝났고 이 command는 짧은 확정만 한다. machine만 부르며
// coding agent의 통과·hash 주장은 받지 않는다: 같은 bundle hash의 통과한 app test는 Verification
// 사실을 읽는 port로, 준비의 ticket claim은 coding-agent의 현재 claim 검사로 이 transaction
// 안에서 다시 확인한다. 긴 준비의 요청 때와 확정 때 모두 검사하므로 요청 쪽도 같은 검사를 부른다.
// activation 쪽 command는 activation driver가 machine 자격으로 순서대로 부른다(activation/assembly.ts).
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  activationActivatePrevious,
  type ActivationAttempt,
  activationComplete,
  type ActivationDataResult,
  activationFail,
  activationStart,
  appSchema,
  type ReadyAttestation,
  type Release,
  releasePrepare,
  releasePrepareBundle,
  type ReleaseRecord,
  releaseRecordSchema,
} from "../../../protocol/apps/mod.ts";
import { releaseActivationFailed } from "../../../protocol/events/mod.ts";
import { canonicalJson, validateBlueprint } from "../blueprint/mod.ts";
import { missingSdkPermission } from "./sdk-permissions.ts";
import {
  type ConnectionId,
  TicketClaimCheck,
  type TicketId,
} from "../../../protocol/coding-agent/mod.ts";
import { AppTestVerificationLookupPort } from "../../../protocol/problems/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor, type PortKey } from "../../../protocol/base/mod.ts";

import {
  appAccessDenied,
  authorizeApp,
  loadApp,
  replaceApp,
} from "../registration/mod.ts";
import {
  type AttemptGate,
  createDataRecordStore,
  discardBackups,
} from "../data/mod.ts";
import { syncAppGrants } from "../permissions/mod.ts";
import { manifestBytes } from "./bundle/manifest.ts";
import { declarationsOfBlueprint } from "./facts.ts";
import {
  insertRelease,
  loadActiveRelease,
  loadRelease,
  loadStoredBlueprint,
  nextReleaseNumber,
} from "./store.ts";
import { inProgress, storeActivation } from "./activation/state.ts";

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

// 준비의 ticket 출처를 현재 claim으로 다시 확인한다. 요청 때 거절한 것과 같은 이유가
// 확정 때에도 거절이다. 검사는 claim 기한을 연장하지 않는다. 준비는 언제나 맡은 ticket의 지금 claim 아래에서만
// 받는다: coding agent가 아니거나 출처가 없으면 거절이다.
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
    return invalid("a release is prepared by a coding agent");
  }
  if (source === undefined) {
    return invalid("a release preparation needs a ticket source");
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

// release의 앱을 읽고 이 command를 낼 자격이 있는지 본다. 없는 release·없는 앱·범위 밖 앱은 같은 답이다.
function releaseAndApp(
  tx: Pick<Tx, "sql" | "port">,
  ctx: RequestContext,
  operation: string,
  releaseId: string,
  absent: () => Result<never>,
): Result<{
  release: ReleaseRecord;
  app: NonNullable<
    ReturnType<typeof loadApp> extends Result<infer A> ? A : never
  >;
}> {
  const found = loadRelease(tx.sql, releaseId);
  if (!found.ok) return found;
  if (found.value === null) return absent();
  const app = loadApp(tx.sql, found.value.app);
  if (!app.ok) return app;
  if (app.value === null) return absent();
  const access = authorizeApp(tx.port, ctx, operation, {
    kind: "command",
    before: app.value,
    after: app.value,
  });
  if (!access.ok) return appAccessDenied(access) ? absent() : access;
  return ok({ release: found.value, app: app.value });
}

// 앱 grant를 맞추는 새 revision이다. 이름·설명이 바뀌므로 revision도 바꾸어 CAS가 변경을 보게 한다.
// 이미 지난 event seq를 쓰면 앞으로 낼 event의 seq와 겹치지 않는다.
function nextRevision(tx: Pick<Tx, "sql">, current: string): string {
  const head = BigInt(
    String(
      tx.sql.get("SELECT COALESCE(MAX(seq), 0) AS head FROM events", [])
        ?.head ?? 0,
    ),
  );
  const now = BigInt(current);
  return String(head > now ? head : now + 1n);
}

// 한 앱에 activation이 진행 중이면 그 release다.
function activatingOf(tx: Pick<Tx, "sql">, app: string): string | null {
  const row = tx.sql.get(
    "SELECT id FROM releases WHERE app = ? AND status = 'activating'",
    [app],
  );
  return row === undefined ? null : String(row.id);
}

function outputRelease(release: ReleaseRecord): Release {
  return {
    ...release,
    activation: null,
    failure: null,
  };
}

export function createReleaseCommands(): {
  prepare: CommandDefinition<typeof releasePrepare>;
  prepareBundle: CommandDefinition<typeof releasePrepareBundle>;
  startActivation: CommandDefinition<typeof activationStart>;
  completeActivation: CommandDefinition<typeof activationComplete>;
  failActivation: CommandDefinition<typeof activationFail>;
  activatePrevious: CommandDefinition<typeof activationActivatePrevious>;
} {
  return {
    // activation 시작. Reactor handler가 줄에 세운 앱의 차례가 되면 driver가 machine 자격으로 부른다.
    // 시작 때는 CAS를 하지 않는다: 무엇을 activate하는지는 줄에 세울 때 정해졌고, 데이터의 실제 상태는
    // 종료를 확인한 뒤 읽는다. 앱마다 시도는 하나다.
    startActivation: {
      route: activationStart,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx, "activation.start");
        if (!actor.ok) return actor;
        const found = releaseAndApp(
          tx,
          ctx,
          activationStart.name,
          input.release,
          unreachableTarget,
        );
        if (!found.ok) return found;
        const { release, app } = found.value;
        if (app.status === "archived") {
          return conflict("archived app cannot activate a release");
        }
        if (release.status !== "prepared" && release.status !== "superseded") {
          return conflict("the release cannot be activated from its status");
        }
        if (activatingOf(tx, release.app) !== null) {
          return conflict("an activation is in progress for the app");
        }
        const active = loadActiveRelease(tx.sql, release.app);
        if (!active.ok) return active;
        // 이전 release로 돌아가기는 데이터를 바꾸지 않는 release만이다.
        if (
          release.status === "superseded" &&
          active.value?.data_schema !== release.data_schema
        ) {
          return invalid("the data schema differs from the active release");
        }
        const activation: ActivationAttempt = {
          attempt: tx.newId("act"),
          previous_release: active.value?.id ?? null,
          backup_hash: null,
          data_change_invocation: null,
          started_at: tx.now(),
        };
        storeActivation(tx, release.id, "activating", activation, null);
        tx.sql.run("DELETE FROM activation_requests WHERE release = ?", [
          release.id,
        ]);
        return ok({
          attempt: activation.attempt,
          previous_release: activation.previous_release,
        });
      },
    },
    // activation 확정. 같은 시도와 실제 데이터 결과·준비 확인(hash·handler·schema)을 확인한 뒤 새 active 참조,
    // 이전 superseded, 앱 이름·설명 갱신(첫 성공은 run_enabled), 앱 grant 맞추기, 복구본 정리를 한 transaction으로
    // 바꾼다. 응답을 잃은 재전송은 같은 결과를 돌려준다. 성공은 event가 아니다.
    completeActivation: {
      route: activationComplete,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx, "activation.complete");
        if (!actor.ok) return actor;
        // 없는 release·범위 밖 앱·다른 시도는 같은 답이다.
        const absent = () => conflict("no such activation is in progress");
        const found = releaseAndApp(
          tx,
          ctx,
          activationComplete.name,
          input.release,
          absent,
        );
        if (!found.ok) return found;
        const { app } = found.value;
        const finished = found.value.release;
        if (
          finished.status === "active" &&
          finished.activation?.attempt === input.attempt
        ) {
          return ok({
            status: "active" as const,
            previous_release: finished.activation.previous_release,
          });
        }
        const progress = inProgress(finished, input.attempt);
        if (!progress.ok) return progress;
        const release = progress.value;
        const activation = release.activation;
        const active = loadActiveRelease(tx.sql, release.app);
        if (!active.ok) return active;
        if ((active.value?.id ?? null) !== activation.previous_release) {
          return conflict("the current release changed");
        }
        const stored = loadStoredBlueprint(tx.sql, release.id);
        if (!stored.ok) return stored;
        if (stored.value === null) return absent();
        const proven = checkReady(tx, release, activation, input, stored.value);
        if (!proven.ok) return proven;
        const at = tx.now();
        const nextApp = {
          ...app,
          name: stored.value.blueprint.name,
          description: stored.value.blueprint.description,
          active_release: release.id,
          // 첫 성공만 실행을 허용한다. 사람이 멈춘 앱의 다음 release가 실행 허용을 되돌리지 않는다.
          run_enabled: active.value === null ? true : app.run_enabled,
          revision: nextRevision(tx, app.revision),
        };
        if (active.value !== null) {
          storeActivation(
            tx,
            active.value.id,
            "superseded",
            active.value.activation,
            active.value.failure,
          );
        }
        storeActivation(tx, release.id, "active", activation, null, at);
        const next = appSchema.safeParse(nextApp);
        if (!next.success) {
          return unavailable("blueprint name and description are not valid");
        }
        const replaced = replaceApp(tx, next.data);
        if (!replaced.ok) return replaced;
        // 시작은 Gate가 묻지 않았거나 사람이 허락한 경우뿐이라 늘어난 선언에 grant를 만들 수 있다.
        // 새 선언이 더는 요구하지 않는 grant는 거둔다(앱 grant는 새 선언과의 교집합).
        const synced = syncAppGrants(
          tx,
          release.app,
          stored.value.declarations,
          "granted",
        );
        if (!synced.ok) return synced;
        // 복구본은 필요 없다. 기다리던 이전으로 돌아가기 요청도 이 앱의 지금 상태에서는 낡았다.
        const discarded = discardBackups(tx, release.app);
        if (!discarded.ok) return discarded;
        tx.sql.run(
          `DELETE FROM activation_requests
            WHERE release IN (SELECT id FROM releases WHERE app = ?)`,
          [release.app],
        );
        return ok({
          status: "active" as const,
          previous_release: activation.previous_release,
        });
      },
    },
    // activation 실패. 실패 근거와 이전 활성 참조를 남기고 그 앱의 App Engineer를 부를 domain event를 같은
    // transaction에 쓴다. 데이터가 바뀌었을 수 있는 시도(backup 확정)는 복원 결과가 있어야 실패로 닫는다.
    failActivation: {
      route: activationFail,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx, "activation.fail");
        if (!actor.ok) return actor;
        const absent = () => conflict("no such activation is in progress");
        const found = releaseAndApp(
          tx,
          ctx,
          activationFail.name,
          input.release,
          absent,
        );
        if (!found.ok) return found;
        if (
          found.value.release.status === "failed" &&
          found.value.release.activation?.attempt === input.attempt
        ) {
          return ok({ status: "failed" as const });
        }
        const progress = inProgress(found.value.release, input.attempt);
        if (!progress.ok) return progress;
        const release = progress.value;
        const records = createDataRecordStore(tx);
        if (
          release.activation.backup_hash !== null &&
          records.find(release.id, input.attempt, "restore") === null
        ) {
          return conflict("the backed up data is not restored");
        }
        const activation: ActivationAttempt = {
          ...release.activation,
          data_change_invocation: input.invocation ??
            release.activation.data_change_invocation,
        };
        storeActivation(tx, release.id, "failed", activation, input.failure);
        tx.sql.run("DELETE FROM activation_requests WHERE release = ?", [
          release.id,
        ]);
        tx.emit(releaseActivationFailed, release.id, {
          app: release.app,
          ticket: release.ticket_source.ticket,
          failure: {
            code: input.failure.code,
            summary: input.failure.summary,
          },
        } as never);
        return ok({ status: "failed" as const });
      },
    },
    // 이전 release로 돌아가기. 사람만 한다. 지금 활성 release와 data schema가 같은 superseded release만 받는다.
    // 요청만 남기고 줄에 세우는 일은 driver가 한다(commit 뒤 hook이 없다). approval은 없다.
    activatePrevious: {
      route: activationActivatePrevious,
      handle(tx, ctx, input) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return err({
            code: "forbidden",
            message: "only the user goes back to an earlier release",
          });
        }
        const found = releaseAndApp(
          tx,
          ctx,
          activationActivatePrevious.name,
          input.release,
          unreachableTarget,
        );
        if (!found.ok) return found;
        const { release, app } = found.value;
        if (app.status === "archived") {
          return conflict("archived app cannot activate a release");
        }
        if (release.status !== "superseded") {
          return invalid("only a superseded release can be activated again");
        }
        const active = loadActiveRelease(tx.sql, release.app);
        if (!active.ok) return active;
        if (active.value?.data_schema !== release.data_schema) {
          return invalid("the data schema differs from the active release");
        }
        tx.sql.run(
          `INSERT INTO activation_requests (release, requested_at)
           VALUES (?, ?) ON CONFLICT (release) DO NOTHING`,
          [release.id, tx.now()],
        );
        return ok({ phase: "queued" as const });
      },
    },
    // 준비 접수의 요청 때 검사다. 앱 범위·source 연결·ticket claim을 이 transaction에서
    // 확인하고 아무것도 기록하지 않는다. 실제 준비는 supervisor 메모리 진행이고 core는 이 검사를 통과한
    // 요청만 그쪽으로 넘긴다(packages/core/apps/control.ts의 `withReleasePreparation`). 범위 밖·없는 앱·
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
        const claim = checkPreparationClaim(
          tx,
          ctx.actor,
          input.ticket_source,
          input.app,
        );
        if (!claim.ok) return claim;
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
        const actor = requireMachine(ctx, "release.prepare");
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
        // 정규 blueprint는 검증기를 통과한 것만 hash로 고정한다.
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
        // 선언한 의존과 bundle에 담긴 의존이 같아야 한다. SDK, 사용자 package, npm·jsr 모두 같은 선언이다.
        if (
          canonicalJson(blueprint.sdk_dependencies as never) !==
            canonicalJson(manifestDependencies(manifest) as never)
        ) {
          return invalid("manifest dependencies differ from the blueprint");
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
          return invalid("blueprint declarations are not valid");
        }
        const release = releaseRecordSchema.safeParse({
          id,
          app: input.app,
          number: nextReleaseNumber(tx.sql, input.app),
          code_commit: input.commit,
          bundle_hash: input.bundle_hash,
          blueprint_hash: input.blueprint_hash,
          data_schema: input.data_schema,
          data_changes: input.data_changes,
          tests: [...input.tests].sort(),
          ticket_source: input.ticket_source,
          created_by: input.created_by,
          created_at: tx.now(),
          status: "prepared",
          activation: null,
          activated_at: null,
          failure: null,
        });
        if (!release.success) return invalid("invalid release");
        insertRelease(tx, release.data, canonical, declarations);
        return ok({ release: outputRelease(release.data) });
      },
    },
  };
}

function requireMachine(ctx: RequestContext, route: string): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine"
    ? ok(undefined)
    : err({ code: "forbidden", message: `${route} is machine only` });
}

// bundle에 담긴 의존이다. 옛 칸(`sdk_dependencies`)과 새 칸(`dependencies`)을 합쳐 이름순으로 낸다.
function manifestDependencies(
  manifest: {
    sdk_dependencies: readonly { name: string; version: string }[];
    dependencies: readonly { name: string; version: string }[];
  },
): { name: string; version: string }[] {
  const byName = new Map<string, { name: string; version: string }>();
  for (
    const dependency of [...manifest.sdk_dependencies, ...manifest.dependencies]
  ) {
    byName.set(dependency.name, {
      name: dependency.name,
      version: dependency.version,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// migration 단계는 끊김 없이 이어지고 마지막 도착이 release의 schema다.
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
// 없는 참조는 구별 없이 같은 거절이다.
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

// complete가 확인하는 실제 데이터 결과와 준비 확인이다. hash·handler·schema·연결이 하나라도
// 맞지 않으면 채택하지 않는다. 데이터를 바꾼 시도는 backup 확정과 변경 결과가 ledger에 있어야 하고,
// 바꾸지 않은 시도는 변경 결과가 없어야 한다.
function checkReady(
  tx: Pick<Tx, "sql">,
  release: ReleaseRecord,
  activation: ActivationAttempt,
  input: {
    result: ActivationDataResult;
    attestation: ReadyAttestation;
  },
  stored: { declarations: { commands: readonly string[] } },
): Result<void> {
  const { result, attestation } = input;
  if (
    result.release !== release.id || result.attempt !== activation.attempt
  ) {
    return conflict("the data result is for another activation");
  }
  if (!result.integrity_ok || result.data_schema !== release.data_schema) {
    return unavailable("the app data is not at the release schema");
  }
  const records = createDataRecordStore(tx);
  const change = records.find(release.id, activation.attempt, "change");
  const backup = records.find(release.id, activation.attempt, "backup");
  const recorded = change === null
    ? result.invocation === null
    : backup !== null && change.dataSchema === release.data_schema &&
      result.invocation === change.invocation;
  if (!recorded) {
    return unavailable("the data change is not recorded");
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

// record_backup·record_data_change·record_data_restore가 부르는 시도 확인이다. 진행 중인 같은
// 시도의 release만 받는다. 확정한 참조는 그 시도에 남긴다.
export const activationAttemptGate: AttemptGate = {
  check(tx, attempt) {
    const found = loadRelease(tx.sql, attempt.release);
    if (!found.ok) return found;
    const progress = inProgress(found.value, attempt.attempt);
    if (!progress.ok) return progress;
    const release = progress.value;
    // 복구본은 목표보다 앞선 schema의 것이다. 복구본이 필요 없는 시도는 backup을 만들지 않는다.
    if (
      attempt.kind === "backup" && attempt.dataSchema >= release.data_schema
    ) {
      return conflict("the release needs no data change from that schema");
    }
    if (
      attempt.kind === "change" && attempt.dataSchema !== release.data_schema
    ) {
      return conflict("the data is not at the release schema");
    }
    return ok({ app: release.app });
  },
  record(tx, attempt) {
    if (attempt.kind === "restore") return;
    const found = loadRelease(tx.sql, attempt.release);
    if (!found.ok || found.value === null || found.value.activation === null) {
      return;
    }
    const activation: ActivationAttempt = {
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
