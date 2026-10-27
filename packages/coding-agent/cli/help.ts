// help는 command 표에서 만든다. 읽기와 변경은 표의 `mutates` 칸으로 가른다. 입력 칸은 command의 입력
// schema에서 읽어 와서 따로 적지 않는다.
import { z } from "zod";
import { CODING_TOKEN_ENV } from "../../protocol/coding-agent/mod.ts";
import { COMMANDS, findCommand } from "./registry.ts";
import type { CommandEntry } from "./registry.ts";

const COMMON = ["json", "input", "input_file", "idempotency_key"];

type Field = {
  name: string;
  required: boolean;
  type: string;
  description?: string;
};

function fieldsOf(entry: CommandEntry): Field[] {
  try {
    const schema = z.toJSONSchema(entry.input, {
      io: "input",
      unrepresentable: "any",
    }) as {
      properties?: Record<
        string,
        { type?: unknown; enum?: unknown[]; description?: string }
      >;
      required?: string[];
    };
    return Object.entries(schema.properties ?? {})
      .filter(
        ([name, property]) =>
          // user 명령의 `input`은 run 입력(JSON 값)이라 감추지 않는다. 공통 칸 `input`은 string이다.
          !COMMON.includes(name) ||
          (entry.auth === "user" &&
            name === "input" &&
            property.type !== "string"),
      )
      .map(([name, property]) => ({
        name,
        required: (schema.required ?? []).includes(name),
        type: Array.isArray(property.enum)
          ? property.enum.join("|")
          : String(property.type ?? "json"),
        description: property.description,
      }));
  } catch {
    return [];
  }
}

function fieldLine(label: string, field: Field, note?: string): string {
  const description = note ?? field.description;
  return `  ${label} (${field.required ? "필수" : "선택"}, ${field.type})${
    description === undefined ? "" : ` - ${description}`
  }`;
}

// user 명령의 `--input`은 run 입력 JSON 값 하나다. 칸 이름은 위치 인자나 flag로 쓴다.
function userInputLines(entry: CommandEntry, fields: Field[]): string[] {
  const positional = entry.positional ?? [];
  const rank = (field: Field) =>
    positional.includes(field.name) ? 0 : field.name === "input" ? 1 : 2;
  const lines = [...fields]
    .sort((a, b) => rank(a) - rank(b))
    .map((field) => {
      if (positional.includes(field.name)) {
        return fieldLine(`<${field.name}>`, field);
      }
      if (field.name === "input") {
        return fieldLine(
          "--input <json> | --input-file <path>",
          field,
          "run 입력으로 넘기는 JSON 값(command 칸을 담는 객체가 아니다)",
        );
      }
      return fieldLine(
        field.type === "boolean"
          ? `--${field.name}`
          : `--${field.name} <${field.name === "schema" ? "json" : field.name}>`,
        field,
      );
    });
  return ["입력:", ...(lines.length === 0 ? ["  없다"] : lines)];
}

function line(entry: CommandEntry): string {
  return `  lophn ${entry.name} - ${entry.summary}`;
}

export function helpText(name?: string): string {
  const entry =
    name === undefined || name === "" ? undefined : findCommand(name);
  if (entry === undefined) {
    return [
      "lophn <command> [--input '<json>' | --input-file <path>] [--json]",
      "",
      "읽기 명령(아무것도 바꾸지 않는다):",
      ...COMMANDS.filter((item) => !item.mutates).map(line),
      "",
      "변경 명령:",
      ...COMMANDS.filter((item) => item.mutates).map(line),
      "",
      "`lophn <command> --help`로 입력 칸을 본다.",
    ].join("\n");
  }
  const fields = fieldsOf(entry);
  return [
    `lophn ${entry.name}${(entry.positional ?? [])
      .map((p) => ` <${p}>`)
      .join("")}`,
    entry.summary,
    `종류: ${entry.mutates ? "변경" : "읽기"}`,
    entry.auth === "coding_token"
      ? `인증: 환경 변수 ${CODING_TOKEN_ENV} (coding agent session의 터미널)`
      : entry.auth === "user"
        ? `인증: lophn이 켜져 있으면 data root의 user token file(coding agent session 안에서는 ${CODING_TOKEN_ENV})`
        : "인증: 필요 없다(이 컴퓨터에서만 돈다)",
    ...(entry.auth === "user"
      ? userInputLines(entry, fields)
      : [
          `입력(--input JSON): ${fields.length === 0 ? "없다" : ""}`.trimEnd(),
          ...fields.map((field) => fieldLine(field.name, field)),
        ]),
    "공통: --json 출력을 JSON 하나로, --idempotency-key 변경 명령의 재시도 key",
  ].join("\n");
}

export function helpJson(): unknown {
  return {
    commands: COMMANDS.map((entry) => ({
      name: entry.name,
      summary: entry.summary,
      mutates: entry.mutates,
      auth: entry.auth,
    })),
  };
}
