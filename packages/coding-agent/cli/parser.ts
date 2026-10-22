// CLI argv parser. 정본 이름은 `lophn <group> <command>`다. 별칭·implicit stdin·모르는 option은 없다.
// 위치 인자는 command 이름과 command가 받는 값(`hook <harness> <event>`, `agent run <prompt>`,
// `tool call <app> <tool>`, `run wait|show|cancel <run>`, `workflow start|report|stop|show`)뿐이고, 나머지 입력은 JSON 하나다.

export type ParsedArgs = {
  positional: string[];
  json: boolean;
  help: boolean;
  idempotencyKey: string | undefined;
  input: string | undefined;
  inputFile: string | undefined;
  agent: string | undefined;
  session: string | undefined;
  schema: string | undefined;
  step: string | undefined;
  next: string | undefined;
  async: boolean;
  errors: string[];
};

const VALUE_FLAGS = [
  "--idempotency-key",
  "--input",
  "--input-file",
  "--agent",
  "--session",
  "--schema",
  "--step",
  "--next",
] as const;

// argv를 읽어 구조화 입력으로 바꾼다. 모르는 flag·값 없는 flag·flag 중복은 errors에 남기고
// 실행 전 거절에 쓴다. stdin "-"는 지원하지 않는다.
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    positional: [],
    json: false,
    help: false,
    idempotencyKey: undefined,
    input: undefined,
    inputFile: undefined,
    agent: undefined,
    session: undefined,
    schema: undefined,
    step: undefined,
    next: undefined,
    async: false,
    errors: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--async") {
      parsed.async = true;
    } else if (arg === "--help") {
      parsed.help = true;
    } else if (arg.startsWith("-") && arg !== "-") {
      if (!(VALUE_FLAGS as readonly string[]).includes(arg)) {
        parsed.errors.push(`알 수 없는 option이다: ${arg}`);
        continue;
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        parsed.errors.push(`option에 값이 없다: ${arg}`);
        continue;
      }
      index += 1;
      assign(parsed, arg, value);
    } else {
      parsed.positional.push(arg);
    }
  }
  if (parsed.input !== undefined && parsed.inputFile !== undefined) {
    parsed.errors.push("input and input_file are exclusive");
  }
  if (parsed.inputFile === "-") {
    parsed.errors.push("--input-file - (stdin)은 지원하지 않는다");
  }
  return parsed;
}

const FLAG_KEYS = {
  "--idempotency-key": "idempotencyKey",
  "--input": "input",
  "--input-file": "inputFile",
  "--agent": "agent",
  "--session": "session",
  "--schema": "schema",
  "--step": "step",
  "--next": "next",
} as const;

function assign(parsed: ParsedArgs, flag: string, value: string): void {
  const key = FLAG_KEYS[flag as (typeof VALUE_FLAGS)[number]];
  if (parsed[key] !== undefined) {
    parsed.errors.push(`option이 중복된다: ${flag}`);
    return;
  }
  parsed[key] = value;
}
