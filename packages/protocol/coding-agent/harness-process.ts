// terminal의 foreground process argv로 어느 harness가 도는지 고른다. 순수 함수다. 화면 글자는 읽지 않는다.
import { HARNESS_ADAPTERS } from "./harness-adapter.ts";
import type { HarnessId } from "./harness-id.ts";

const INTERPRETER = /^(node(js)?|bun|deno|python[\d.]*)$/;

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function matches(
  id: HarnessId,
  hit: { name?: string; script?: string; code?: string },
): boolean {
  const adapter = HARNESS_ADAPTERS[id];
  const rule = adapter.process;
  const { name, script, code } = hit;
  if (name !== undefined) {
    if (adapter.commands.includes(name) || rule.names?.includes(name)) {
      return true;
    }
    if (
      rule.versioned?.some((prefix) => new RegExp(`^${prefix}\\d`).test(name))
    ) {
      return true;
    }
  }
  if (script !== undefined && rule.packages?.some((p) => script.includes(p))) {
    return true;
  }
  return code !== undefined && rule.code !== undefined &&
    code.includes(rule.code);
}

export function harnessOfProcess(argv: readonly string[]): HarnessId | null {
  const first = argv[0];
  if (first === undefined) return null;
  const exe = basename(first);
  const hit: { name?: string; script?: string; code?: string } = {};
  if (INTERPRETER.test(exe)) {
    // interpreter 옵션(`python3 -I`, `node --inspect`)은 script나 code 앞에 올 수 있어 건너뛴다.
    let i = 1;
    while (i < argv.length && argv[i]!.startsWith("-") && argv[i] !== "-c") i++;
    if (argv[i] === "-c") {
      hit.code = argv[i + 1];
    } else if (argv[i] !== undefined) {
      hit.script = argv[i];
      hit.name = basename(argv[i]!).replace(/\.(js|mjs|cjs|ts|py)$/, "");
    }
  } else {
    hit.name = exe;
  }
  for (const id of Object.keys(HARNESS_ADAPTERS) as HarnessId[]) {
    if (matches(id, hit)) return id;
  }
  return null;
}
