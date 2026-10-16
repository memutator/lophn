// runner가 쥐는 실제 AppDriver다. 봉인 bundle 사본을 운영 앱 자식과 같은 Deno flag·진입 파일·시작 입력
// (mode=test)으로 띄우고, control socket으로 probe·open·call을 보내고, 앱의 SDK 보고가 오는 broker
// socket을 직접 연다. test 자식(harness)은 이 driver를 private 호출 통로로만 만진다.
//
// app test는 network 없이 test DB로 돈다. 앱 자식의 Deno net 허락은 가상 host와 broker·control socket뿐이고
// (apps/permissions `appFlags`), 외부 net·secret은 broker가 apps/preview의 고정 대역에 보내 실제 접속이 없다.
// 앱 data는 이 실행의 작업 폴더 안 DB다.
import { Buffer } from "node:buffer";
import { DatabaseSync } from "node:sqlite";
import {
  createIdSource,
  cryptoRandom,
  invertAll,
  ok,
  type Result,
  sha256Hex,
  systemClock,
} from "../../../../base/mod.ts";
import type { Blueprint } from "../../../../protocol/apps/blueprint/mod.ts";
import type { AppProcessStartInput } from "../../../../protocol/apps/calls/mod.ts";
import {
  appFlags,
  type BrokerChild,
  createBrokerEndpoint,
  createProblemReportService,
  createReadyService,
  type ResolvedRequirement,
} from "../../../apps/permissions/mod.ts";
import {
  createPreviewBrokerServices,
  previewScopeOf,
} from "../../../apps/preview/mod.ts";
import { appArgv, appEnv } from "../../../apps/runtime/mod.ts";
import { unixDirectTransport } from "../../../apps/runtime/client/unix-http.ts";
import {
  migrateAppDatabase,
  type MigrationScript,
} from "../../../apps/data/worker/migrate.ts";
import { createAppBackup } from "../../../apps/data/worker/backup.ts";
import { openAppDatabase } from "../../../apps/data/worker/db.ts";
import type { AppDriver, HarnessPlan } from "../harness/mod.ts";

const APP_ID = "app_01arz3ndektsv4rrffq69g5fav";
const NONCE = "test-nonce-0001";
const CREDENTIAL = "runner-broker-credential";
const READY_MS = 20_000;
const DENO_HEAP_FLAG = "--v8-flags=--max-old-space-size=256";

// runner가 보고를 넘기는 곳이다. mode=test와 scope는 이 함수를 만든 쪽이 붙인다.
type DriverSink = {
  report(report: {
    report_id: string;
    name: string;
    message: string;
    observed_at: string;
    details?: unknown;
    invocation?: unknown;
  }): Promise<Result<unknown>>;
  exception(input: unknown): Promise<Result<unknown>>;
};

export type RealDriverInput = {
  plan: HarnessPlan;
  blueprint: Blueprint;
  // 봉인 bundle 사본 폴더(읽기 전용)와 manifest의 진입 파일 이름.
  bundle: string;
  bundle_hash: string;
  entrypoint: string;
  // 이 실행의 작업 폴더. driver가 안에 data·fixture DB를 만든다.
  work: string;
  sockets: { broker: string; control: string };
  deno: string;
  environment: { home?: string; denoDir?: string; xdgCacheHome?: string };
  sink: DriverSink;
};

type RealDriver = AppDriver & { close(): Promise<void> };

type InputSchema = Blueprint["app_api"][number]["input"];

// 입력 계약을 어긴 값이다. 입력이 없는 app-api에는 객체를, 있는 app-api에는 계약의 type이 아닌 값을 보낸다.
function invalidValue(schema: InputSchema): unknown {
  if (schema === null) return { unexpected: true };
  return schema.type === "string" ? 7 : "not-a-valid-value";
}

// 입력 계약을 지키는 가장 단순한 값이다. 입력이 없는 app-api에는 입력을 보내지 않는다.
function validValue(schema: NonNullable<InputSchema>): unknown {
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  switch (schema.type) {
    case "object": {
      const value: Record<string, unknown> = {};
      for (const key of schema.required ?? []) {
        const property = schema.properties?.[key];
        value[key] = property ? validValue(property) : null;
      }
      return value;
    }
    case "array":
      return Array.from(
        { length: schema.minItems ?? 0 },
        () => schema.items ? validValue(schema.items) : null,
      );
    case "string":
      return "x".repeat(Math.max(1, schema.minLength ?? 1));
    case "integer":
    case "number":
      return schema.minimum ?? 1;
    case "boolean":
      return true;
    default:
      return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Child = {
  output(): string;
  exited: Promise<number | null>;
  stop(): Promise<void>;
};

export async function createRealAppDriver(
  input: RealDriverInput,
): Promise<Result<RealDriver>> {
  const { plan, work } = input;
  const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
  const children = new Set<Child>();
  const dataDir = `${work}/data`;
  await Deno.mkdir(dataDir, { recursive: true });

  const child: BrokerChild = {
    app: APP_ID,
    release: null,
    mode: "test",
    processNonce: NONCE,
  };
  // 앱의 SDK 보고와 잡은 예외는 runner가 mode=test와 진단 scope로 core에 넘긴다.
  const problems = createProblemReportService({
    problems: {
      report: (request) =>
        input.sink.report({
          report_id: request.reportId,
          name: request.name,
          message: request.message,
          observed_at: request.observedAt,
          ...(request.details === undefined
            ? {}
            : { details: request.details }),
          ...(request.invocation === undefined
            ? {}
            : { invocation: request.invocation }),
        }) as never,
      observe: (observation) => input.sink.exception(observation) as never,
    },
  });
  // net·secret·다른 앱 호출·project 목록은 모두 대역이다.
  const stand = createPreviewBrokerServices({
    scope: previewScopeOf(input.blueprint),
    problems,
  });
  const endpoint = createBrokerEndpoint({
    session: { child, credential: CREDENTIAL },
    services: {
      ...stand.services,
      ready: createReadyService({ receiver: { ready() {} } }),
    },
  });
  await Deno.mkdir(input.sockets.broker.replace(/\/[^/]*$/, ""), {
    recursive: true,
  });
  await Deno.remove(input.sockets.broker).catch(() => undefined);
  const brokerServer = Deno.serve(
    { path: input.sockets.broker, onListen() {} },
    (request) => endpoint.handle(request),
  );

  async function spawn(): Promise<Child> {
    await Deno.remove(input.sockets.control).catch(() => undefined);
    // 앱이 blueprint에 선언한 fs 권한이다. 사람이 grant한 것과 같은 모양으로 flag가 된다.
    const grants: ResolvedRequirement[] = input.blueprint.permissions.flatMap(
      (permission) => {
        if (permission.kind !== "fs.read" && permission.kind !== "fs.write") {
          return [];
        }
        const scope = permission.scope as { path: string; recursive: boolean };
        return [{
          kind: permission.kind,
          scope: { ...scope, outsideLinks: [] },
          reason: permission.reason,
        }];
      },
    );
    const flags = appFlags(
      grants,
      {
        bundle: input.bundle,
        data: dataDir,
        brokerSocket: input.sockets.broker,
        controlSocket: input.sockets.control,
      },
      { ports: [] },
      [],
    );
    if (!flags.ok) throw new Error(flags.error.message);
    const start: AppProcessStartInput = {
      app: APP_ID,
      release: null,
      bundle_hash: input.bundle_hash,
      mode: "test",
      process_nonce: NONCE,
      broker_socket: input.sockets.broker,
      control_socket: input.sockets.control,
      data_path: dataDir,
      broker_credential: CREDENTIAL,
    };
    const line = JSON.stringify(start);
    const process = new Deno.Command(input.deno, {
      args: appArgv({
        deno: input.deno,
        entry: `${input.bundle}/${input.entrypoint}`,
        flags: { ...flags.value, args: [...flags.value.args, DENO_HEAP_FLAG] },
        importMap: `${input.bundle}/import-map.json`,
        environment: input.environment,
        startLine: line,
      }),
      clearEnv: true,
      env: appEnv(input.environment),
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    let text = "";
    const decoder = new TextDecoder();
    const collect = async (stream: ReadableStream<Uint8Array>) => {
      for await (const chunk of stream) text += decoder.decode(chunk);
    };
    const reading = Promise.all([
      collect(process.stdout),
      collect(process.stderr),
    ]);
    const writer = process.stdin.getWriter();
    await writer.write(new TextEncoder().encode(`${line}\n`));
    await writer.close();
    const exited = process.status.then((status) => status.code);
    let stopped = false;
    const handle: Child = {
      output: () => text,
      exited,
      async stop() {
        if (stopped) return;
        stopped = true;
        try {
          process.kill("SIGKILL");
        } catch { /* 이미 끝났다 */ }
        await exited;
        await reading.catch(() => undefined);
        children.delete(handle);
      },
    };
    children.add(handle);
    return handle;
  }

  const control = (path: string, body: unknown) =>
    unixDirectTransport(input.sockets.control, {
      method: "POST",
      path,
      authorization: "",
      body,
    });

  let opened: Child | undefined;
  let app: Child | undefined;
  let appGone = false;
  async function ensureApp(): Promise<Child> {
    // 앱이 처리되지 않은 rejection으로 스스로 끝났으면 다음 호출을 위해 새로 띄운다.
    if (app && !appGone) return app;
    appGone = false;
    await seedData();
    app = await spawn();
    void app.exited.then(() => {
      appGone = true;
    });
    return app;
  }

  // 앱이 처음 뜨기 전에 data 폴더의 DB를 새 schema까지 migration해 둔다(운영은 activation이 한다).
  let seeded = false;
  async function seedData() {
    if (seeded) return;
    seeded = true;
    if (plan.data.schema === 0) return;
    const path = `${dataDir}/app.sqlite`;
    const created = openAppDatabase(path);
    if (!created.ok) return;
    created.value.close();
    const backup = await createAppBackup(dataDir, path, "before");
    if (!backup.ok) return;
    await migrateAppDatabase({
      dataArea: dataDir,
      databasePath: path,
      backupPath: `${dataDir}/backups/before`,
      targetSchema: plan.data.schema,
      scripts: await scripts(),
      appliedAt: new Date().toISOString(),
      result: {
        release: "rel_01arz3ndektsv4rrffq69g5fav",
        attempt: "act_01arz3ndektsv4rrffq69g5fav",
        invocation: null,
      },
    });
  }

  // 업무 표의 논리 상태다. 열려 있는 DB를 읽기 전용으로 열어 행을 본다(DB가 없으면 빈 상태).
  function dataState(): string {
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(`${dataDir}/app.sqlite`, { readOnly: true });
    } catch {
      return "{}";
    }
    try {
      const dump: Record<string, string[]> = {};
      const tables = db.prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like 'lophn_%' order by name",
      ).all().map((row) => String(row["name"]));
      for (const table of tables) {
        dump[table] = db.prepare(`select * from "${table}"`).all().map((row) =>
          JSON.stringify(
            row,
            (_key, value) =>
              typeof value === "bigint" ? value.toString() : value,
          )
        ).sort();
      }
      return JSON.stringify(dump);
    } finally {
      db.close();
    }
  }

  async function probeAttestation() {
    let last = "app did not answer";
    for (let attempt = 0; attempt < 2; attempt++) {
      const running = await ensureApp();
      let gone = false;
      void running.exited.then(() => {
        gone = true;
      });
      const deadline = Date.now() + READY_MS;
      while (!gone && Date.now() < deadline) {
        try {
          const answered = await control("/_lophn/control/probe", {
            process_nonce: NONCE,
          });
          if (answered.status === 200) {
            // 호출은 open 뒤에만 받는다. 준비가 끝난 앱을 한 번 연다(supervisor의 open과 같다).
            if (opened !== running) {
              opened = running;
              await control("/_lophn/control/open", {
                process_nonce: NONCE,
                release: null,
              });
            }
            const value = answered.body as {
              bundle_hash: string;
              commands: string[];
              data_schema: number;
              process_nonce: string;
            };
            return {
              bundle_hash: value.bundle_hash,
              commands: value.commands,
              data_schema: value.data_schema,
              process_nonce: value.process_nonce,
            };
          }
          last = `probe answered ${answered.status}`;
        } catch {
          last = "app socket is not open";
        }
        await sleep(80);
      }
      // 앱이 끝났으면 한 번 더 띄운다. 끝나지 않았는데 답이 없으면 그대로 실패다.
      last = `${last}: ${running.output().slice(-400)}`;
      if (!gone) break;
      appGone = true;
    }
    throw new Error(last);
  }

  const scripts = async (): Promise<MigrationScript[]> => {
    const found: MigrationScript[] = [];
    try {
      for await (const entry of Deno.readDir(`${input.bundle}/migrations`)) {
        const match = /^(\d+)-(\d+)\.sql$/.exec(entry.name);
        if (!match) continue;
        const sql = await Deno.readTextFile(
          `${input.bundle}/migrations/${entry.name}`,
        );
        found.push({
          change: {
            from: Number(match[1]),
            to: Number(match[2]),
            script_hash: `sha256:${await sha256Hex(sql)}`,
            description: `schema ${match[1]} to ${match[2]}`,
          },
          sql,
        });
      }
    } catch { /* 이 앱은 migration이 없다 */ }
    return found.sort((a, b) => a.change.from - b.change.from);
  };

  let migrations = 0;
  const driver: RealDriver = {
    probe: probeAttestation,
    async rejectsInvalidInput(api) {
      const declaration = input.blueprint.app_api.find((item) =>
        item.key === api
      );
      if (!declaration) return false;
      await probeAttestation();
      const value = invalidValue(declaration.input);
      let answered: { status: number; body: unknown };
      try {
        answered = await control("/_lophn/control/call", {
          invocation: ids.newId("inv"),
          api,
          input: value,
          context: {
            app: APP_ID,
            release: null,
            mode: "test",
            project: null,
            effect: declaration.effect,
            caller: null,
          },
        });
      } catch {
        return false;
      }
      const body = answered.body as {
        status?: string;
        error?: { code?: string };
      } | null;
      return (answered.status === 400 &&
        body?.error?.code === "invalid_input") ||
        (answered.status === 200 && body?.status === "error" &&
          body.error?.code === "invalid_input");
    },
    async rewind(api) {
      const declaration = input.blueprint.app_api.find((item) =>
        item.key === api
      );
      const none = {
        called: false,
        changed: false,
        applied: false,
        restored: false,
      };
      if (!declaration) return { ...none, reason: "선언하지 않은 app-api다" };
      await probeAttestation();
      const before = dataState();
      const called = await control("/_lophn/control/call", {
        invocation: ids.newId("inv"),
        api,
        ...(declaration.input === null
          ? {}
          : { input: validValue(declaration.input) }),
        context: {
          app: APP_ID,
          release: null,
          mode: "test",
          project: null,
          effect: declaration.effect,
          caller: null,
        },
      });
      const body = called.body as {
        status?: string;
        changeset?: string | null;
        error?: { code?: string };
      } | null;
      if (called.status !== 200 || body?.status !== "ok") {
        return {
          ...none,
          reason: `fixture 입력의 호출이 성공하지 못했다: ${
            body?.error?.code ?? called.status
          }`,
        };
      }
      const changed = dataState() !== before;
      if (!body.changeset) {
        return {
          ...none,
          called: true,
          reason: "호출이 changeset을 내지 않았다",
        };
      }
      const inverted = invertAll([
        new Uint8Array(Buffer.from(body.changeset, "base64")),
      ]);
      if (!inverted.ok) {
        return {
          ...none,
          called: true,
          changed,
          reason: `changeset을 뒤집지 못했다: ${inverted.error.message}`,
        };
      }
      const applied = await control("/_lophn/control/apply", {
        changesets: inverted.value.map((bytes) =>
          Buffer.from(bytes).toString("base64")
        ),
      });
      const done = (applied.body as { status?: string } | null)?.status ===
        "applied";
      const restored = dataState() === before;
      return {
        called: true,
        changed,
        applied: done,
        restored,
        reason: !done
          ? "뒤집은 changeset이 적용되지 않았다"
          : !restored
          ? "적용 뒤 DB 상태가 호출 전과 다르다"
          : !changed
          ? "호출이 DB 상태를 바꾸지 않았다"
          : "뒤집어 적용하니 호출 전 상태로 돌아왔다",
      };
    },
    async migrate(scenario) {
      migrations += 1;
      const area = `${work}/migration-${migrations}`;
      await Deno.mkdir(area, { recursive: true });
      const path = `${area}/data.db`;
      const steps = await scripts();
      const target = plan.data.schema;
      const opened = openAppDatabase(path);
      if (!opened.ok) {
        return {
          ok: false,
          from_schema: 0,
          data_schema: 0,
          integrity_ok: false,
          restored: false,
          reason: opened.error.message,
        };
      }
      opened.value.close();
      let from = 0;
      if (scenario === "upgrade") {
        from = plan.data.previous_schema ?? 0;
        // 이전 release schema의 fixture DB다. 번들의 단계로 갈 수 있으면 그 단계로 만들고, 없으면
        // 그 schema 번호만 가진 DB를 만든다.
        const reachable = steps.filter((step) => step.change.to <= from);
        const built = await migrateAppDatabase({
          dataArea: area,
          databasePath: path,
          backupPath: `${area}/backups/seed`,
          targetSchema: from,
          scripts: reachable,
          appliedAt: new Date().toISOString(),
          result: {
            release: "rel_01arz3ndektsv4rrffq69g5fav",
            attempt: "act_01arz3ndektsv4rrffq69g5fav",
            invocation: null,
          },
        });
        if (!built.ok || built.value.result.data_schema !== from) {
          const marker = openAppDatabase(path);
          if (marker.ok) {
            marker.value.applyStep("select 1", {
              dataSchema: from,
              scriptHash: `sha256:${await sha256Hex("marker")}`,
              appliedAt: new Date().toISOString(),
            });
            marker.value.close();
          }
        }
      }
      const backup = await createAppBackup(area, path, "before");
      if (!backup.ok) {
        return {
          ok: false,
          from_schema: from,
          data_schema: from,
          integrity_ok: false,
          restored: false,
          reason: backup.error.message,
        };
      }
      const migrated = await migrateAppDatabase({
        dataArea: area,
        databasePath: path,
        backupPath: `${area}/backups/before`,
        targetSchema: target,
        scripts: steps,
        appliedAt: new Date().toISOString(),
        result: {
          release: "rel_01arz3ndektsv4rrffq69g5fav",
          attempt: "act_01arz3ndektsv4rrffq69g5fav",
          invocation: null,
        },
      });
      if (!migrated.ok) {
        return {
          ok: false,
          from_schema: from,
          data_schema: from,
          integrity_ok: true,
          restored: false,
          reason: migrated.error.message,
        };
      }
      return {
        ok: !migrated.value.restored,
        from_schema: from,
        data_schema: migrated.value.result.data_schema,
        integrity_ok: migrated.value.result.integrity_ok,
        restored: migrated.value.restored,
        reason: migrated.value.restored ? "restored" : "applied",
      };
    },
    async close() {
      for (const running of [...children]) await running.stop();
      await brokerServer.shutdown();
    },
  };
  return ok(driver);
}
