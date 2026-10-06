// `release.prepare`: 신뢰된 준비 결과를 불변 prepared Release로 확정한다(apps/releases#R1, R5–R7).
// bundle 준비·테스트는 core 밖에서 끝났고 이 command는 짧은 확정만 한다. machine만 부르며
// coding agent의 통과·hash 주장은 받지 않는다: 같은 bundle hash의 통과한 app test는 Verification
// 사실을 읽는 port로, 새 coding 준비의 ticket claim은 coding-agent의 현재 claim 검사로 이 transaction
// 안에서 다시 확인한다. 긴 준비의 요청 때와 확정 때 모두 검사하므로 요청 쪽도 같은 검사를 부른다.
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  releasePrepare,
  releasePrepared,
  releaseSchema,
} from "../../contracts/apps/mod.ts";
import { validateBlueprint } from "../../contracts/apps/blueprint.ts";
import { canonicalJson } from "../../contracts/apps/blueprint-json.ts";
import {
  type ConnectionId,
  TicketClaimCheck,
  type TicketId,
} from "../../contracts/coding-agent/mod.ts";
import { AppTestVerificationLookupPort } from "../../contracts/problems/mod.ts";
import {
  type CommandDefinition,
  parseActor,
  type PortKey,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { missingSdkPermission } from "../blueprint/sdk-permissions.ts";
import { appAccessDenied, authorizeApp, loadApp } from "../registration/mod.ts";
import { manifestBytes } from "./bundle/manifest.ts";
import { declarationsOfBlueprint } from "./facts.ts";
import { insertRelease, nextReleaseNumber } from "./store.ts";

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
  return ok(undefined);
}

export function createReleaseCommands(): {
  prepare: CommandDefinition<typeof releasePrepare>;
} {
  return {
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
