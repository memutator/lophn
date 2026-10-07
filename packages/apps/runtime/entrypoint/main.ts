// 앱 프로세스 진입점. exception observer를 앱 code load 전에 설치한다.
// observer specifier는 bundle 고정 import map이 해석하는 SDK specifier다.
import { createIdSource, systemClock } from "@lophn/base";
import { installCrashExit } from "./crash.ts";
import { BROKER_PATHS } from "./limits.ts";
import { bundleScreenFiles } from "./screen-files.ts";
import { ensureSchedulePort } from "./schedule.ts";
import { startRuntime } from "./startup.ts";
import { startDirectServer } from "./direct-server.ts";
import { parseAppStart } from "./start-input.ts";
import { type AutomationTimers, installAutomations } from "./automation.ts";
import type { Blueprint } from "../../blueprint/mod.ts";
import type { BrokerTransport } from "./broker-client.ts";

const OBSERVER = "@lophn/cap-problem";
const APP = "@lophn/app";

type ObservedInvocation = {
  id: string;
  binding: "sdk_context";
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

export type MainDeps = {
  readLine: () => Promise<string | null>;
  importModule: (specifier: string) => Promise<unknown>;
  clock?: { now: () => string; nowMs: () => number };
  ids?: { newId: (prefix: string) => string };
  blueprint: Blueprint;
  broker: BrokerTransport;
  dataSchema: number;
  // 예외 보고는 이 transport 한 곳이다. crash exit는 같은 실패를 다시 보내지 않는다.
  reportTransport: (input: unknown) => Promise<unknown>;
  // 앱 code의 reportProblem 보고 transport. 없으면 reporter를 설치하지 않는다(apps/sdk#R33).
  problemTransport?: (input: unknown) => Promise<unknown>;
  // 화면 자원. 실제 앱 프로세스는 bundle 사본의 screens/에서 읽는다(shell#T37).
  screenBytes?: (screen: string, path: string) => Uint8Array | undefined;
  contentType?: (path: string) => string;
  // automation 시계의 tick·타이머. 시험이 가짜 시계를 준다.
  automationTimers?: AutomationTimers;
  exit?: (code: number) => void;
  writeStderr?: (text: string) => void;
};

export async function main(deps: MainDeps): Promise<void> {
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
    const schedule = ensureSchedulePort();
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
            binding: "sdk_context",
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
    clock,
    ids,
    broker: deps.broker,
    dataSchema: deps.dataSchema,
    screenBytes: deps.screenBytes,
    contentType: deps.contentType,
  });
  await deps.importModule(APP);
  installAutomations(started.state, deps.automationTimers);
  startDirectServer(started.state);
}

if (import.meta.main) {
  const reason = await boot().catch((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  );
  if (reason) {
    Deno.stderr.writeSync(new TextEncoder().encode(`${reason}\n`));
    Deno.exit(1);
  }
}

// supervisor(T8)와 test runner가 시작 입력을 stdin 한 줄로 준다. broker socket과 credential은 그
// 줄에서, blueprint와 화면 자원은 `@lophn/app`이 가리키는 bundle 폴더에서 읽는다(앱 자식에는 env
// 권한이 없다). 하나라도 없으면 stub으로 뜨지 않고 실패로 끝난다.
async function boot(): Promise<void> {
  const line = await readStdinLine();
  if (!line) throw new Error("app start input missing");
  const start = parseAppStart(line);
  if (!start) throw new Error("app start input is invalid");
  const bundleDir = bundleDirectory();
  const blueprint = await readBlueprint(bundleDir);
  if (!blueprint) throw new Error("app blueprint is missing");
  // 화면 자원은 blueprint와 같은 bundle 사본의 screens/ 아래다.
  const screens = bundleScreenFiles(bundleDir);
  const broker = start.broker_socket;
  const credential = start.broker_credential;
  await main({
    readLine: () => Promise.resolve(line),
    importModule: (specifier) => import(specifier),
    blueprint,
    broker: unixBroker(broker),
    dataSchema: await bundleDataSchema(bundleDir),
    reportTransport: (input) => reportException(broker, credential, input),
    problemTransport: (input) =>
      reportProblemToBroker(broker, credential, input),
    screenBytes: screens.screenBytes,
    contentType: screens.contentType,
  });
}

// `@lophn/app`이 가리키는 main.ts의 폴더다. 봉인 bundle 사본이면 blueprint.json·migrations·screens가
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
  input: unknown,
): Promise<unknown> {
  const response = await postUnix(
    socketPath,
    "/v1/problems/observe-exception",
    credential,
    input,
  );
  return response.body;
}

// 앱 code의 선언 code 보고. broker의 problems/report 통로로 보내고 응답 본문을 그대로 돌려준다.
async function reportProblemToBroker(
  socketPath: string,
  credential: string,
  input: unknown,
): Promise<unknown> {
  const response = await postUnix(
    socketPath,
    BROKER_PATHS.problemsReport,
    credential,
    input,
  );
  return response.body;
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
