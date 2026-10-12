// fake harness TUI 모드다. 수리 script와 별개이고 claim·보고를
// 하지 않는다. 테스트 catalog의 ExecutionSpec만 따른다. argv는 prompt를 한 인자로
// 받고 끝나며, stdin_after_ready는 readiness를 낸 뒤 host가 쓰는 bracketed paste
// 한 번만 읽는다. 준비 신호가 없으면 stdin으로 prompt를 받지 않는다.
import {
  TEST_CATALOG,
  type TestExecution,
} from "../../fixtures/coding-agent/catalog.ts";

const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";
const encoder = new TextEncoder();

type Match = { entry: TestExecution; prompt: string | null };

function fail(message: string): never {
  Deno.stderr.writeSync(encoder.encode(`fake harness: ${message}\n`));
  Deno.exit(2);
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((item, index) => item === right[index]);
}

function checkCatalog(): void {
  const modes = new Set(
    TEST_CATALOG.executions.map((entry) => entry.execution.prompt_delivery),
  );
  if (!modes.has("argv") || !modes.has("stdin_after_ready")) {
    fail("테스트 catalog에 argv와 stdin_after_ready가 둘 다 있어야 한다");
  }
  for (const entry of TEST_CATALOG.executions) {
    const execution = entry.execution;
    if (execution.transport !== "pty") fail("TUI는 pty ExecutionSpec만 따른다");
    if (execution.launch_argv[0] !== TEST_CATALOG.command) {
      fail("launch_argv는 감지 command로 시작한다");
    }
    if (execution.prompt_delivery === "stdin_after_ready") {
      if (entry.prompt_flag !== null) {
        fail("stdin_after_ready는 argv prompt flag가 없다");
      }
      if (entry.readiness === null || entry.readiness === "") {
        fail("stdin_after_ready readiness가 없다");
      }
    } else if (entry.readiness !== null) {
      fail("argv prompt는 readiness를 기다리지 않는다");
    }
  }
}

// host는 executable을 argv.slice(1)로 연다. launch_argv[0]은 명령 이름이다.
function matchOf(entry: TestExecution, args: readonly string[]): Match | null {
  const execution = entry.execution;
  const base = execution.launch_argv.slice(1);
  if (execution.prompt_delivery === "argv") {
    const flag = entry.prompt_flag;
    if (flag === null) {
      if (
        args.length !== base.length + 1 ||
        !same(args.slice(0, base.length), base)
      ) {
        return null;
      }
      return { entry, prompt: args[base.length] ?? null };
    }
    if (
      args.length !== base.length + 2 ||
      !same(args.slice(0, base.length), base) ||
      args[base.length] !== flag
    ) return null;
    return { entry, prompt: args[base.length + 1] ?? null };
  }
  if (!same(args, base)) return null;
  return { entry, prompt: null };
}

function matched(args: readonly string[]): Match[] {
  const found: Match[] = [];
  for (const entry of TEST_CATALOG.executions) {
    const match = matchOf(entry, args);
    if (match !== null) found.push(match);
  }
  return found;
}

async function emit(
  mode: "argv" | "stdin_after_ready",
  prompt: string,
): Promise<void> {
  await Deno.stdout.write(encoder.encode(
    JSON.stringify({ prompt_delivery: mode, prompt }) + "\n",
  ));
}

// shell host는 paste 안에 prompt를 넣고 마지막 CR 하나로 제출한다.
async function readPrompt(): Promise<string> {
  const reader = Deno.stdin.readable.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      if (text.startsWith(PASTE_START)) {
        const end = text.indexOf(PASTE_END, PASTE_START.length);
        if (end >= 0) {
          const cr = text.indexOf("\r", end + PASTE_END.length);
          if (cr >= 0) return text.slice(PASTE_START.length, end);
        }
      } else if (text.length >= PASTE_START.length) {
        fail("stdin prompt는 bracketed paste와 CR 하나여야 한다");
      }
      const chunk = await reader.read();
      if (chunk.done) fail("stdin prompt가 readiness 뒤에 오지 않았다");
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function main(): Promise<void> {
  checkCatalog();
  const found = matched(Deno.args);
  const match = found.length === 1 ? found[0] : undefined;
  if (match === undefined) {
    fail(
      found.length === 0
        ? "argv가 테스트 catalog의 ExecutionSpec과 맞지 않는다"
        : "argv에 맞는 ExecutionSpec이 둘이다",
    );
  }
  const { entry, prompt } = match;
  if (entry.execution.prompt_delivery === "argv") {
    if (prompt === null) fail("argv prompt가 없다");
    await emit("argv", prompt);
    return;
  }
  const readiness = entry.readiness;
  if (readiness === null) fail("stdin_after_ready readiness가 없다");
  await Deno.stdout.write(encoder.encode(readiness));
  await emit("stdin_after_ready", await readPrompt());
}

if (import.meta.main) await main();
