// 앱 프로세스 진입점. exception observer를 앱 code load 전에 설치한다.
// observer specifier는 bundle 고정 import map이 해석하는 SDK specifier다.
import { createIdSource, systemClock } from "@lophn/base";
import { installCrashExit } from "./crash.ts";
import { BROKER_PATHS } from "./limits.ts";
import { publishReady, startRuntime } from "./startup.ts";
import { startControlServer } from "./control-server.ts";
import { parseAppStart } from "./start-input.ts";
import type { AppDeclaration } from "../../../../protocol/apps/declaration/mod.ts";
import type { BrokerTransport } from "./broker-client.ts";

const OBSERVER = "@lophn/cap-problem";
const APP = "@lophn/app";
const CRASH_REPORT_WAIT_MS = 2_000;

type ObserverFactory = {
  createExceptionObserver: (deps: {
    now: () => string;
    newId: (prefix: string) => string;
    sleep: (ms: number) => Promise<void>;
    currentInvocation: () => null;
  }) => ((transport: (input: unknown) => Promise<unknown>) => () => void) & {
    settled?: () => Promise<void>;
  };
};

type MainDeps = {
  readLine: () => Promise<string | null>;
  importModule: (specifier: string) => Promise<unknown>;
  clock?: { now: () => string; nowMs: () => number };
  ids?: { newId: (prefix: string) => string };
  declaration: AppDeclaration;
  broker: BrokerTransport;
  dataSchema: number;
  // 예외 관측은 이 transport 한 곳이다. crash exit는 같은 실패를 다시 보내지 않는다.
  reportTransport: (input: unknown) => Promise<unknown>;
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
  installCrashExit({
    writeStderr,
    exit,
    // 보고 전달이 막혀도 죽는 일을 미루지 않도록 상한을 둔다.
    beforeExit: () =>
      Promise.race([
        install.settled?.() ?? Promise.resolve(),
        new Promise<void>((resolve) =>
          setTimeout(resolve, CRASH_REPORT_WAIT_MS)
        ),
      ]),
  });
  const line = await deps.readLine();
  if (!line) throw new Error("app start input missing");
  const started = startRuntime({
    line,
    declaration: deps.declaration,
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
// export를 지우지 않는다: bundle 진입 파일은 문자열로 만들어져(`bundle/runtime-entry.ts`) import를 찾는 도구가 보지 못한다.
export async function run(): Promise<void> {
  const reason = await boot().catch((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  );
  if (reason) {
    Deno.stderr.writeSync(new TextEncoder().encode(`${reason}\n`));
    Deno.exit(1);
  }
}

if (import.meta.main) await run();

// supervisor와 preview가 시작 입력을 stdin 한 줄로 준다. broker socket과 credential은 그
// 줄에서, 선언은 `@lophn/app`이 가리키는 bundle 폴더에서 읽는다(앱 자식에는 env
// 권한이 없다). 하나라도 없으면 stub으로 뜨지 않고 실패로 끝난다.
async function boot(): Promise<void> {
  const line = await readStdinLine();
  if (!line) throw new Error("app start input missing");
  const start = parseAppStart(line);
  if (!start) throw new Error("app start input is invalid");
  const bundleDir = bundleDirectory();
  const declaration = await readDeclaration(bundleDir);
  if (!declaration) throw new Error("app declaration is missing");
  const broker = start.broker_socket;
  const credential = start.broker_credential;
  await main({
    readLine: () => Promise.resolve(line),
    importModule: (specifier) => import(specifier),
    declaration,
    broker: unixBroker(broker),
    dataSchema: await bundleDataSchema(bundleDir),
    reportTransport: (input) =>
      reportException(broker, credential, start, input),
  });
}

// `@lophn/app`이 가리키는 main.ts의 폴더다. 봉인 bundle 사본이면 declaration.json·migrations가
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
  // SDK의 deliver가 읽는 Result 꼴로 바꿔 넘긴다. 날 body를 넘기면 200 응답에서 ok를 못 읽어 던진다.
  if (response.status === 200) return { ok: true, value: response.body };
  const error =
    (response.body as { error?: { code?: unknown; message?: unknown } } | null)
      ?.error;
  return {
    ok: false,
    error: {
      code: typeof error?.code === "string" ? error.code : "unavailable",
      message: typeof error?.message === "string"
        ? error.message
        : "the exception was not accepted",
    },
  };
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
  // Conn.write는 요청 전체보다 적게 쓰고 돌아올 수 있다. 큰 net/fetch 본문이 잘리지 않게 끝까지 쓴다.
  const bytes = new TextEncoder().encode(payload);
  for (let sent = 0; sent < bytes.length;) {
    sent += await conn.write(bytes.subarray(sent));
  }
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

async function readDeclaration(
  bundleDir: string,
): Promise<AppDeclaration | undefined> {
  try {
    return JSON.parse(
      await Deno.readTextFile(`${bundleDir}/declaration.json`),
    ) as AppDeclaration;
  } catch {
    return;
  }
}
