/**
 * apps/releases의 team-brief testing fixture다. mod.ts에서 내보내지 않는다.
 *
 * - `releasesLedger()`: 실제 releases·apps 표를 가진 메모리 DB와 가짜 Tx·snapshot이다. 준비 command와
 *   읽기를 core 없이 부른다. 같은 bundle hash의 app test와 ticket claim은 시험이 정하는 port로 둔다.
 * - `createLedgerRegistration()`: 실제 core harness에 얹는 시험 team이다. `verifications`(problems가
 *   소유하는 표의 읽는 열만), 채택 release 대체(activation은 apps#T18의 몫이다)를 command로 낸다.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  appBlueprint,
  releasesCompare,
  releasesGet,
  releasesList,
} from "../../../contracts/apps/mod.ts";
import {
  type Blueprint,
  canonicalJson,
  type CommandDeclaration,
  validateBlueprint,
} from "../../blueprint/mod.ts";
import {
  type AppTestVerificationFact,
  AppTestVerificationLookupPort,
} from "../../../contracts/problems/mod.ts";
import { TicketClaimCheck } from "../../../contracts/coding-agent/mod.ts";
import {
  type CommandDefinition,
  defineCommand,
  type ReadSnapshot,
  type RequestContext,
  type SchemaStep,
  type Sql,
  TargetAuthorization,
  type Tx,
} from "../../../contracts/platform/mod.ts";
import { appsSchemaSteps } from "../../registration/mod.ts";
import { manifestBytes } from "../bundle/manifest.ts";
import { releasesSchemaSteps } from "../schema.ts";

export const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
export const OTHER_APP = "app_01h455vb4pex5v6nkc6gd5fdw2";
export const COMMIT = "a".repeat(40);
export const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
export const TICKET = "tkt_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-06T00:00:00.000Z";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function command(
  key: string,
  effect: CommandDeclaration["effect"] = "read",
  extra: Partial<CommandDeclaration> = {},
): CommandDeclaration {
  return {
    key,
    label: key,
    description: `${key} purpose`,
    effect,
    confirm: false,
    input: null,
    revert: { supported: false },
    ...extra,
  };
}

export function blueprint(extra: Partial<Blueprint> = {}): Blueprint {
  return {
    name: "Calendar",
    description: "Keeps one calendar",
    screens: [{ key: "home", label: "Home", path: "/home", sizes: ["full"] }],
    commands: [command("list")],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
    ...extra,
  };
}

// release.prepare 입력이다. blueprint JSON과 manifest·hash는 준비 worker가 만든 것과 같은 규칙이다
// (bundle hash = manifest JSON의 sha256, manifest가 blueprint.json의 hash를 고정한다).
export type PrepareInput = Record<string, unknown> & {
  bundle_hash: string;
  blueprint_hash: string;
};

export function prepareInput(
  value: Blueprint,
  over: Record<string, unknown> = {},
): PrepareInput {
  // 준비 worker는 검증기를 통과한 정규형을 bundle의 blueprint.json으로 둔다.
  const validated = validateBlueprint(value, { app: APP });
  if (!validated.ok) throw new Error(validated.error.message);
  value = validated.value;
  const canonical = canonicalJson(value as never);
  const blueprintHash = sha256(canonical);
  const manifest = {
    entrypoint: "main.ts",
    files: [
      { path: "blueprint.json", hash: blueprintHash },
      { path: "main.ts", hash: "c".repeat(64) },
    ],
    sdk_dependencies: [...value.sdk_dependencies].sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
  };
  const bundleHash = sha256(
    new TextDecoder().decode(manifestBytes(manifest)),
  );
  return {
    app: APP,
    commit: COMMIT,
    bundle_hash: bundleHash,
    blueprint_hash: blueprintHash,
    blueprint: JSON.parse(canonical),
    manifest,
    data_schema: 0,
    data_changes: [],
    tests: [VRF],
    created_by: "machine",
    key: "prepare-key-0001",
    ...over,
  };
}

export const VRF = "vrf_01h455vb4pex5v6nkc6gd5fdw1";

export type Emitted = {
  type: string;
  subject: string | null;
  payload: unknown;
};

export type ClaimScript = (
  input: { ticket: string; claim_seq: string; connection: string; now: string },
) => Result<{ ok: true; expires_at: string } | { ok: false; reason: string }>;

export type ReleasesLedger = {
  db: DatabaseSync;
  emitted: Emitted[];
  // 같은 bundle hash의 test 사실. 시험이 채운다.
  verifications: Map<string, AppTestVerificationFact>;
  // 범위 밖으로 둘 앱.
  hidden: Set<string>;
  claims: { script: ClaimScript | undefined };
  tx(): Tx;
  snapshot(): ReadSnapshot;
  close(): void;
};

function adapter(db: DatabaseSync): Sql {
  return {
    run: (sql, params) => db.prepare(sql).run(...(params as never[])) as never,
    get: (sql, params) => db.prepare(sql).get(...(params as never[])) as never,
    all: (sql, params) => db.prepare(sql).all(...(params as never[])) as never,
  };
}

export function insertApp(db: DatabaseSync, id: string, slug: string): void {
  db.prepare(
    `INSERT INTO apps (id, slug, name, description, planning_version,
       source_path, active_release, run_enabled, revision, status)
     VALUES (?, ?, ?, 'an app', NULL, NULL, NULL, 0, '1', 'active')`,
  ).run(id, slug, slug);
}

export function releasesLedger(): ReleasesLedger {
  const db = new DatabaseSync(":memory:");
  for (const step of appsSchemaSteps) db.exec(step.sql);
  for (const step of releasesSchemaSteps) db.exec(step.sql);
  insertApp(db, APP, "calendar");
  insertApp(db, OTHER_APP, "other");
  const sql = adapter(db);
  const emitted: Emitted[] = [];
  const verifications = new Map<string, AppTestVerificationFact>();
  const hidden = new Set<string>();
  const claims: { script: ClaimScript | undefined } = { script: undefined };
  let ids = 0;
  const authorize = (
    _ctx: RequestContext,
    _operation: string,
    target: Record<string, string>,
  ): Result<void> =>
    hidden.has(target.app)
      ? err({ code: "forbidden", message: "out of scope" })
      : ok(undefined);
  const port = ((key: { name: string }) => {
    if (key.name === TargetAuthorization.name) return authorize;
    if (key.name === AppTestVerificationLookupPort.name) {
      return (id: string) => ok(verifications.get(id) ?? null);
    }
    if (key.name === TicketClaimCheck.name && claims.script !== undefined) {
      return claims.script;
    }
    throw new Error(`unregistered port ${key.name}`);
  }) as Tx["port"];
  return {
    db,
    emitted,
    verifications,
    hidden,
    claims,
    tx: () => ({
      sql,
      now: () => AT,
      newId: (prefix: string) => {
        ids += 1;
        return `${prefix}_01h455vb4pex5v6nkc6gd5f${
          String(ids).padStart(3, "0")
        }`;
      },
      emit: (
        event: { type: string },
        subject: string | null,
        payload: unknown,
      ) => {
        emitted.push({ type: event.type, subject, payload });
        return String(emitted.length);
      },
      port,
    } as unknown as Tx),
    snapshot: () =>
      ({
        sql,
        as_of_seq: "9",
        port,
      }) as unknown as ReadSnapshot,
    close: () => db.close(),
  };
}

export function machineContext(): RequestContext {
  return {
    principal: "machine-1",
    actor: "machine",
    scope: { operations: [], targets: {} },
    conditions: {},
    credential_ref: "cred-machine",
  };
}

export function userContext(): RequestContext {
  return { ...machineContext(), principal: "user-1", actor: "user" };
}

// ---- 실제 core harness에 얹는 시험 team ----

// problems가 소유하는 `verifications` 표 가운데 release 준비가 읽는 열만 같은 이름으로 둔다.
// 실제 표는 problems team이 만든다. 이 team은 problems team 없이 쓴다.
const schemaSteps: readonly SchemaStep[] = [{
  id: "apps.releases.testing.verifications",
  sql: `CREATE TABLE verifications (
    id TEXT PRIMARY KEY NOT NULL,
    app TEXT NOT NULL,
    kind TEXT NOT NULL,
    result TEXT NOT NULL,
    target_bundle_hash TEXT NOT NULL
  ) STRICT;`,
}];

export const addVerification = defineCommand({
  resource: "releases_tests",
  method: "add_verification",
  name: "releases.tests.add_verification",
  input: z.strictObject({
    id: z.string(),
    app: z.string(),
    kind: z.string(),
    result: z.string(),
    bundle_hash: z.string(),
  }),
  output: z.object({ stored: z.boolean() }),
  actors: ["machine"],
  errors: [],
});

// activation(apps#T18)의 대역이다. 채택 참조·status를 같은 transaction에서 바꾼다.
export const adopt = defineCommand({
  resource: "releases_tests",
  method: "adopt",
  name: "releases.tests.adopt",
  input: z.strictObject({ release: z.string() }),
  output: z.object({ adopted: z.boolean() }),
  actors: ["machine"],
  errors: [],
});

const addVerificationCommand: CommandDefinition<typeof addVerification> = {
  route: addVerification,
  handle(tx, _ctx, input) {
    tx.sql.run(
      `INSERT INTO verifications (id, app, kind, result, target_bundle_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [input.id, input.app, input.kind, input.result, input.bundle_hash],
    );
    return ok({ stored: true });
  },
};

const adoptCommand: CommandDefinition<typeof adopt> = {
  route: adopt,
  handle(tx, _ctx, input) {
    const row = tx.sql.get("SELECT app FROM releases WHERE id = ?", [
      input.release,
    ]);
    if (row === undefined) return ok({ adopted: false });
    const app = String(row.app);
    tx.sql.run(
      "UPDATE releases SET status = 'superseded' WHERE app = ? AND status = 'active'",
      [app],
    );
    tx.sql.run("UPDATE releases SET status = 'active' WHERE id = ?", [
      input.release,
    ]);
    tx.sql.run("UPDATE apps SET active_release = ? WHERE id = ?", [
      input.release,
      app,
    ]);
    return ok({ adopted: true });
  },
};

export function createLedgerRegistration() {
  return {
    schemaSteps,
    commands: [addVerificationCommand, adoptCommand],
    ports: [],
  };
}

// 읽기 route 이름(시험이 operation을 scope에 넣을 때 쓴다).
export const READ_OPERATIONS = [
  appBlueprint.name,
  releasesList.name,
  releasesGet.name,
  releasesCompare.name,
] as const;
