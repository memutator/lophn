// 명령줄 parser다. 명령의 zod 입력 schema에서 flag를 만든다: `--field-name value`(칸 `field_name`), boolean은 `--flag`
// (끄기는 `--no-flag`), 배열은 같은 flag를 되풀이한다. 숫자와 enum은 zod가 읽고 여기는 글을 값으로 바꾸기만 한다.
// `--input <json>`은 입력 object에 합친다. 위치 인자는 명령의 `positional` 칸을 순서대로 채운다.
// core의 `lophn` tool도 같은 parser를 쓴다(파일을 읽지 않으므로 `--input-file`은 readText를 받을 때만 된다).
import { z } from "zod";
import { err, type LophnError, ok, type Result } from "../base/mod.ts";
import { kebab, wordsOf } from "../protocol/apps/declaration/tools.ts";
import type { CommandDoc } from "./commands/types.ts";

export { kebab, wordsOf };

type Kind = "string" | "number" | "boolean" | "json" | "null";

export type Field = {
  name: string;
  flag: string;
  kind: Exclude<Kind, "null">;
  array: boolean;
  values?: string[];
  required: boolean;
  description?: string;
};

type JsonSchema = {
  type?: unknown;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  description?: string;
};

function kindOf(
  property: JsonSchema,
): Pick<Field, "kind" | "array" | "values"> {
  if (Array.isArray(property.enum)) {
    return { kind: "string", array: false, values: property.enum.map(String) };
  }
  switch (property.type) {
    case "string":
      return { kind: "string", array: false };
    case "number":
    case "integer":
      return { kind: "number", array: false };
    case "boolean":
      return { kind: "boolean", array: false };
    case "null":
      return { kind: "json", array: false };
    case "array":
      return { ...kindOf(property.items ?? {}), array: true };
  }
  if (Array.isArray(property.anyOf)) {
    // `string | null` 같은 nullable은 그 type 하나로 읽고, 그 밖의 합집합은 JSON으로 받는다.
    const kinds = property.anyOf
      .filter((branch) => branch.type !== "null")
      .map((branch) => kindOf(branch));
    const [first] = kinds;
    if (
      first !== undefined &&
      !first.array &&
      kinds.every((item) => item.kind === first.kind && !item.array)
    ) {
      return first;
    }
  }
  return { kind: "json", array: false };
}

// 입력 schema 하나의 칸 목록이다. 같은 schema는 한 번만 푼다.
const fieldCache = new WeakMap<z.ZodType, Field[]>();
export function fieldsOf(schema: z.ZodType): Field[] {
  const cached = fieldCache.get(schema);
  if (cached !== undefined) return cached;
  const json = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as { properties?: Record<string, JsonSchema>; required?: string[] };
  const fields = Object.entries(json.properties ?? {}).map(
    ([name, property]): Field => ({
      name,
      flag: `--${kebab(name)}`,
      ...kindOf(property),
      required: (json.required ?? []).includes(name),
      ...(property.description === undefined
        ? {}
        : { description: property.description }),
    }),
  );
  fieldCache.set(schema, fields);
  return fields;
}

export function placeholder(field: Field): string {
  const name = field.values?.join("|") ?? kebab(field.name);
  return `<${name}>`;
}

// 한 줄 usage다. 필수 칸은 그대로, 선택 칸은 대괄호로 둔다.
export function usageOf(command: CommandDoc): string {
  const slots = command.positional ?? [];
  const parts = [`lophn ${wordsOf(command.name).join(" ")}`];
  for (const slot of slots) parts.push(`<${kebab(slot)}>`);
  for (const field of fieldsOf(command.input)) {
    if (slots.includes(field.name)) continue;
    const flag =
      field.kind === "boolean"
        ? field.flag
        : `${field.flag} ${placeholder(field)}`;
    const text = field.array ? `${flag} ...` : flag;
    parts.push(field.required ? text : `[${text}]`);
  }
  return parts.join(" ");
}

function invalid(message: string, command?: CommandDoc): LophnError {
  return {
    code: "invalid_input",
    message:
      command === undefined
        ? message
        : `${message}\nusage: ${usageOf(command)}`,
  };
}

export function unknownCommandError(
  argv: readonly string[],
  commands: readonly CommandDoc[],
): LophnError {
  const flag = argv.findIndex((word) => word.startsWith("--"));
  const given = argv.slice(0, flag < 0 ? argv.length : flag);
  const normalized = given.flatMap(wordsOf);
  const correction = commands.find((command) => {
    const words = wordsOf(command.name);
    return (
      words.length === normalized.length &&
      words.every((word, at) => word === normalized[at])
    );
  });
  const group = commands.some(
    (command) => wordsOf(command.name)[0] === given[0],
  );
  const help = correction
    ? `${wordsOf(correction.name).join(" ")} --help`
    : group
      ? `${given[0]} --help`
      : "help";
  const hint = correction
    ? ` Use \`lophn ${wordsOf(correction.name).join(" ")}\`.`
    : "";
  return invalid(
    `unknown command: ${given.join(" ")}.${hint} Run \`lophn ${help}\``,
  );
}

function convert(field: Field, raw: string): Result<unknown, string> {
  switch (field.kind) {
    case "number": {
      const value = Number(raw);
      return raw.trim() === "" || Number.isNaN(value)
        ? err(`${field.flag}: not a number: ${raw}`)
        : ok(value);
    }
    case "boolean":
      return raw === "true" || raw === "false"
        ? ok(raw === "true")
        : err(`${field.flag}: not a boolean: ${raw}`);
    case "json":
      try {
        return ok(JSON.parse(raw));
      } catch {
        return err(`${field.flag}: not valid JSON: ${raw}`);
      }
    default:
      return ok(raw);
  }
}

// 빠진 칸은 "required", 틀린 칸은 기대하는 꼴을 말한다. agent가 입력을 다시 쓰는 데 이것만 보게 한다.
function describeIssue(issue: z.core.$ZodIssue, candidate: unknown): string {
  const path = issue.path.map(String);
  const given = path.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined,
    candidate,
  );
  const field = path.join(".") || "(input)";
  if (issue.code === "unrecognized_keys") {
    return `${field}: unknown field ${issue.keys.join(", ")}`;
  }
  if (given === undefined && issue.code === "invalid_type") {
    return `${field}: required (${issue.expected})`;
  }
  let expected: string;
  if (issue.code === "invalid_type") expected = `must be ${issue.expected}`;
  else if (issue.code === "invalid_format" && "pattern" in issue) {
    expected = `must match ${issue.pattern}`;
  } else if (issue.code === "invalid_value") {
    expected = `must be one of ${issue.values.map(String).join(" | ")}`;
  } else expected = issue.message;
  return given === undefined
    ? `${field}: required (${expected})`
    : `${field}: ${expected}`;
}

export type ParsedLine<C extends CommandDoc> =
  | { kind: "help"; topic: string[] }
  | {
      kind: "run";
      command: C;
      input: Record<string, unknown>;
      json: boolean;
      key: string | undefined;
    };

type ParseOptions = {
  // `--input-file`을 읽는다. 없으면 그 flag는 거절한다.
  readText?: (path: string) => string | undefined;
};

const COMMON_VALUE_FLAGS = ["--input", "--input-file", "--idempotency-key"];

// `--on <기계>`는 어느 명령에나 붙는 전역 flag라 명령 parser가 보기 전에 argv에서 뗀다. 기계를 어떻게 푸는지는 부르는 쪽이 정한다.
// 명령의 입력 칸이 `--on`을 쓰지 못하는 것은 선언 검사가 막는다(`declaration/tools.ts`).
export function splitOn(
  argv: readonly string[],
): Result<{ on: string | null; argv: string[] }> {
  const rest: string[] = [];
  let on: string | null = null;
  for (let at = 0; at < argv.length; at += 1) {
    if (argv[at] === "--") {
      rest.push(...argv.slice(at));
      break;
    }
    if (argv[at] !== "--on") {
      rest.push(argv[at]);
      continue;
    }
    const value = argv[at + 1];
    if (value === undefined || value.startsWith("--")) {
      return err(invalid("flag needs a value: --on"));
    }
    if (on !== null) return err(invalid("duplicate flag: --on"));
    on = value;
    at += 1;
  }
  return ok({ on, argv: rest });
}

// argv를 읽어 명령 하나의 호출로 바꾼다. 모르는 명령·flag, 값 없는 flag, 중복 flag, 위치 인자 초과는
// invalid_input과 usage 한 줄로 거절한다.
export function parseCommandLine<C extends CommandDoc>(
  argv: readonly string[],
  commands: readonly C[],
  options: ParseOptions = {},
): Result<ParsedLine<C>> {
  if (argv.length === 0 || argv[0] === "help") {
    return ok({ kind: "help", topic: argv.slice(1) });
  }
  let command: C | undefined;
  let used = 0;
  for (const candidate of commands) {
    const words = wordsOf(candidate.name);
    if (words.length > used && words.every((word, at) => argv[at] === word)) {
      command = candidate;
      used = words.length;
    }
  }
  if (command === undefined) {
    const rest = argv.slice(1);
    const isGroup = commands.some((item) => wordsOf(item.name)[0] === argv[0]);
    if (isGroup && rest.every((arg) => arg.startsWith("--"))) {
      return ok({ kind: "help", topic: [argv[0]] });
    }
    return err(unknownCommandError(argv, commands));
  }

  const fields = fieldsOf(command.input);
  const byFlag = new Map(fields.map((field) => [field.flag, field]));
  const given: Record<string, unknown> = {};
  const positional: string[] = [];
  let json = false;
  let help = false;
  let key: string | undefined;
  let inputText: string | undefined;
  let inputFile: string | undefined;
  const rest = argv.slice(used);
  for (let at = 0; at < rest.length; at += 1) {
    const arg = rest[at];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (COMMON_VALUE_FLAGS.includes(arg)) {
      const value = rest[at + 1];
      if (value === undefined || value.startsWith("--")) {
        return err(invalid(`flag needs a value: ${arg}`, command));
      }
      at += 1;
      if (arg === "--input") inputText = value;
      else if (arg === "--input-file") inputFile = value;
      else key = value;
      continue;
    }
    const off = byFlag.get(`--${arg.slice(5)}`);
    const negated =
      arg.startsWith("--no-") && off?.kind === "boolean" ? off : undefined;
    const field = byFlag.get(arg) ?? negated;
    if (field === undefined) {
      return err(invalid(`unknown flag: ${arg}`, command));
    }
    if (field.kind === "boolean" && !field.array) {
      if (field.name in given) {
        return err(invalid(`duplicate flag: ${arg}`, command));
      }
      given[field.name] = negated === undefined;
      continue;
    }
    const value = rest[at + 1];
    if (value === undefined || value.startsWith("--")) {
      return err(invalid(`flag needs a value: ${arg}`, command));
    }
    at += 1;
    const converted = convert(field, value);
    if (!converted.ok) return err(invalid(converted.error, command));
    if (field.array) {
      ((given[field.name] ??= []) as unknown[]).push(converted.value);
    } else if (field.name in given) {
      return err(invalid(`duplicate flag: ${arg}`, command));
    } else given[field.name] = converted.value;
  }
  if (help) return ok({ kind: "help", topic: wordsOf(command.name) });

  const slots = command.positional ?? [];
  if (positional.length > slots.length) {
    return err(
      invalid(`unexpected argument: ${positional[slots.length]}`, command),
    );
  }
  for (const [at, raw] of positional.entries()) {
    const field = fields.find((item) => item.name === slots[at]);
    if (field === undefined) {
      return err(invalid(`unexpected argument: ${raw}`, command));
    }
    if (field.name in given) {
      return err(invalid(`${field.name} is given twice`, command));
    }
    const converted = convert(field, raw);
    if (!converted.ok) return err(invalid(converted.error, command));
    given[field.name] = converted.value;
  }

  if (inputText !== undefined && inputFile !== undefined) {
    return err(
      invalid("--input and --input-file cannot be used together", command),
    );
  }
  if (inputFile !== undefined) {
    const text = options.readText?.(inputFile);
    if (text === undefined) {
      return err(invalid(`cannot read --input-file: ${inputFile}`, command));
    }
    inputText = text;
  }
  if (inputText !== undefined) {
    let body: unknown;
    try {
      body = JSON.parse(inputText);
    } catch {
      return err(invalid("--input is not valid JSON", command));
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return err(invalid("--input must be a JSON object", command));
    }
    for (const [name, value] of Object.entries(body)) {
      if (name in given) {
        return err(
          invalid(
            `${name} is given twice (--input and a flag or argument)`,
            command,
          ),
        );
      }
      given[name] = value;
    }
  }

  const checked = command.input.safeParse(given);
  if (!checked.success) {
    return err(
      invalid(
        `invalid input: ${checked.error.issues.map((issue) => describeIssue(issue, given)).join("; ")}`,
        command,
      ),
    );
  }
  return ok({
    kind: "run",
    command,
    input: checked.data as Record<string, unknown>,
    json,
    key,
  });
}

function shellWord(text: string): string {
  return /^[\w@%+=:,./-]+$/.test(text)
    ? text
    : `'${text.replaceAll("'", "'\\''")}'`;
}

// 사람 화면의 tool 줄 제목이 되는 명령줄이다. parser의 거꾸로라서 flag로 만든다.
export function commandLine(
  command: CommandDoc,
  input: Record<string, unknown>,
): string {
  const slots = command.positional ?? [];
  const word = (value: unknown) =>
    shellWord(typeof value === "string" ? value : JSON.stringify(value));
  const parts = [`lophn ${wordsOf(command.name).join(" ")}`];
  const fields = fieldsOf(command.input);
  const ordered = [
    ...slots.flatMap((slot) => fields.filter((field) => field.name === slot)),
    ...fields.filter((field) => !slots.includes(field.name)),
  ];
  for (const field of ordered) {
    const value = input[field.name];
    if (value === undefined) continue;
    const values = field.array && Array.isArray(value) ? value : [value];
    if (slots.includes(field.name)) {
      parts.push(...values.map(word));
    } else if (field.kind === "boolean") {
      parts.push(value === true ? field.flag : `--no-${kebab(field.name)}`);
    } else {
      for (const item of values) parts.push(field.flag, word(item));
    }
  }
  return parts.join(" ");
}
