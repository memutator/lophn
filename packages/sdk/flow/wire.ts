// flow process와 core의 stdin·stdout 통로와 host port다.
// 원본은 packages/protocol/workflows/flow-wire.ts다. SDK는 protocol을 import하지 않아
// 모양을 손으로 옮겼다. 모양이 어긋나면 host가 요청을 값 오류로 돌려보낸다.
import process from "node:process";

export type Outcome<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; reason: string; message: string };

export type NamedAgent = {
  role:
    | "lophn"
    | "project_manager"
    | "app_engineer"
    | "operator"
    | "coding_agent";
  place?: { project: string } | { app: string };
  name?: string;
};

export type AgentRequest = {
  agent: NamedAgent;
  prompt: string;
  input?: unknown;
  schema?: Record<string, unknown>;
};
export type ToolRequest = { app: string; tool: string; input?: unknown };
export type ReportRequest = { step: string; text: string; next?: string };

export type RequestBody =
  | ({ type: "agent" } & AgentRequest)
  | ({ type: "tool" } & ToolRequest)
  | ({ type: "report" } & ReportRequest);

type StartLine = { type: "start"; instance: string; input: string };
type ResponseLine = { type: "response"; id: string; outcome: Outcome };

export type FlowPort = {
  instance: string;
  input: string;
  request(body: RequestBody): Promise<Outcome>;
};

// process -> core 한 줄 상한이다. flow-host의 FLOW_LINE_MAX_BYTES와 같은 값이다.
const LINE_MAX_BYTES = 1024 * 1024;

export const FLOW_PORT = Symbol.for("lophn.flow");

type Store = Record<symbol, unknown>;

export function currentPort(): FlowPort | undefined {
  const port = (globalThis as Store)[FLOW_PORT];
  return port && typeof port === "object" ? (port as FlowPort) : undefined;
}

const pending = new Map<string, (outcome: Outcome) => void>();
let nextId = 0;
let writing = Promise.resolve();
let writes = 0;
let wake: (() => void) | null = null;

function fail(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

function valueError(message: string): Outcome {
  return { ok: false, reason: "invalid_input", message };
}

// entry.ts가 flow.ts를 import하기 전에 process.stdout.write를 stderr로 돌린다. 통로는 이 module을
// 읽을 때 잡아 둔 원래 write만 쓴다. entry.ts가 이 module을 먼저 import하므로 잡기가 돌리기보다 앞선다.
const writeToCore = process.stdout.write.bind(process.stdout);

// node stream의 write는 한 번에 bytes를 다 받는다. callback이 flush를 알려 준다.
function writeAll(bytes: Uint8Array): Promise<void> {
  return new Promise((settle, reject) => {
    writeToCore(bytes, (error?: Error | null) =>
      error ? reject(error) : settle(),
    );
  });
}

function request(body: RequestBody): Promise<Outcome> {
  const id = String(++nextId);
  let bytes: Uint8Array;
  try {
    bytes = new TextEncoder().encode(JSON.stringify({ ...body, id }) + "\n");
  } catch (error) {
    return Promise.resolve(
      valueError(
        `request is not JSON: ${error instanceof Error ? error.message : error}`,
      ),
    );
  }
  // 넘는 줄을 보내면 host가 통로가 깨진 줄로 보고 process를 죽인다.
  if (bytes.length > LINE_MAX_BYTES) {
    return Promise.resolve(valueError("request is over 1 MiB"));
  }
  return new Promise((resolve) => {
    pending.set(id, resolve);
    writes++;
    writing = writing
      .then(() => writeAll(bytes))
      .catch((error) => fail(1, `stdout write failed: ${error}`))
      .finally(() => {
        writes--;
        wake?.();
      });
  });
}

function onLine(line: string): void {
  let message: ResponseLine;
  try {
    message = JSON.parse(line);
  } catch {
    console.error("flow: ignored a line that is not JSON");
    return;
  }
  const resolve =
    message?.type === "response" ? pending.get(message.id) : undefined;
  if (!resolve) {
    console.error("flow: ignored an unknown line or response id");
    return;
  }
  pending.delete(message.id);
  resolve(message.outcome);
  wake?.();
}

async function readLines(onFirst: (line: string) => void): Promise<void> {
  let buffer = "";
  let first = true;
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buffer += chunk;
    for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (first) {
        first = false;
        onFirst(line);
      } else onLine(line);
    }
  }
  // core가 죽어도 process가 고아로 남지 않게 한다. 기다리던 요청은 버린다.
  fail(1, "stdin closed");
}

// 첫 줄(start)을 받고 port를 놓은 뒤 resolve한다. 그 뒤 줄은 response로 읽는다.
export function connect(): Promise<void> {
  return new Promise((resolve) => {
    void readLines((line) => {
      let start: StartLine;
      try {
        start = JSON.parse(line);
      } catch {
        return fail(2, "flow: first line is not JSON");
      }
      if (
        start?.type !== "start" ||
        typeof start.instance !== "string" ||
        typeof start.input !== "string"
      )
        return fail(2, "flow: first line is not a start message");
      const port: FlowPort = {
        instance: start.instance,
        input: start.input,
        request,
      };
      (globalThis as Store)[FLOW_PORT] = port;
      resolve();
    });
  });
}

// 응답을 못 받은 요청과 쓰는 중인 줄이 없을 때까지 기다린다.
// 응답을 받은 쪽이 이어서 새 요청을 낼 수 있어 한 번 양보한 뒤 다시 본다.
export async function settled(): Promise<void> {
  for (;;) {
    while (pending.size > 0 || writes > 0) {
      await new Promise<void>((resolve) => (wake = resolve));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (pending.size === 0 && writes === 0) return;
  }
}
