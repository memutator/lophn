// fake harness TUI다(coding-agent#T41, sessions#R5). PATH fixture로 감지하고
// 테스트 catalog의 ExecutionSpec(argv prompt, stdin_after_ready)대로 prompt를
// 한 번만 받는지 본다. claim은 하지 않는다. 사람 home은 열지 않는다.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../packages/base/mod.ts";
import {
  catalogOf,
  discover,
  type FilesPort,
  type HarnessDefinition,
} from "../../packages/coding-agent/harnesses/mod.ts";
import {
  TEST_CATALOG,
  type TestExecution,
} from "../../fixtures/coding-agent/catalog.ts";

const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";
const PROMPT = "작업\n두 번째 줄 'quote' \"$HOME\" `tick` ; rm -rf /";
const EXECUTABLE = fileURLToPath(
  new URL("../../fixtures/coding-agent/bin/fake-harness", import.meta.url),
);

function filesOf(home: string, bin: string): FilesPort {
  const allowed = (dir: string) => dir === bin || dir.startsWith(`${home}/`);
  return {
    list(dir) {
      if (!allowed(dir)) {
        return err({ code: "unavailable", message: "범위 밖 list" });
      }
      try {
        const names: string[] = [];
        for (const entry of Deno.readDirSync(dir)) names.push(entry.name);
        return ok(names);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return ok(null);
        return err({ code: "unavailable", message: "list 실패" });
      }
    },
    executable(path) {
      if (!allowed(dirname(path))) {
        return err({ code: "unavailable", message: "범위 밖 executable" });
      }
      try {
        const stat = Deno.statSync(path);
        if (!stat.isFile) return ok(null);
        return ok(((stat.mode ?? 0) & 0o111) !== 0);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return ok(null);
        return err({ code: "unavailable", message: "stat 실패" });
      }
    },
  };
}

// discover는 detection과 environments만 본다. harness id는 쓰지 않아 host를
// 지원하는 정의에 테스트 catalog의 command만 얹는다.
function definitionOf(): HarnessDefinition {
  const base = catalogOf("claude");
  assert(base !== undefined);
  return {
    ...base,
    detection: { commands: [{ name: TEST_CATALOG.command, aliases: [] }] },
  };
}

// host와 같다. argv[0]는 명령 이름이라 프로세스에는 slice(1)만 간다.
function processArgs(entry: TestExecution, prompt: string): string[] {
  const base = entry.execution.launch_argv.slice(1);
  if (entry.execution.prompt_delivery === "argv") {
    return entry.prompt_flag === null
      ? [...base, prompt]
      : [...base, entry.prompt_flag, prompt];
  }
  return [...base];
}

function childEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: `${dirname(Deno.execPath())}:/usr/bin:/bin`,
    HOME: home,
  };
  const denoDir = Deno.env.get("DENO_DIR");
  if (denoDir !== undefined) env.DENO_DIR = denoDir;
  return env;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}

async function run(
  home: string,
  args: string[],
  deliver: (
    child: Deno.ChildProcess,
    stdout: ReadableStreamDefaultReader<Uint8Array>,
  ) => Promise<string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = new Deno.Command(EXECUTABLE, {
    args,
    cwd: home,
    env: childEnv(home),
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const stderrTask = collect(child.stderr);
  const stdout = child.stdout.getReader();
  const killer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // 이미 끝났다.
    }
  }, 30_000);
  try {
    const text = await deliver(child, stdout);
    const status = await child.status;
    return { code: status.code, stdout: text, stderr: await stderrTask };
  } finally {
    clearTimeout(killer);
    try {
      child.kill("SIGKILL");
    } catch {
      // 이미 끝났다.
    }
    try {
      await child.stdin.close();
    } catch {
      // 이미 닫혔다.
    }
    stdout.releaseLock();
    await child.status;
    await stderrTask.catch(() => "");
  }
}

async function readSome(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ready: (text: string) => boolean,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  while (!ready(text)) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

function receipt(mode: string, prompt: string): string {
  return JSON.stringify({ prompt_delivery: mode, prompt }) + "\n";
}

Deno.test("coding-agent/sessions#R5: PATH fixture의 fake harness TUI는 테스트 catalog의 argv prompt와 stdin_after_ready ExecutionSpec대로 prompt를 한 번만 받는다", async () => {
  const modes = TEST_CATALOG.executions.map((entry) =>
    entry.execution.prompt_delivery
  ).sort();
  assertEquals(modes, ["argv", "stdin_after_ready"]);
  const home = await Deno.makeTempDir({ prefix: "lophn-fake-harness-" });
  try {
    const found = discover(
      definitionOf(),
      { environment: { kind: "host", identity: "native" }, profile_id: null },
      {
        files: filesOf(home, dirname(EXECUTABLE)),
        path: dirname(EXECUTABLE),
        home,
      },
    );
    assert(found.ok, found.ok ? "" : found.error.message);
    assertEquals(found.value.discovery, "detected");
    assertEquals(found.value.selected, EXECUTABLE);
    assertEquals(found.value.candidates.length, 1);
    assertEquals(found.value.candidates[0]?.source, "PATH");

    for (const entry of TEST_CATALOG.executions) {
      const mode = entry.execution.prompt_delivery;
      assertEquals(entry.execution.transport, "pty");
      const result = await run(
        home,
        processArgs(entry, PROMPT),
        async (child, stdout) => {
          if (mode === "argv") {
            await child.stdin.close();
            return await readSome(stdout, (text) => text.endsWith("\n"));
          }
          const readiness = entry.readiness ?? "";
          let seen = "";
          const decoder = new TextDecoder();
          while (!seen.includes(readiness)) {
            const chunk = await stdout.read();
            if (chunk.done) break;
            seen += decoder.decode(chunk.value, { stream: true });
          }
          assert(
            seen.startsWith(readiness),
            `readiness 전에 끝났다: ${JSON.stringify(seen)}`,
          );
          const writer = child.stdin.getWriter();
          await writer.write(new TextEncoder().encode(
            `${PASTE_START}${PROMPT}${PASTE_END}\r`,
          ));
          await writer.close();
          while (true) {
            const chunk = await stdout.read();
            if (chunk.done) break;
            seen += decoder.decode(chunk.value, { stream: true });
          }
          return seen + decoder.decode();
        },
      );
      assertEquals(
        result.code,
        0,
        result.stderr || result.stdout,
      );
      const expected = mode === "stdin_after_ready"
        ? `${entry.readiness}${receipt(mode, PROMPT)}`
        : receipt(mode, PROMPT);
      assertEquals(result.stdout, expected);
    }
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
