// 앱 프로세스 진입점. exception observer를 앱 code load 전에 설치한다.
// observer specifier는 bundle 고정 import map이 해석하는 SDK specifier다.
import { createIdSource, systemClock } from "@lophn/base";
import { installCrashExit } from "./crash.ts";
import { BROKER_PATHS } from "./limits.ts";
import { ensureAppApiPort } from "./app-api-port.ts";
import { publishReady, startRuntime } from "./startup.ts";
import { startControlServer } from "./control-server.ts";
import { parseAppStart } from "./start-input.ts";
import type { Blueprint } from "../../../../protocol/apps/blueprint/mod.ts";
import type { BrokerTransport } from "./broker-client.ts";

const OBSERVER = "@lophn/cap-problem";
const APP = "@lophn/app";

type ObservedInvocation = {
  id: string;
  record_missing_reason: null;
};

type ObserverFactory = {
  createExceptionObserver: (deps: {
    now: () => string;
    newId: (prefix: string) => string;
    sleep: (ms: number) => Promise<void>;
    currentInvocation: () => null;
  }) => (transport: (input: unknown) => Promise<unknown>) => () => void;
  // 앱 code의 reportProblem이 쓰는 reporter. 없는 module(시험의 대역)은 설치하지 않는다.
  createProblemReporter?: (deps: {
    transport: (input: unknown) => Promise<unknown>;
    now: () => string;
    newId: (prefix: string) => string;
    sleep: (ms: number) => Promise<void>;
    currentInvocation: () => ObservedInvocation | null;
  }) => unknown;
  installProblemReporter?: (reporter: unknown) => void;
};

type MainDeps = {
  readLine: () => Promise<string | null>;
  importModule: (specifier: string) => Promise<unknown>;
  clock?: { now: () => string; nowMs: () => number };
  ids?: { newId: (prefix: string) => string };
  blueprint: Blueprint;
  broker: BrokerTransport;
  dataSchema: number;
  // 예외 보고는 이 transport 한 곳이다. crash exit는 같은 실패를 다시 보내지 않는다.
  reportTransport: (input: unknown) => Promise<unknown>;
  // 앱 code의 reportProblem 보고 transport. 없으면 reporter를 설치하지 않는다.
  problemTransport?: (input: unknown) => Promise<unknown>;
  exit?: (code: number) => void;
  writeStderr?: (text: string) => void;
};

async function main(deps: MainDeps): Promise<void> {
  const clock = deps.clock ?? systemClock;
  const ids = deps.ids ?? createIdSource({
    clock,
    random: { fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes) },
  });
  const writeStderr = deps.writeStderr ??
    ((text: string) => Deno.stderr.writeSync(new TextEncoder().encode(text)));
  const exit = deps.exit ?? ((code: number) => Deno.exit(code));
  const observer = await deps.importModule(OBSERVER) as ObserverFactory;
  const install = observer.createExceptionObserver({
    now: () => clock.now(),
    newId: (prefix) => ids.newId(prefix),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    currentInvocation: () => null,
  });
  install(deps.reportTransport);
  if (
    deps.problemTransport && observer.createProblemReporter &&
    observer.installProblemReporter
  ) {
    const schedule = ensureAppApiPort();
    observer.installProblemReporter(observer.createProblemReporter({
      transport: deps.problemTransport,
      now: () => clock.now(),
      newId: (prefix) => ids.newId(prefix),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      // 실제 invocation 문맥만 붙인다. 문맥이 없으면 만들지 않는다.
      currentInvocation: () => {
        const invocation = schedule.current()?.invocation;
        return invocation
          ? {
            id: invocation,
            record_missing_reason: null,
          }
          : null;
      },
    }));
  }
  installCrashExit({ writeStderr, exit });
  const line = await deps.readLine();
  if (!line) throw new Error("app start input missing");
  const started = startRuntime({
    line,
    blueprint: deps.blueprint,
    broker: deps.broker,
    dataSchema: deps.dataSchema,
  });
  started.state.reportCaught = (error, invocation) => {
    const message = error.message;
    const stack = error.stack ?? null;
    void deps.reportTransport({
      report_id: ids.newId("rpt"),
      observed_at: clock.now(),
      observation: "error",
      error: {
        name: error.name.trim() !== "" ? error.name : "Error",
        message,
        message_missing_reason: null,
        stack,
        stack_missing_reason: stack === null
          ? { reason: "not a string" }
          : null,
      },
      error_missing_reason: null,
      invocation: {
        id: invocation,
        record_missing_reason: null,
      },
    }).catch(() => {
      // 보고 실패가 command 결과나 프로세스 종료를 바꾸지 않는다.
    });
  };
  try {
    await deps.importModule(APP);
  } catch (error) {
    started.state.store.end();
    throw error;
  }
  const startChangeset = started.state.store.end();
  // supervisor는 control socket이 열려야 준비를 확인하고 그때 ready 통보의 changeset을 읽는다. 그래서
  // 시작이 DB를 바꿨으면 changeset을 먼저 알리고 control server를 연다. 알리지 못하면 changeset이
  // 사라지므로 시작을 실패로 본다.
  if (
    startChangeset !== null &&
    !(await publishReady(started.state, startChangeset))
  ) {
    throw new Error("ready notice was refused");
  }
  startControlServer(started.state, { exit });
}

// 앱 프로세스를 띄운다. 직접 실행하면 이 파일이, 준비한 bundle의 진입 파일(`bundle/runtime-entry.ts`가 만든다)이면
// 그 파일이 부른다. 시작이 실패하면 이유를 stderr로 알리고 끝난다.
async function run(): Promise<void> {
  const reason = await boot().catch((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  );
  if (reason) {
    Deno.stderr.writeSync(new TextEncoder().encode(`${reason}\n`));
    Deno.exit(1);
  }
}

if (import.meta.main) await run();

// supervisor와 test runner가 시작 입력을 stdin 한 줄로 준다. broker socket과 credential은 그
// 줄에서, blueprint는 `@lophn/app`이 가리키는 bundle 폴더에서 읽는다(앱 자식에는 env
// 권한이 없다). 하나라도 없으면 stub으로 뜨지 않고 실패로 끝난다.
async function boot(): Promise<void> {
  const line = await readStdinLine();
  if (!line) throw new Error("app start input missing");
  const start = parseAppStart(line);
  if (!start) throw new Error("app start input is invalid");
  const bundleDir = bundleDirectory();
  const blueprint = await readBlueprint(bundleDir);
  if (!blueprint) throw new Error("app blueprint is missing");
  const broker = start.broker_socket;
  const credential = start.broker_credential;
  await main({
    readLine: () => Promise.resolve(line),
    importModule: (specifier) => import(specifier),
    blueprint,
    broker: unixBroker(broker),
    dataSchema: await bundleDataSchema(bundleDir),
    reportTransport: (input) =>
      reportException(broker, credential, start, input),
    problemTransport: (input) =>
      reportProblemToBroker(
        broker,
        credential,
        start,
        input,
      ),
  });
}

// `@lophn/app`이 가리키는 main.ts의 폴더다. 봉인 bundle 사본이면 blueprint.json·migrations가
// 이 폴더에 있다.
function bundleDirectory(): string {
  const url = new URL(import.meta.resolve("@lophn/app"));
  return url.pathname.replace(/\/[^/]*$/, "");
}

// bundle의 data schema는 `migrations/<from>-<to>.sql` 중 가장 큰 `to`다. migration이 없으면 DB를 쓰지
// 않는 앱(0)이다.
async function bundleDataSchema(bundleDir: string): Promise<number> {
  let schema = 0;
  try {
    for await (const entry of Deno.readDir(`${bundleDir}/migrations`)) {
      const match = /^(\d+)-(\d+)\.sql$/.exec(entry.name);
      if (match) schema = Math.max(schema, Number(match[2]));
    }
  } catch { /* migrations 폴더가 없다 */ }
  return schema;
}

function unixBroker(socketPath: string): BrokerTransport {
  return (request) =>
    postUnix(socketPath, request.path, request.credential, request.body);
}

async function reportException(
  socketPath: string,
  credential: string,
  child: { process_nonce: string; mode: string },
  input: unknown,
): Promise<unknown> {
  const response = await postUnix(
    socketPath,
    BROKER_PATHS.problemsObserve,
    credential,
    {
      process_nonce: child.process_nonce,
      mode: child.mode,
      observation: input,
    },
  );
  return response.body;
}

const REPORT_ERROR_CODES = new Set([
  "invalid_input",
  "not_found",
  "forbidden",
  "unauthorized",
  "conflict",
  "unavailable",
  "internal",
]);

// broker는 본문의 nonce·mode가 자식 연결과 같아야 받는다. SDK 입력에는 그 신원이 없고,
// 첫 전송 전에 고정한 report id·시각·invocation이 있다. 그 값을 빼면 재전송이 새 발생이 된다.
function problemReportBody(
  child: { process_nonce: string; mode: string },
  input: unknown,
): Record<string, unknown> {
  const source = input !== null && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const body: Record<string, unknown> = {
    process_nonce: child.process_nonce,
    mode: child.mode,
    name: source.name,
    message: source.message,
  };
  if (source.details !== undefined) body.details = source.details;
  if (typeof source.report_id === "string") body.report_id = source.report_id;
  if (typeof source.observed_at === "string") {
    body.observed_at = source.observed_at;
  }
  if ("invocation" in source) body.invocation = source.invocation;
  return body;
}

type ReportAcceptance =
  & {
    report: string;
    snapshot: string;
  }
  & ({ problem: string; diagnostic_scope: null } | {
    problem: null;
    diagnostic_scope: string;
  });

function acceptanceOf(body: unknown): ReportAcceptance | undefined {
  if (body === null || typeof body !== "object") return;
  const value = body as Record<string, unknown>;
  if (typeof value.report !== "string" || typeof value.snapshot !== "string") {
    return;
  }
  if (typeof value.problem === "string" && value.diagnostic_scope === null) {
    return {
      report: value.report,
      snapshot: value.snapshot,
      problem: value.problem,
      diagnostic_scope: null,
    };
  }
  if (
    value.problem === null && typeof value.diagnostic_scope === "string" &&
    /\S/.test(value.diagnostic_scope)
  ) {
    return {
      report: value.report,
      snapshot: value.snapshot,
      problem: null,
      diagnostic_scope: value.diagnostic_scope,
    };
  }
}

// 앱 code의 선언 code 보고. broker의 problems/report로 보내고, SDK transport가 읽는
// 접수 Result로 돌려준다. 본문만 넘기면 성공도 응답 유실로 보여 같은 발생을 다시 보낸다.
async function reportProblemToBroker(
  socketPath: string,
  credential: string,
  child: { process_nonce: string; mode: string },
  input: unknown,
): Promise<unknown> {
  const response = await postUnix(
    socketPath,
    BROKER_PATHS.problemsReport,
    credential,
    problemReportBody(child, input),
  );
  const accepted = acceptanceOf(response.body);
  if (response.status === 200 && accepted) {
    return { ok: true, value: accepted };
  }
  const error = response.body !== null && typeof response.body === "object" &&
      "error" in response.body
    ? (response.body as { error?: { code?: unknown; message?: unknown } }).error
    : undefined;
  const code = typeof error?.code === "string" &&
      REPORT_ERROR_CODES.has(error.code)
    ? error.code
    : !Number.isInteger(response.status) || response.status >= 500
    ? "unavailable"
    : "invalid_input";
  const message = typeof error?.message === "string" && /\S/.test(error.message)
    ? error.message
    : "the report was refused";
  return { ok: false, error: { code, message } };
}

async function postUnix(
  socketPath: string,
  path: string,
  credential: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const conn = await Deno.connect({ path: socketPath, transport: "unix" });
  const encoded = JSON.stringify(body);
  const payload = [
    `POST ${path} HTTP/1.1`,
    "host: lophn.invalid",
    `authorization: ${credential}`,
    "content-type: application/json",
    `content-length: ${new TextEncoder().encode(encoded).byteLength}`,
    "connection: close",
    "",
    encoded,
  ].join("\r\n");
  await conn.write(new TextEncoder().encode(payload));
  const chunks: Uint8Array[] = [];
  const buffer = new Uint8Array(8192);
  while (true) {
    const read = await conn.read(buffer);
    if (read === null) break;
    chunks.push(buffer.slice(0, read));
  }
  conn.close();
  const text = new TextDecoder().decode(concat(chunks));
  const status = Number(text.split(" ")[1]);
  const raw = text.slice(text.indexOf("\r\n\r\n") + 4);
  try {
    return { status, body: JSON.parse(raw) };
  } catch {
    return { status: Number.isFinite(status) ? status : 503, body: null };
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function readStdinLine(): Promise<string | null> {
  const result = await Deno.stdin.readable.getReader().read();
  return result.value ? new TextDecoder().decode(result.value) : null;
}

async function readBlueprint(
  bundleDir: string,
): Promise<Blueprint | undefined> {
  try {
    return JSON.parse(
      await Deno.readTextFile(`${bundleDir}/blueprint.json`),
    ) as Blueprint;
  } catch {
    return;
  }
}
