// 앱 프로세스 진입점. exception observer를 앱 code load 전에 설치한다.
// observer는 `@lophn/cap-problem`에서 정적으로 온다. 이름은 core의 package.json에 선언해 설치본이 같이 싣는다.

import type { Buffer } from "node:buffer";
import { writeSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createExceptionObserver } from "@lophn/cap-problem";
import {
  createIdSource,
  ERROR_CODES,
  type ErrorCode,
  type Result,
  systemClock,
} from "@lophn/base";
import type { AppDeclaration } from "../../../../protocol/apps/declaration/mod.ts";
import type {
  ExceptionObservationInput,
  ExceptionObserverTransport,
  ReportAcceptance,
  ReportTransportError,
} from "../../../../protocol/problems/sdk-report.ts";
import type { BrokerTransport } from "./broker-client.ts";
import { startControlServer } from "./control-server.ts";
import { installCrashExit } from "./crash.ts";
import { BROKER_PATHS, SOCKET_HOST } from "./limits.ts";
import { parseAppStart } from "./start-input.ts";
import { publishReady, startRuntime } from "./startup.ts";
import { openSyncStore, runsOnPhone } from "./sync.ts";
import type { NodeDatabase } from "../../../../protocol/apps/sync/node-db.ts";

const CRASH_REPORT_WAIT_MS = 2_000;

type MainDeps = {
  readLine: () => Promise<string | null>;
  importModule: (specifier: string) => Promise<unknown>;
  // 앱의 main.ts URL. 사본 root에서 오는 앱 code 하나다.
  appModule: string;
  clock?: { now: () => string; nowMs: () => number };
  ids?: { newId: (prefix: string) => string };
  declaration: AppDeclaration;
  broker: BrokerTransport;
  dataSchema: number;
  // 예외 관측은 이 transport 한 곳이다. crash exit는 같은 실패를 다시 보내지 않는다.
  reportTransport: ExceptionObserverTransport;
  exit?: (code: number) => void;
  writeStderr?: (text: string) => void;
};

async function main(deps: MainDeps): Promise<void> {
  const clock = deps.clock ?? systemClock;
  const ids =
    deps.ids ??
    createIdSource({
      clock,
      random: { fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes) },
    });
  // process.exit은 pipe에 쌓인 비동기 쓰기를 자를 수 있어 stderr에 동기로 쓴다.
  const writeStderr =
    deps.writeStderr ?? ((text: string) => writeSync(2, text));
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const install = createExceptionObserver({
    now: () => clock.now(),
    newId: (prefix) => ids.newId(prefix),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    currentInvocation: () => null,
  });
  install(deps.reportTransport);
  installCrashExit({
    writeStderr,
    exit,
    // 보고 전달이 막혀도 죽는 일을 미루지 않도록 상한을 둔다.
    beforeExit: () =>
      Promise.race([
        install.settled?.() ?? Promise.resolve(),
        new Promise<void>((resolve) =>
          setTimeout(resolve, CRASH_REPORT_WAIT_MS),
        ),
      ]),
  });
  const line = await deps.readLine();
  if (!line) throw new Error("app start input missing");
  const started = startRuntime({
    line,
    declaration: deps.declaration,
    broker: deps.broker,
    bundleDir: bundleDirectory(deps.appModule),
    dataSchema: deps.dataSchema,
  });
  started.state.reportCaught = (error, invocation) => {
    const message = error.message;
    const stack = error.stack ?? null;
    void deps
      .reportTransport({
        report_id: ids.newId("rpt"),
        observed_at: clock.now(),
        observation: "error",
        error: {
          name: error.name.trim() !== "" ? error.name : "Error",
          message,
          message_missing_reason: null,
          stack,
          stack_missing_reason:
            stack === null ? { reason: "not a string" } : null,
        },
        error_missing_reason: null,
        invocation:
          invocation === null
            ? null
            : { id: invocation, record_missing_reason: null },
      })
      .catch(() => {
        // 보고 실패가 command 결과나 프로세스 종료를 바꾸지 않는다.
      });
  };
  try {
    await deps.importModule(deps.appModule);
  } catch (error) {
    started.state.store.end();
    throw error;
  }
  const startChangeset = started.state.store.end();
  let startHlc: bigint | null = null;
  // sync 앱은 앱 code가 cap-store를 실은 뒤 그 연결에 sync 표를 건다. DB를 쓰지 않는 앱(migration이 없거나
  // cap-store를 싣지 않음)은 sync 일을 하지 않는다.
  if (
    started.state.identity.mode === "live" &&
    deps.dataSchema > 0 &&
    runsOnPhone(deps.declaration)
  ) {
    const database = started.state.store.database();
    if (database !== null) {
      const sync = openSyncStore({
        database: database as NodeDatabase,
        node: ids.newId("nod"),
        record: started.state.store,
        nowMs: () => clock.nowMs(),
        startChangeset,
      });
      started.state.sync = sync;
      startHlc = sync.startHlc;
    }
  }
  // supervisor는 control socket이 열려야 준비를 확인하고 그때 ready 통보의 changeset을 읽는다. 그래서
  // 시작이 DB를 바꿨으면 changeset을 먼저 알리고 control server를 연다. 알리지 못하면 changeset이
  // 사라지므로 시작을 실패로 본다.
  if (
    startChangeset !== null &&
    !(await publishReady(started.state, startChangeset, startHlc))
  ) {
    throw new Error("ready notice was refused");
  }
  startControlServer(started.state, { exit });
}

// 앱 프로세스를 띄운다. 준비한 bundle의 진입 파일(`lophn-entry.ts`)이 앱 `main.ts`의 URL로 부른다.
// 시작이 실패하면 이유를 stderr로 알리고 끝난다.
// export를 지우지 않는다: bundle 진입 파일은 문자열로 만들어져(`bundle/runtime-entry.ts`) import를 찾는 도구가 보지 못한다.
export async function run(appModule: string): Promise<void> {
  const reason = await boot(appModule).catch((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  );
  if (reason) {
    writeSync(2, `${reason}\n`);
    process.exit(1);
  }
}

// supervisor와 preview가 시작 입력을 stdin 한 줄로 준다. broker socket과 credential은 그
// 줄에서, 선언은 시작 module 옆(사본 root)에서 읽는다. 하나라도 없으면 stub으로 뜨지 않고 실패로 끝난다.
async function boot(appModule: string): Promise<void> {
  const line = await readStdinLine();
  if (!line) throw new Error("app start input missing");
  const start = parseAppStart(line);
  if (!start) throw new Error("app start input is invalid");
  const bundleDir = bundleDirectory(appModule);
  const declaration = await readDeclaration(bundleDir);
  if (!declaration) throw new Error("app declaration is missing");
  const broker = start.broker_socket;
  const credential = start.broker_credential;
  await main({
    readLine: () => Promise.resolve(line),
    importModule: (specifier) => import(specifier),
    appModule,
    declaration,
    broker: unixBroker(broker),
    dataSchema: await bundleDataSchema(bundleDir),
    reportTransport: (input) =>
      reportException(broker, credential, start, input),
  });
}

// 앱 `main.ts`가 있는 사본 root다. declaration.json·migrations가 이 폴더에 있다.
function bundleDirectory(appModule: string): string {
  return dirname(fileURLToPath(new URL(appModule)));
}

// bundle의 data schema는 `migrations/<from>-<to>.sql` 중 가장 큰 `to`다. migration이 없으면 DB를 쓰지
// 않는 앱(0)이다.
async function bundleDataSchema(bundleDir: string): Promise<number> {
  let schema = 0;
  try {
    for (const name of await readdir(`${bundleDir}/migrations`)) {
      const match = /^(\d+)-(\d+)\.sql$/.exec(name);
      if (match) schema = Math.max(schema, Number(match[2]));
    }
  } catch {
    /* migrations 폴더가 없다 */
  }
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
  input: Readonly<ExceptionObservationInput>,
): Promise<Result<ReportAcceptance, ReportTransportError>> {
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
  // SDK의 deliver가 읽는 Result 꼴로 바꿔 넘긴다. 날 body를 넘기면 200 응답에서 ok를 못 읽어 던진다.
  if (response.status === 200) return { ok: true, value: { written: true } };
  const error = (
    response.body as { error?: { code?: unknown; message?: unknown } } | null
  )?.error;
  return {
    ok: false,
    error: {
      code: ERROR_CODES.includes(error?.code as ErrorCode)
        ? (error?.code as ErrorCode)
        : "unavailable",
      message:
        typeof error?.message === "string"
          ? error.message
          : "the exception was not accepted",
    },
  };
}

function postUnix(
  socketPath: string,
  path: string,
  credential: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const encoded = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const call = httpRequest(
      {
        socketPath,
        path,
        method: "POST",
        // 한 요청마다 연결을 닫는다. 남은 연결이 process를 붙들지 않게.
        agent: false,
        headers: {
          host: SOCKET_HOST,
          authorization: credential,
          "content-type": "application/json",
          "content-length": String(
            new TextEncoder().encode(encoded).byteLength,
          ),
        },
      },
      (response) => {
        const chunks: Uint8Array[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const status = response.statusCode ?? 503;
          try {
            resolve({
              status,
              body: JSON.parse(new TextDecoder().decode(concat(chunks))),
            });
          } catch {
            resolve({ status, body: null });
          }
        });
      },
    );
    call.on("error", reject);
    call.end(encoded);
  });
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
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Uint8Array);
  }
  return chunks.length === 0 ? null : new TextDecoder().decode(concat(chunks));
}

async function readDeclaration(
  bundleDir: string,
): Promise<AppDeclaration | undefined> {
  try {
    return JSON.parse(
      await readFile(`${bundleDir}/declaration.json`, "utf8"),
    ) as AppDeclaration;
  } catch {
    return;
  }
}
