// 앱 프로세스 진입점. exception observer를 앱 code load 전에 설치한다.
// observer specifier는 bundle 고정 import map이 해석하는 SDK specifier다.
import { createIdSource, systemClock } from "@lophn/base";
import { installCrashExit } from "./crash.ts";
import { startRuntime } from "./startup.ts";
import { startDirectServer } from "./direct-server.ts";
import { type AutomationTimers, installAutomations } from "./automation.ts";
import type { Blueprint } from "../../blueprint/mod.ts";
import type { BrokerTransport } from "./broker-client.ts";

const OBSERVER = "@lophn/cap-problem";
const APP = "@lophn/app";

type ObserverFactory = {
  createExceptionObserver: (deps: {
    now: () => string;
    newId: (prefix: string) => string;
    sleep: (ms: number) => Promise<void>;
    currentInvocation: () => null;
  }) => (transport: (input: unknown) => Promise<unknown>) => () => void;
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

// supervisor(T8)와 test runner가 시작 입력·blueprint·broker를 준다.
// 하나라도 없으면 stub으로 뜨지 않고 실패로 끝난다.
async function boot(): Promise<void> {
  const line = await readStdinLine();
  if (!line) throw new Error("app start input missing");
  const blueprint = await readBlueprint();
  if (!blueprint) throw new Error("app blueprint is missing");
  const broker = Deno.env.get("LOPHN_APP_BROKER");
  if (!broker) throw new Error("app broker is missing");
  await main({
    readLine: () => Promise.resolve(line),
    importModule: (specifier) => import(specifier),
    blueprint,
    broker: unixBroker(broker),
    dataSchema: Number(Deno.env.get("LOPHN_APP_DATA_SCHEMA") ?? "0"),
    reportTransport: (input) => reportException(broker, input),
  });
}

function unixBroker(socketPath: string): BrokerTransport {
  return (request) =>
    postUnix(socketPath, request.path, request.credential, request.body);
}

async function reportException(
  socketPath: string,
  input: unknown,
): Promise<unknown> {
  const credential = Deno.env.get("LOPHN_APP_BROKER_CREDENTIAL") ?? "";
  const response = await postUnix(
    socketPath,
    "/v1/problems/observe-exception",
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

async function readBlueprint(): Promise<Blueprint | undefined> {
  const path = Deno.env.get("LOPHN_APP_BLUEPRINT");
  if (!path) return;
  try {
    return JSON.parse(await Deno.readTextFile(path)) as Blueprint;
  } catch {
    return;
  }
}
