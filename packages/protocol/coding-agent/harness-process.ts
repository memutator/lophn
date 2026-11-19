// terminal의 foreground process argv로 어느 harness가 도는지 고른다. 순수 함수다. 화면 글자는 읽지 않는다.
import { HARNESS_ADAPTERS } from "./harness-adapter.ts";
import type { HarnessId } from "./harness-id.ts";

const INTERPRETER = /^(node(js)?|bun|deno|python[\d.]*)$/;
const SESSION_ID = /^[A-Za-z0-9_][A-Za-z0-9._:-]{0,199}$/;

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function argsStart(argv: readonly string[]): number {
  const first = argv[0];
  if (first === undefined) return 1;
  const exe = basename(first);
  if (!INTERPRETER.test(exe)) return 1;
  let i = 1;
  while (i < argv.length && argv[i]!.startsWith("-") && argv[i] !== "-c") i++;
  return argv[i] === "-c" ? argv.length : i + 1;
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
  return (
    code !== undefined && rule.code !== undefined && code.includes(rule.code)
  );
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

/**
 * foreground process argv에서 그 harness의 resume 인자가 가리키는 CLI session id를 읽는다.
 * `--flag <id>`와 `--flag=<id>` 모두 읽고, 값이 flag처럼 보이거나 경로 조각이면 버린다.
 */
export function sessionOfProcess(
  harness: HarnessId,
  argv: readonly string[],
): string | null {
  const resume = HARNESS_ADAPTERS[harness].session.resume;
  if (resume === null) return null;
  const idx = resume.findIndex((part) => part.includes("{id}"));
  if (idx < 0) return null;
  const part = resume[idx]!;
  let flag: string | null = null;
  let prefix: string | null = null;
  let suffix = "";
  if (part === "{id}") {
    if (idx === 0) return null;
    flag = resume[idx - 1]!;
    if (flag.startsWith("-")) prefix = `${flag}=`;
  } else {
    const split = part.split("{id}");
    prefix = split[0] ?? "";
    suffix = split[1] ?? "";
    if (prefix.endsWith("=") && suffix === "") {
      flag = prefix.slice(0, -1);
    }
  }
  const valid = (raw: string | undefined): string | null =>
    raw !== undefined && !raw.includes("..") && SESSION_ID.test(raw)
      ? raw
      : null;

  for (let i = argsStart(argv); i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--") break;
    if (flag !== null && arg === flag) {
      return valid(argv[i + 1]);
    }
    if (
      prefix !== null &&
      arg.startsWith(prefix) &&
      (suffix === "" || arg.endsWith(suffix))
    ) {
      const value = arg.slice(
        prefix.length,
        suffix === "" ? undefined : arg.length - suffix.length,
      );
      return valid(value);
    }
  }
  return null;
}
