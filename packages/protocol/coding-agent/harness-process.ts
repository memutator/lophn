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

const GUI_RESUME_VALUE_FLAGS: Partial<Record<HarnessId, readonly string[]>> = {
  claude: ["--resume", "-r"],
  antigravity: ["--resume", "--conversation"],
  codex: ["--resume"],
  opencode: ["--resume", "--session", "-s"],
  omp: ["--resume", "-r"],
};

// lophn shell integration이 private server용으로 자동 주입하는 flag. GUI로 넘길 때 원본 flag로 보지 않는다.
const WRAPPER_FLAGS: Partial<Record<HarnessId, readonly string[]>> = {
  codex: ["--no-daemon"],
  opencode: ["--standalone"],
};

function validSessionId(raw: string | undefined): string | null {
  return raw !== undefined && !raw.includes("..") && SESSION_ID.test(raw)
    ? raw
    : null;
}

/**
 * `<harness> --gui ...` 또는 foreground TUI argv에서 resume session id와 나머지 CLI flag들을 나눈다.
 * `--` 앞의 `--gui`와 wrapper 자동 flag(`--no-daemon`, `--standalone`), resume 인자는 떼고 나머지는 순서대로 남긴다.
 * resume flag의 값이 비었거나 session id 규칙에 맞지 않으면 실패한다.
 */
export function parseGuiLaunchArgs(
  harness: HarnessId,
  rawArgs: readonly string[],
):
  | { ok: true; resume?: string; args: string[] }
  | { ok: false; message: string } {
  const valueFlags = GUI_RESUME_VALUE_FLAGS[harness] ?? ["--resume"];
  const wrapper = WRAPPER_FLAGS[harness] ?? [];
  const args: string[] = [];
  let resume: string | undefined;
  let literal = false;

  for (let i = 0; i < rawArgs.length; i += 1) {
    const token = rawArgs[i]!;
    if (literal) {
      args.push(token);
      continue;
    }
    if (token === "--") {
      literal = true;
      args.push(token);
      continue;
    }
    if (token === "--gui" || wrapper.includes(token)) continue;

    // `codex resume <id>` 형태
    if (harness === "codex" && token === "resume") {
      const next = rawArgs[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        const id = validSessionId(next);
        if (id === null) {
          return { ok: false, message: `invalid session id: ${next}` };
        }
        resume = id;
        i += 1;
        continue;
      }
      continue;
    }

    const eqFlag = valueFlags.find(
      (flag) => flag.startsWith("--") && token.startsWith(`${flag}=`),
    );
    if (eqFlag !== undefined) {
      const raw = token.slice(eqFlag.length + 1);
      const id = validSessionId(raw);
      if (id === null) {
        return {
          ok: false,
          message: `invalid session id for ${eqFlag}: ${raw}`,
        };
      }
      resume = id;
      continue;
    }
    if (valueFlags.includes(token)) {
      const raw = rawArgs[i + 1];
      const id = validSessionId(raw);
      if (id === null) {
        return {
          ok: false,
          message:
            raw === undefined
              ? `${token} needs a session id`
              : `invalid session id for ${token}: ${raw}`,
        };
      }
      resume = id;
      i += 1;
      continue;
    }
    args.push(token);
  }

  return { ok: true, ...(resume === undefined ? {} : { resume }), args };
}

/**
 * foreground process argv에서 실행 파일·resume 인자·wrapper 자동 flag를 뺀 launch flag 목록을 읽는다.
 * TUI → GUI 전환 시 사람이 TUI에 준 flag를 GUI에 그대로 이어 갈 때 쓴다.
 */
export function launchArgsOfProcess(
  harness: HarnessId,
  argv: readonly string[],
): string[] {
  const slice = argv.slice(argsStart(argv));
  const parsed = parseGuiLaunchArgs(harness, slice);
  if (parsed.ok) return parsed.args;
  const wrapper = WRAPPER_FLAGS[harness] ?? [];
  return slice.filter((token) => token !== "--gui" && !wrapper.includes(token));
}
