/**
 * apps/permissions의 team-brief testing fixture다. mod.ts에서 내보내지 않는다.
 *
 * 이 fixture는 시험이 현재 release의 선언 사실과 activation event를 writer transaction 안에서 바로
 * 남기는 시험 전용 team이다. 선언은 실제 `releases` 표에 채택한 release 행으로 둔다(제품의
 * `currentDeclarations` 구현이 그 행의 선언 사실을 읽는다). blueprint 검증·test 확인 없이 선언 사실만
 * 직접 넣는 것이 준비(`release.prepare`)와 다르다. grant command와 read는 제품 등록
 * (apps/core/apps.ts) 그대로 쓴다.
 *
 * ```ts
 * const opened = await createCoreHarness({
 *   teams: [appsTeam, permissionsFixtures],
 *   teamModules: [appsUrl, new URL("./testing/mod.ts", import.meta.url).href],
 * });
 * ```
 */
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import {
  releaseActivated,
  releaseActivationFailed,
  releaseActivationStarted,
} from "../../../contracts/apps/mod.ts";
import {
  type CommandDefinition,
  defineCommand,
  type ReadSnapshot,
  type SchemaStep,
  TargetAuthorization,
  type Tx,
} from "../../../contracts/platform/mod.ts";
import { appsSchemaSteps } from "../../registration/mod.ts";
import {
  type CurrentDeclarations,
  currentDeclarations,
} from "../declarations.ts";
import { permissionsSchemaSteps } from "../schema.ts";
import {
  releaseDeclarations,
  releasesSchemaSteps,
} from "../../releases/mod.ts";

const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const APR = "apr_01h455vb4pex5v6nkc6gd5fdw1";

export const setDeclarations = defineCommand({
  resource: "permissions_tests",
  method: "set_declarations",
  name: "permissions.tests.set_declarations",
  input: z.strictObject({
    app: z.string(),
    declarations: z.record(z.string(), z.unknown()).nullable(),
  }),
  output: z.object({ stored: z.boolean() }),
  actors: ["machine"],
  errors: [],
});

export const activation = defineCommand({
  resource: "permissions_tests",
  method: "activation",
  name: "permissions.tests.activation",
  input: z.strictObject({
    app: z.string(),
    phase: z.enum(["start", "succeed", "fail"]),
    // succeed·fail이 가리키는 시작 event seq.
    started_seq: z.string().optional(),
  }),
  output: z.object({ seq: z.string() }),
  actors: ["machine"],
  errors: [],
});

// 선언 사실을 채택한 release 행으로 둔다. 이전 채택 행은 대체되고, 호출마다 새 행이다.
export function seedActiveDeclarations(
  sql: Pick<Tx["sql"], "run" | "get">,
  id: string,
  at: string,
  app: string,
  declarations: Record<string, unknown> | null,
): void {
  sql.run(
    "UPDATE releases SET status = 'superseded' WHERE app = ? AND status = 'active'",
    [app],
  );
  if (declarations === null) return;
  const number = Number(
    sql.get(
      "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM releases WHERE app = ?",
      [
        app,
      ],
    )?.n ?? 1,
  );
  sql.run(
    `INSERT INTO releases
      (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema,
       data_changes, ticket_source, created_by, created_at, status, activation,
       failure, blueprint, declarations)
     VALUES (?, ?, ?, ?, ?, ?, 0, '[]', NULL, 'machine', ?, 'active', NULL, NULL,
       '{}', ?)`,
    [
      id,
      app,
      number,
      "0".repeat(40),
      "a".repeat(64),
      "b".repeat(64),
      at,
      JSON.stringify(declarations),
    ],
  );
}

let seeded = 0;

// 메모리 DB(snapshot 시험)에 선언 사실을 채택한 release 행으로 둔다. 앱 행이 먼저 있어야 한다.
export function seedDeclarations(
  db: DatabaseSync,
  app: string,
  declarations: Record<string, unknown> | null,
): void {
  seeded += 1;
  seedActiveDeclarations(
    {
      run: (sql, params) =>
        db.prepare(sql).run(...(params as never[])) as never,
      get: (sql, params) =>
        db.prepare(sql).get(...(params as never[])) as never,
    },
    `rel_01h455vb4pex5v6nkc6gd5fd${String(seeded % 100).padStart(2, "0")}`,
    "2026-10-06T00:00:00.000Z",
    app,
    declarations,
  );
}

const setDeclarationsCommand: CommandDefinition<typeof setDeclarations> = {
  route: setDeclarations,
  handle(tx, _ctx, input) {
    seedActiveDeclarations(
      tx.sql,
      tx.newId("rel"),
      tx.now(),
      input.app,
      input.declarations,
    );
    return ok({ stored: true });
  },
};

const activationCommand: CommandDefinition<typeof activation> = {
  route: activation,
  handle(tx, _ctx, input) {
    if (input.phase === "start") {
      const seq = tx.emit(releaseActivationStarted, REL, {
        app: input.app,
        started_seq: "1",
        previous_release: null,
        approval: APR,
        expected_grants_seq: 0,
        expected_schema: 0,
      });
      return ok({ seq });
    }
    if (input.started_seq === undefined) {
      return err({ code: "invalid_input", message: "started_seq is required" });
    }
    if (input.phase === "succeed") {
      const seq = tx.emit(releaseActivated, REL, {
        started_seq: input.started_seq,
        previous_release: null,
        data_schema: 0,
      });
      return ok({ seq });
    }
    const seq = tx.emit(releaseActivationFailed, REL, {
      started_seq: input.started_seq,
      failure: { code: "test", summary: "fixture failure" },
    });
    return ok({ seq });
  },
};

// 시험 team은 자기 표를 만들지 않는다. 선언은 실제 releases 표에 둔다.
const schemaSteps: readonly SchemaStep[] = [];

// 선언 port의 제품 구현이다. reader 등록의 고정 값과 같다.
export const declarationsFixture: CurrentDeclarations = releaseDeclarations;

export function createLedgerRegistration() {
  return {
    schemaSteps,
    commands: [setDeclarationsCommand, activationCommand],
    ports: [],
  };
}

// read handler를 ledger 없이 부르는 snapshot이다. 실제 apps·grants·시험 선언 표(실제
// schema)를 가진 메모리 DB를 읽고, 대상 권한 port는 모두 허용한다. 선언 port는 reader
// registration의 고정 값처럼 주입한다(withDeclarations=false면 등록하지 않은 core와 같다).
export function createGrantSnapshot(options: {
  withDeclarations: boolean;
}): {
  snapshot: ReadSnapshot;
  db: DatabaseSync;
  close(): void;
} {
  const db = new DatabaseSync(":memory:");
  // grants.list의 grants_seq는 실제 ledger의 events 표에서 읽는다.
  db.exec(`CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    subject TEXT,
    actor TEXT NOT NULL,
    run TEXT,
    payload TEXT NOT NULL,
    at TEXT NOT NULL
  ) STRICT`);
  for (const step of appsSchemaSteps) db.exec(step.sql);
  for (const step of releasesSchemaSteps) db.exec(step.sql);
  for (const step of permissionsSchemaSteps) db.exec(step.sql);
  for (const step of schemaSteps) db.exec(step.sql);
  const snapshot: ReadSnapshot = {
    as_of_seq: "7",
    sql: {
      get: (sql, params) =>
        db.prepare(sql).get(...(params as never[])) as never,
      all: (sql, params) =>
        db.prepare(sql).all(...(params as never[])) as never,
    },
    port: ((key: { name: string }) => {
      if (key.name === TargetAuthorization.name) {
        return () => ({ ok: true as const, value: undefined });
      }
      if (options.withDeclarations && key.name === currentDeclarations.name) {
        return declarationsFixture;
      }
      throw new Error("unregistered read port");
    }) as ReadSnapshot["port"],
  };
  return { snapshot, db, close: () => db.close() };
}
