// CLI argv parser(architecture/coding-agent 5.4). 정본 이름은
// `lophn <group> <command>`다. 별칭·implicit stdin·unknown option passthrough는
// 없다(R4). 입력 source는 먼저 exclusive 검사하고 파서 오류도 --json 선택을
// 유지하기 위해 구조화 결과로 낸다.
import { err, ok, type Result } from "../../base/mod.ts";

export type ParsedArgs = {
  command: string | undefined;
  positional: string[];
  json: boolean;
  help: boolean;
  connection: string | undefined;
  daemonUrl: string | undefined;
  app: string | undefined;
  baseRevision: string | undefined;
  idempotencyKey: string | undefined;
  claimSeq: string | undefined;
  input: string | undefined;
  inputFile: string | undefined;
  errors: string[];
};

const VALUE_FLAGS = new Set([
  "--connection",
  "--daemon-url",
  "--app",
  "--base-revision",
  "--idempotency-key",
  "--claim-seq",
  "--input",
  "--input-file",
]);

const KNOWN_FLAGS = new Set(["--json", "--help", ...VALUE_FLAGS]);

export function emptyParsedArgs(): ParsedArgs {
  return {
    command: undefined,
    positional: [],
    json: false,
    help: false,
    connection: undefined,
    daemonUrl: undefined,
    app: undefined,
    baseRevision: undefined,
    idempotencyKey: undefined,
    claimSeq: undefined,
    input: undefined,
    inputFile: undefined,
    errors: [],
  };
}

// argv를 읽어 구조화 입력으로 바꾼다. 모르는 flag·값 없는 flag·flag 중복은
// errors에 남기고 실행 전 거절에 쓴다. stdin "-"는 R4대로 지원하지 않는다.
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed = emptyParsedArgs();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--help") {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith("-") && arg !== "-") {
      if (!KNOWN_FLAGS.has(arg)) {
        parsed.errors.push(`알 수 없는 option이다: ${arg}`);
        continue;
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        parsed.errors.push(`option에 값이 없다: ${arg}`);
        continue;
      }
      index += 1;
      assignFlag(parsed, arg, value);
      continue;
    }
    if (parsed.command === undefined) {
      parsed.command = arg;
      continue;
    }
    parsed.positional.push(arg);
  }
  // input source는 하나다. 둘 다 있으면 실행 전 거절이다(R4).
  if (parsed.input !== undefined && parsed.inputFile !== undefined) {
    parsed.errors.push("input and input_file are exclusive");
  }
  // stdin file은 지원하지 않는다(조사 T2의 implicit stdin append 금지).
  if (parsed.inputFile === "-") {
    parsed.errors.push("--input-file - (stdin)은 지원하지 않는다");
  }
  return parsed;
}

function assignFlag(parsed: ParsedArgs, flag: string, value: string): void {
  switch (flag) {
    case "--json":
      parsed.json = true;
      return;
    case "--help":
      parsed.help = true;
      return;
    case "--connection":
      if (parsed.connection !== undefined) {
        parsed.errors.push("option이 중복된다: --connection");
      }
      parsed.connection = value;
      return;
    case "--daemon-url":
      if (parsed.daemonUrl !== undefined) {
        parsed.errors.push("option이 중복된다: --daemon-url");
      }
      parsed.daemonUrl = value;
      return;
    case "--app":
      if (parsed.app !== undefined) {
        parsed.errors.push("option이 중복된다: --app");
      }
      parsed.app = value;
      return;
    case "--base-revision":
      if (parsed.baseRevision !== undefined) {
        parsed.errors.push("option이 중복된다: --base-revision");
      }
      parsed.baseRevision = value;
      return;
    case "--idempotency-key":
      if (parsed.idempotencyKey !== undefined) {
        parsed.errors.push("option이 중복된다: --idempotency-key");
      }
      parsed.idempotencyKey = value;
      return;
    case "--claim-seq":
      if (parsed.claimSeq !== undefined) {
        parsed.errors.push("option이 중복된다: --claim-seq");
      }
      parsed.claimSeq = value;
      return;
    case "--input":
      if (parsed.input !== undefined) {
        parsed.errors.push("option이 중복된다: --input");
      }
      parsed.input = value;
      return;
    case "--input-file":
      if (parsed.inputFile !== undefined) {
        parsed.errors.push("option이 중복된다: --input-file");
      }
      parsed.inputFile = value;
      return;
  }
}

// `lophn <group> <command>` 모양으로 command를 푼다. `search`처럼 command가
// 곧 group인 것은 없다. 모든 command는 group 뒤에 온다.
export const HELP_COMMAND = "help";
export const VERSION_COMMAND = "version";

export type CommandRef = {
  group: string;
  name: string | undefined;
};

export function splitCommand(
  value: string,
): Result<CommandRef> {
  if (value === HELP_COMMAND || value === VERSION_COMMAND) {
    return ok({ group: value, name: undefined });
  }
  const parts = value.split(" ");
  if (parts.length === 1) {
    return ok({ group: parts[0], name: undefined });
  }
  if (parts.length > 2) {
    return err({
      code: "invalid_input",
      message: `command는 <group> <command> 모양이다: ${
        parts.length - 1
      }부분을 받았다`,
    });
  }
  return ok({ group: parts[0], name: parts[1] });
}
