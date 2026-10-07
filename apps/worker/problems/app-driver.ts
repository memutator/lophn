// runner가 쥐는 실제 AppDriver다(problems/tests#R6–R9, R15). 봉인 bundle 사본을 운영 앱 자식과 같은 Deno
// flag·진입점·시작 입력(mode=test)으로 띄우고, 서명한 direct 요청으로 command를 부르고, 앱의 SDK 보고가
// 오는 broker socket을 직접 연다. test 자식(harness)은 이 driver를 private 호출 통로로만 만진다.
//
// 앱 자식에는 core·collector 주소와 credential이 없다. 보고는 broker socket으로 와서 runner의 선언 code
// guard를 지난 뒤에만 collector 쪽(sink)으로 간다. net·secret·문서 쓰기는 apps/preview의 고정 대역이 받는다.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  createIdSource,
  cryptoRandom,
  err,
  ok,
  type Result,
  sha256Hex,
  systemClock,
} from "../../../packages/base/mod.ts";
import { createCrashObserver } from "../../../packages/apps/runtime/observations/crash.ts";
import type { Blueprint } from "../../../packages/apps/blueprint/mod.ts";
import type { ResolvedRequirement } from "../../../packages/apps/permissions/model.ts";
import {
  appFlags,
  type BrokerChild,
  createBrokerEndpoint,
  isLoopbackHost,
} from "../../../packages/apps/permissions/mod.ts";
import {
  createPreviewBrokerServices,
  createPreviewExternalService,
  createPreviewSecretService,
  previewScopeOf,
} from "../../../packages/apps/preview/mod.ts";
import {
  appArgv,
  appEnv,
  createCoreSigner,
} from "../../../packages/apps/runtime/mod.ts";
import { unixDirectTransport } from "../../../packages/apps/runtime/client/unix-http.ts";
import {
  migrateAppDatabase,
  type MigrationScript,
} from "../../../packages/apps/data/worker/migrate.ts";
import { createAppBackup } from "../../../packages/apps/data/worker/backup.ts";
import { openAppDatabase } from "../../../packages/apps/data/worker/db.ts";
import {
  type HarnessPlan,
  type ReceivedReport,
  REDACTION_CANARY,
  type RunnerDriver,
} from "../../../packages/problems/tests/harness/mod.ts";
import { reportProblemInputSchema } from "../../../packages/contracts/problems/mod.ts";
import type { ReportProblemIngress } from "../../../packages/contracts/problems/mod.ts";
import {
  createKnownSecretRegistry,
  createRedactionEngine,
} from "../../../packages/platform/redaction/mod.ts";

const APP_ID = "app_01arz3ndektsv4rrffq69g5fav";
const STAND_IN_HOST = "loopback.stand-in.test";
const NONCE = "test-nonce-0001";
const CREDENTIAL = "runner-broker-credential";
const PROBE_PREFIX = "LOPHN_PROBE ";
const READY_MS = 20_000;
const QUIET_MS = 200;
const DENO_HEAP_FLAG = "--v8-flags=--max-old-space-size=256";

// runner가 보고를 넘기는 곳이다. mode=test와 scope는 이 함수를 만든 쪽이 붙인다.
export type DriverSink = {
  report(report: ReportProblemIngress): Promise<Result<unknown>>;
  exception(input: unknown): Promise<Result<unknown>>;
};

export type RealDriverInput = {
  plan: HarnessPlan;
  blueprint: Blueprint;
  // 봉인 bundle 사본 폴더. 읽기 전용이다.
  bundle: string;
  bundle_hash: string;
  // 이 실행의 작업 폴더. driver가 안에 data·probe·fixture DB를 만든다.
  work: string;
  sockets: { broker: string; direct: string; probe: string };
  deno: string;
  entrypoint: string;
  base_module: string;
  environment: { home?: string; denoDir?: string; xdgCacheHome?: string };
  // command마다 앱이 낸 fixture 입력. 없으면 blueprint 입력 계약에서 최소 값을 만든다.
  inputs: Record<string, unknown>;
  // 이 command의 변경 전에 먼저 돌릴 command다. 결과의 필드를 입력에 묶는다(예: 완료할 항목의 id).
  // 앱의 되돌림 근거 표(journal)다. 되돌림은 이 표에 쓰므로 업무 상태 hash에서 뺀다.
  journal_tables?: string[];
  prepare?: Record<
    string,
    { command: string; input?: unknown; bind?: Record<string, string> }
  >;
  sink: DriverSink;
  view: RunnerDriver["view"];
};

export type RealDriver = RunnerDriver & {
  // 화면 검사 host의 화면이 `lophnApp.call`로 부르는 command다(test 앱 socket이 이 함수로 온다).
  command(key: string, input: unknown): Promise<Result<unknown>>;
  received(): readonly ReceivedReport[];
  // 마지막 platform probe 자식이 쓴 출력이다(실패를 설명하는 데만 쓴다).
  probeOutput(): string;
  close(): Promise<void>;
};

type JsonObject = Record<string, unknown>;

type InputSchema = {
  type?: string;
  properties?: Record<string, InputSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: InputSchema;
  minLength?: number;
  minimum?: number;
  minItems?: number;
  enum?: unknown[];
};

function validValue(schema: InputSchema): unknown {
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  switch (schema.type) {
    case "object": {
      const value: JsonObject = {};
      for (const key of schema.required ?? []) {
        value[key] = validValue(schema.properties?.[key] ?? {});
      }
      return value;
    }
    case "array":
      return Array.from(
        { length: schema.minItems ?? 0 },
        () => validValue(schema.items ?? {}),
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

// 입력 계약을 어긴 값이다. 계약이 없으면 객체를 보낸다(입력 없음 계약).
function invalidValue(schema: InputSchema | null): unknown {
  if (schema === null) return { unexpected: true };
  switch (schema.type) {
    case "object": {
      const value = validValue(schema) as JsonObject;
      const required = schema.required?.[0];
      if (required !== undefined) {
        const target = schema.properties?.[required]?.type;
        value[required] = target === "string" ? 7 : "not-a-valid-value";
        return value;
      }
      return { ...value, unexpected: true };
    }
    case "string":
      return 7;
    default:
      return "not-a-valid-value";
  }
}

async function copyTree(from: string, to: string): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    const source = `${from}/${entry.name}`;
    const target = `${to}/${entry.name}`;
    if (entry.isDirectory) await copyTree(source, target);
    else if (entry.isFile) {
      await Deno.writeFile(target, await Deno.readFile(source));
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Child = {
  process: Deno.ChildProcess;
  output(): string;
  exited: Promise<number | null>;
  stop(): Promise<void>;
};

const PROBE_MAIN = `import { reportProblem } from "@lophn/cap-problem";
const config = JSON.parse(await Deno.readTextFile(new URL("probe.json", import.meta.url)));
const say = (value) => console.log("${PROBE_PREFIX}" + JSON.stringify(value));
if (config.mode === "report") {
  const result = reportProblem(config.code, config.details);
  const completion = await result.completion;
  say({ report_id: result.report_id, status: completion.status });
} else if (config.mode === "denied") {
  const attempts = {};
  const attempt = async (name, run) => {
    try { await run(); attempts[name] = "allowed"; } catch (error) { attempts[name] = error.name; }
  };
  await attempt("read", () => Deno.readTextFile(config.outside));
  await attempt("write", () => Deno.writeTextFile(config.outside + ".probe", "x"));
  await attempt("net", () => fetch("https://example.com/"));
  await attempt("env", () => Deno.env.get("HOME"));
  await attempt("run", () => new Deno.Command("/usr/bin/true").output());
  say(attempts);
} else if (config.mode === "unhandled") {
  setTimeout(() => { throw new Error("lophn-probe-unhandled"); }, 50);
  await new Promise(() => {});
}
`;

export async function createRealAppDriver(
  input: RealDriverInput,
): Promise<Result<RealDriver>> {
  const { plan, work } = input;
  const signer = await createCoreSigner();
  const received: ReceivedReport[] = [];
  const children = new Set<Child>();
  const known = createKnownSecretRegistry();
  known.register([REDACTION_CANARY]);
  const redaction = createRedactionEngine({ registry: known });
  const declared = new Set(plan.declared_codes);
  const scope = previewScopeOf(input.blueprint);
  const dataDir = `${work}/data`;
  const probeBundle = `${work}/probe-bundle`;
  const probeData = `${work}/probe-data`;
  await Deno.mkdir(dataDir, { recursive: true });
  await Deno.mkdir(probeData, { recursive: true });

  // 선언 안 code와 예약 code는 collector에 닿기 전에 여기서 거절한다. 예외 관측(`_exception`)은
  // 앱이 직접 부르는 통로가 아니라 observe-exception 경로로만 온다.
  async function redactedBody(details: unknown): Promise<string> {
    if (details === undefined) return "";
    const result = await redaction.redact({
      source: {
        concern: "problems/reporting",
        revision: "runner-intake",
        scope: "report_intake",
      },
      media_type: "application/json",
      audience: "storage",
      safe_fields: [],
      private_fields: [],
    }, JSON.stringify(details));
    return result.status === "passed" && result.content?.kind === "inline"
      ? result.content.value
      : "";
  }

  async function acceptReport(body: unknown): Promise<Response> {
    const parsed = reportProblemInputSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({
        ok: false,
        error: { code: "invalid_input", message: "report input is invalid" },
      }, { status: 400 });
    }
    const report = parsed.data;
    if (!declared.has(report.code) || report.code.startsWith("_")) {
      return Response.json({
        ok: false,
        error: {
          code: "invalid_input",
          message: "problem code is not declared",
        },
      }, { status: 400 });
    }
    const sent = await input.sink.report(report);
    if (!sent.ok) {
      return Response.json({ ok: false, error: sent.error }, { status: 503 });
    }
    received.push({
      report_id: report.report_id,
      code: report.code,
      invocation_id: report.invocation?.id ?? null,
      stored: await redactedBody(report.details),
    });
    return Response.json({ ok: true, value: sent.value });
  }

  async function acceptException(body: unknown): Promise<Response> {
    const sent = await input.sink.exception(body);
    const id = (body as { report_id?: unknown } | null)?.report_id;
    received.push({
      report_id: typeof id === "string" ? id : "",
      code: "_exception",
      invocation_id: null,
      stored: "",
    });
    return sent.ok
      ? Response.json({ ok: true, value: sent.value })
      : Response.json({ ok: false, error: sent.error }, { status: 503 });
  }

  // net·secret·문서 쓰기 대역은 apps/preview의 고정 대역이 받는다. 대역은 loopback 목적지를 받지 않으므로
  // 앱이 선언한 loopback 목적지는 대역 쪽의 고정 이름으로 바꿔 받고, 효과를 돌려줄 때 선언한 이름으로
  // 되돌린다.
  const mapHost = (host: string) =>
    isLoopbackHost(host.toLowerCase()) ? STAND_IN_HOST : host;
  const unmapHost = (host: string) =>
    host === STAND_IN_HOST ? declaredLoopback : host;
  const declaredLoopback = scope.net.find((entry) => isLoopbackHost(entry.host))
    ?.host ?? "127.0.0.1";
  const standScope = {
    ...scope,
    net: scope.net.map((entry) => ({ ...entry, host: mapHost(entry.host) })),
  };
  const rewrite = (body: unknown): unknown => {
    if (body === null || typeof body !== "object") return body;
    const copy = { ...(body as Record<string, unknown>) };
    if (typeof copy["host"] === "string") copy["host"] = mapHost(copy["host"]);
    const destination = copy["destination"] as { host?: unknown } | undefined;
    if (destination && typeof destination.host === "string") {
      copy["destination"] = { ...destination, host: mapHost(destination.host) };
    }
    return copy;
  };
  // 호출이 끝날 때까지 외부 요청에 일시 장애(503)로 답한다(fault=net의 주입). SDK는 읽기 요청을 다시
  // 부르므로 한 번만 실패시키면 앱이 장애를 보지 못한다.
  let failNet = false;
  const external = createPreviewExternalService(
    standScope,
    () => ok({ status: failNet ? 503 : 200, body: null }),
  );
  const secretStand = createPreviewSecretService(standScope);
  const stand = {
    ...createPreviewBrokerServices({ scope: standScope }),
    external,
    secrets: secretStand,
  };
  const child: BrokerChild = {
    app: APP_ID,
    release: null,
    mode: "test",
    processNonce: NONCE,
  };
  const endpoint = createBrokerEndpoint({
    session: { child, credential: CREDENTIAL },
    services: {
      ...stand.services,
      net: { request: (c, b) => external.request(c, rewrite(b)) },
      secrets: { use: (c, b) => secretStand.use(c, rewrite(b)) },
    },
  });
  await Deno.mkdir(input.sockets.broker.replace(/\/[^/]*$/, ""), {
    recursive: true,
  });
  await Deno.remove(input.sockets.broker).catch(() => undefined);
  const brokerServer = Deno.serve({
    path: input.sockets.broker,
    onListen() {},
  }, async (request) => {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path.startsWith("/v1/problems/")) {
      const body = await request.json().catch(() => null);
      if (path === "/v1/problems/observe-exception") {
        return await acceptException(body);
      }
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    }
    if (
      request.method === "POST" && path === "/_lophn/broker/problems/report"
    ) {
      const body = await request.json().catch(() => null);
      return await acceptReport(body);
    }
    return await endpoint.handle(request);
  });

  // 실제 앱 진입점이 쓰는 import map이다. bundle 안 상대 경로는 절대 URL로 푼다.
  async function importMapFor(
    bundle: string,
    app: string,
    file: string,
  ): Promise<string> {
    const map = JSON.parse(
      await Deno.readTextFile(`${input.bundle}/import-map.json`),
    ) as { imports: Record<string, string> };
    const imports: Record<string, string> = {};
    for (const [key, value] of Object.entries(map.imports)) {
      imports[key] = value.startsWith("./") || value.startsWith("../")
        ? new URL(value, `file://${bundle}/`).href
        : value;
    }
    imports["@lophn/app"] = `file://${app}`;
    imports["@lophn/base"] = input.base_module;
    await Deno.writeTextFile(file, JSON.stringify({ imports }));
    return file;
  }

  async function spawn(options: {
    bundle: string;
    app: string;
    data: string;
    direct: string;
    map: string;
    // 앱이 blueprint에 선언한 fs 권한이다. 사람이 grant한 것과 같은 모양으로 flag가 된다.
    grants?: ResolvedRequirement[];
  }): Promise<Child> {
    await Deno.remove(options.direct).catch(() => undefined);
    const flags = appFlags(
      options.grants ?? [],
      {
        bundle: options.bundle,
        data: options.data,
        brokerSocket: input.sockets.broker,
        directSocket: options.direct,
      },
      { ports: [] },
      [],
    );
    if (!flags.ok) throw new Error(flags.error.message);
    const line = JSON.stringify({
      app: APP_ID,
      release: null,
      bundle_hash: input.bundle_hash,
      mode: "test",
      process_nonce: NONCE,
      broker_socket: input.sockets.broker,
      direct_socket: options.direct,
      data_path: options.data,
      broker_credential: CREDENTIAL,
      verify_key: signer.verifyKey,
    });
    const process = new Deno.Command(input.deno, {
      args: appArgv({
        deno: input.deno,
        entry: input.entrypoint,
        flags: { ...flags.value, args: [...flags.value.args, DENO_HEAP_FLAG] },
        importMap: options.map,
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
      process,
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

  const connection = (
    commands: string[],
    actor: "user" | "machine" = "user",
  ) =>
    signer.signConnection({
      app: APP_ID,
      release: null,
      bundle_hash: input.bundle_hash,
      mode: "test",
      process_nonce: NONCE,
      actor,
      credential_ref: "cred-runner",
      screens: actor === "machine" ? ["control"] : [],
      screen_sizes: {},
      caller: null,
      commands,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    } as never).then((signed) => JSON.stringify(signed));

  async function direct(
    socket: string,
    path: string,
    body: unknown,
    authorization: string,
  ): Promise<{ status: number; body: unknown }> {
    return await unixDirectTransport(socket, {
      method: "POST",
      path,
      authorization,
      body,
    });
  }

  const opened = new Set<Child>();
  let app: Child | undefined;
  let appGone = false;
  async function ensureApp(): Promise<Child> {
    // 앱이 처리되지 않은 rejection으로 스스로 끝났으면 다음 호출을 위해 새로 띄운다.
    if (app && !appGone) return app;
    appGone = false;
    const map = await importMapFor(
      input.bundle,
      `${input.bundle}/main.ts`,
      `${work}/entry-map.json`,
    );
    app = await spawn({
      bundle: input.bundle,
      app: `${input.bundle}/main.ts`,
      data: dataDir,
      direct: input.sockets.direct,
      map,
      grants: input.blueprint.permissions.flatMap((permission) => {
        if (permission.kind !== "fs.read" && permission.kind !== "fs.write") {
          return [];
        }
        const scope = permission.scope as { path: string; recursive: boolean };
        return [{
          kind: permission.kind,
          scope: { ...scope, outsideLinks: [] },
          reason: permission.reason,
        }];
      }),
    });
    void app.exited.then(() => {
      appGone = true;
    });
    return app;
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
          const answered = await direct(
            input.sockets.direct,
            "/_lophn/control/probe",
            { process_nonce: NONCE },
            await connection([], "machine"),
          );
          if (answered.status === 200) {
            // write는 open 뒤에만 받는다. 준비가 끝난 앱을 한 번 연다(supervisor의 open과 같다).
            if (!opened.has(running)) {
              opened.add(running);
              await direct(
                input.sockets.direct,
                "/_lophn/control/open",
                { process_nonce: NONCE, release: null },
                await connection([], "machine"),
              );
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

  const commandOf = (key: string) =>
    input.blueprint.commands.find((command) => command.key === key);
  const schemaOf = (key: string): InputSchema | null =>
    (commandOf(key)?.input ?? null) as InputSchema | null;
  const validInput = (key: string): unknown => {
    if (key in input.inputs) return input.inputs[key];
    const schema = schemaOf(key);
    return schema === null ? undefined : validValue(schema);
  };

  // 한 번의 호출 동안 broker가 받은 보고를 모은다. 응답 뒤 늦게 오는 보고는 조용해질 때까지 기다린다.
  async function call(
    key: string,
    body: unknown,
    options: { proof?: unknown } = {},
  ) {
    await probeAttestation();
    const before = received.length;
    let response: { status: number; body: unknown };
    try {
      response = await direct(
        input.sockets.direct,
        "/_lophn/commands/invoke",
        {
          request_key: crypto.randomUUID(),
          command: key,
          ...(body === undefined || body === null ? {} : { input: body }),
          ...(options.proof === undefined ? {} : { proof: options.proof }),
        },
        await connection([key]),
      );
    } catch {
      // 응답을 받기 전에 앱이 끝났다(처리되지 않은 rejection으로 스스로 종료). 결과 모름이다.
      response = { status: 0, body: null };
    }
    let seen = received.length;
    for (let waited = 0; waited < 1500; waited += QUIET_MS) {
      await sleep(QUIET_MS);
      if (received.length === seen) break;
      seen = received.length;
    }
    return { response, reports: received.slice(before) };
  }

  const errorCode = (response: { body: unknown }): string | null =>
    ((response.body as { error?: { code?: string } } | null)?.error?.code) ??
      null;

  // DB 파일을 못 쓰게 한다. 앱이 저장소를 열 때마다 실패하고 호출 뒤에 되돌린다.
  async function withStoreFault<T>(run: () => Promise<T>): Promise<T> {
    const path = `${dataDir}/app.sqlite`;
    const saved = `${work}/app.sqlite.saved`;
    let had = false;
    try {
      await Deno.rename(path, saved);
      had = true;
    } catch { /* 아직 DB가 없다 */ }
    await Deno.writeTextFile(path, "not a database");
    try {
      return await run();
    } finally {
      await Deno.remove(path).catch(() => undefined);
      await Deno.remove(`${path}-wal`).catch(() => undefined);
      await Deno.remove(`${path}-shm`).catch(() => undefined);
      if (had) await Deno.rename(saved, path).catch(() => undefined);
    }
  }

  // 업무 데이터의 논리 상태 hash. 열려 있는 DB를 복사해 읽는다(WAL 바이트가 아니라 행을 본다).
  let snapshots = 0;
  async function businessState(): Promise<string> {
    const source = `${dataDir}/app.sqlite`;
    try {
      await Deno.stat(source);
    } catch {
      return createHash("sha256").update("{}").digest("hex");
    }
    snapshots += 1;
    const copy = `${work}/snap-${snapshots}`;
    await Deno.mkdir(copy, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        await Deno.writeFile(
          `${copy}/app.sqlite${suffix}`,
          await Deno.readFile(`${source}${suffix}`),
        );
      } catch { /* wal이 없을 수 있다 */ }
    }
    try {
      const db = new DatabaseSync(`${copy}/app.sqlite`, { readOnly: true });
      const journal = new Set(input.journal_tables ?? []);
      const tables = db.prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like 'lophn_%' order by name",
      ).all().map((row) => String(row["name"])).filter((name) =>
        !journal.has(name)
      );
      const dump: Record<string, unknown[]> = {};
      for (const table of tables) {
        const rows = db.prepare(`select * from "${table}" order by rowid`)
          .all().map((row) =>
            JSON.parse(
              JSON.stringify(
                row,
                (_key, value) =>
                  typeof value === "bigint" ? value.toString() : value,
              ),
            )
          );
        // 빈 표는 표가 없는 것과 같다: 처음 열 때 schema를 만드는 것은 업무 데이터 변경이 아니다.
        if (rows.length > 0) dump[table] = rows;
      }
      db.close();
      return createHash("sha256").update(JSON.stringify(dump)).digest("hex");
    } catch {
      return createHash("sha256").update("unreadable-database").digest("hex");
    } finally {
      await Deno.remove(copy, { recursive: true }).catch(() => undefined);
    }
  }

  function externalEffects(): number {
    return stand.external.requests.length + stand.secrets.uses.length;
  }

  // platform probe: bundle 사본에 앱 진입 파일만 probe로 바꾼 폴더에서 같은 진입점·같은 SDK·같은 flag로
  // 짧은 자식을 띄운다. 앱 code가 아니라 앱 자식의 격리와 SDK 보고 경로를 본다.
  let probeReady = false;
  let lastProbeOutput = "";
  async function runProbe(
    config: JsonObject,
    wait: "line" | "exit",
  ): Promise<{ line: JsonObject | null; reports: ReceivedReport[] }> {
    if (!probeReady) {
      await copyTree(input.bundle, probeBundle);
      await Deno.writeTextFile(`${probeBundle}/main.ts`, PROBE_MAIN);
      probeReady = true;
    }
    await Deno.writeTextFile(
      `${probeBundle}/probe.json`,
      JSON.stringify(config),
    );
    const map = await importMapFor(
      probeBundle,
      `${probeBundle}/main.ts`,
      `${work}/probe-map.json`,
    );
    const before = received.length;
    const running = await spawn({
      bundle: probeBundle,
      app: `${probeBundle}/main.ts`,
      data: probeData,
      direct: input.sockets.probe,
      map,
    });
    const deadline = Date.now() + READY_MS;
    let line: JsonObject | null = null;
    let gone = false;
    let exitCode: number | null = null;
    void running.exited.then((code) => {
      gone = true;
      exitCode = code;
    });
    while (Date.now() < deadline) {
      const found = running.output().split("\n").find((text) =>
        text.startsWith(PROBE_PREFIX)
      );
      if (found && wait === "line") {
        line = JSON.parse(found.slice(PROBE_PREFIX.length)) as JsonObject;
        break;
      }
      if (gone) break;
      await sleep(40);
    }
    await sleep(QUIET_MS);
    lastProbeOutput = running.output();
    // 예상 밖 종료는 supervisor 역할인 runner가 관측한다. 앱 안의 observer는 종료가 먼저라 보내지 못할 수
    // 있어, 종료 근거(exit code·stderr)를 crash observer(apps/runtime)로 같은 접수 통로에 올린다.
    if (gone && exitCode !== 0) {
      await crash.observe({
        kind: "exit",
        intended: false,
        exitCode,
        stderrTail: lastProbeOutput.slice(-2000),
      });
    }
    await running.stop();
    return { line, reports: received.slice(before) };
  }

  const reportThrough = async (code: string, details?: unknown) => {
    const ran = await runProbe({ mode: "report", code, details }, "line");
    const accepted = ran.line?.["status"] === "accepted";
    const id = String(ran.line?.["report_id"] ?? "");
    const report = ran.reports.find((item) => item.report_id === id) ?? null;
    return {
      accepted: accepted && report !== null,
      reason: accepted ? "accepted" : "refused",
      report,
    };
  };

  const crash = createCrashObserver({
    ids: createIdSource({ clock: systemClock, random: cryptoRandom }),
    now: () => Date.now(),
    report: async (observed) => {
      await acceptException(observed);
    },
  });

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

  // 앞선 상태를 만들고 그 결과를 입력에 묶는다(예: 완료할 항목을 먼저 추가하고 그 id를 쓴다).
  const pending = new Map<string, unknown>();
  async function preparedBody(command: string): Promise<unknown> {
    const body = validInput(command);
    const prepared = input.prepare?.[command];
    if (!prepared) return body;
    const first = await call(prepared.command, prepared.input);
    const result = (first.response.body as {
      result?: { result?: Record<string, unknown> };
    } | null)?.result?.result;
    const bound = Object.fromEntries(
      Object.entries(prepared.bind ?? {}).map((
        [field, from],
      ) => [field, result?.[from]]),
    );
    return { ...(body as Record<string, unknown>), ...bound };
  }

  let migrations = 0;
  const driver: RealDriver = {
    probe: probeAttestation,
    async invoke(command, body, options) {
      const run = () => call(command, body);
      const inject = options?.inject_failure === true;
      if (inject && options?.fault === "net") failNet = true;
      const done = inject && options?.fault !== "none" &&
          options?.fault !== "net"
        ? await withStoreFault(run)
        : await run();
      failNet = false;
      const noted = done.reports.find((report) => report.invocation_id);
      const response = done.response.body as { invocation?: string } | null;
      return {
        invocation_id: response?.invocation ?? noted?.invocation_id ??
          "inv_not_recorded",
        outcome: done.response.status === 200 ? "ok" : "error",
        reports: done.reports,
        response: done.response,
      };
    },
    reportDirect: (code) => reportThrough(code),
    sdkReceipt: () => reportThrough(plan.declared_codes[0] ?? "_none"),
    async throwUnhandled() {
      return (await runProbe({ mode: "unhandled" }, "exit")).reports;
    },
    reportWithSecret: (secret) =>
      reportThrough(plan.declared_codes[0] ?? "_none", { note: secret }),
    async attemptDenied() {
      const ran = await runProbe({
        mode: "denied",
        outside: `${work}/outside.txt`,
      }, "line");
      const attempts = ran.line ?? {};
      const names = Object.keys(attempts);
      const denied = names.length > 0 &&
        names.every((name) => attempts[name] === "NotCapable");
      return {
        denied,
        reason: denied
          ? "grant 없는 읽기·쓰기·net·env·run이 모두 NotCapable이다"
          : `거절되지 않은 접근이 있다: ${JSON.stringify(attempts)}`,
      };
    },
    view: input.view,
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
            activation_seq: "1",
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
          activation_seq: "2",
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
    async probeRead(command) {
      const bad = await call(command, invalidValue(schemaOf(command)));
      const before = await businessState();
      const effects = externalEffects();
      await call(command, validInput(command));
      const after = await businessState();
      return {
        invalid_input_rejected: bad.response.status === 400 &&
          errorCode(bad.response) === "invalid_input",
        business_before: before,
        business_after: after,
        external_effects: externalEffects() - effects,
      };
    },
    async runAutomation(key, approval) {
      const task = input.blueprint.automatic_tasks.find((item) =>
        item.key === key
      );
      const command = task ? commandOf(task.command) : undefined;
      if (!task || !command || command.confirm) {
        return { ran: false, approvals_used: 0, reason: "not_runnable" };
      }
      // 외부 효과 command는 사람이 켤 때 한 번 승인한 것만 돈다(apps/automations).
      if (command.effect === "external" && approval !== "once") {
        return { ran: false, approvals_used: 0, reason: "approval_required" };
      }
      const done = await call(
        task.command,
        task.input === undefined ? undefined : task.input,
      );
      const ran = done.response.status === 200;
      return {
        ran,
        approvals_used: ran && command.effect === "external" ? 1 : 0,
        reason: ran ? "ran" : "command_failed",
      };
    },
    async attemptConfirmAutomation(command) {
      // confirm command는 실행 proof 없이는 돌지 않는다. proof 없이 부르고 거절을 본다.
      const done = await call(command, validInput(command));
      return {
        refused: done.response.status !== 200,
        reason: `status ${done.response.status}`,
      };
    },
    async useSecret(use) {
      const target = plan.net[0] ?? { host: "none.invalid", port: 1 };
      const command =
        plan.command_details.find((item) => item.effect === "external") ??
          plan.command_details[0];
      const done = await secretStand.use(
        child,
        rewrite({
          process_nonce: NONCE,
          mode: "test",
          release: "rel_01arz3ndektsv4rrffq69g5fav",
          invocation: null,
          command: command?.key ?? use.operation,
          input_hash: "0".repeat(64),
          name: use.name,
          destination: { scheme: "https", ...target },
        }),
      );
      return { allowed: done.ok, approvals_requested: 0 };
    },
    async exerciseAdapters() {
      for (const command of plan.command_details) {
        if (command.effect !== "external") continue;
        await call(command.key, validInput(command.key));
      }
      return {
        net: stand.external.requests.map((request) => ({
          host: unmapHost(request.host),
          port: request.port,
        })),
        secret_uses: stand.secrets.uses.map((use) => ({ name: use.name })),
        document_writes: [],
        real_connections: [],
      };
    },
    businessState,
    async prepareChange(command) {
      pending.set(command, await preparedBody(command));
    },
    async change(command) {
      const taken = pending.get(command);
      pending.delete(command);
      const body = taken ?? await preparedBody(command);
      const done = await call(command, body);
      const result = (done.response.body as {
        result?: { revert?: unknown };
      } | null)?.result;
      const revert = result?.revert;
      const target = plan.command_details.find((item) => item.key === command)
        ?.revert.command;
      return {
        ok: done.response.status === 200,
        revert: revert && target
          ? JSON.stringify({ command: target, input: revert })
          : null,
        state_after: await businessState(),
      };
    },
    async revert(token) {
      const { command, input: body } = JSON.parse(token) as {
        command: string;
        input: unknown;
      };
      const done = await call(command, body);
      const code = errorCode(done.response);
      return {
        ok: done.response.status === 200,
        code: done.response.status === 200
          ? null
          : code === "conflict"
          ? "conflict"
          : code === "invalid_input"
          ? "invalid_input"
          : "already_reverted",
        state_after: await businessState(),
      };
    },
    async command(key, body) {
      const done = await call(key, body);
      return done.response.status === 200
        ? ok(
          (done.response.body as { result?: unknown } | null)?.result ?? null,
        )
        : err({
          code: "unavailable",
          message: `command failed with status ${done.response.status}: ${
            JSON.stringify(done.response.body)
          }`,
        });
    },
    received: () => received,
    probeOutput: () => lastProbeOutput,
    async close() {
      for (const running of [...children]) await running.stop();
      await brokerServer.shutdown();
    },
  };
  return ok(driver);
}

export function missingDriver(reason: string): Result<never> {
  return err({ code: "unavailable", message: reason });
}
