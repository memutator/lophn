// help는 명령 표와 입력 schema에서 만든다. 칸 설명을 따로 적지 않는다. 글은 영어다(model이 읽는다).
// `lophn help`는 묶음 목록, `lophn <group> --help`는 묶음의 명령, `lophn <command> --help`는 usage와 칸이다.
import type { CommandDoc } from "./commands/types.ts";
import {
  type Field,
  fieldsOf,
  kebab,
  placeholder,
  usageOf,
  wordsOf,
} from "./parser.ts";

const COMMON_FLAGS = [
  "  --json                    print the result as one JSON value",
  "  --input <json>            JSON object merged into the fields above",
  "  --input-file <path>       like --input, from a file",
  "  --idempotency-key <key>   retry key for write commands",
];

const ON_FLAG =
  "  --on <machine>            run on another computer (its name, or its device id when several share a name)";

// `--on`이 듣는 명령인지는 부르는 쪽이 안다(터미널은 core 명령, agent tool은 앱 command). 듣지 않는 명령에는 flag를 보이지 않는다.
export type TakesOn = (command: CommandDoc) => boolean;

function typeText(field: Field): string {
  const base = field.values?.join("|") ?? field.kind;
  return field.array ? `${base}, repeatable` : base;
}

function fieldLine(label: string, field: Field): string {
  const note = field.description === undefined ? "" : ` - ${field.description}`;
  return `  ${label} (${field.required ? "required" : "optional"}, ${typeText(field)})${note}`;
}

function commandHelp(command: CommandDoc, takesOn: TakesOn): string {
  const slots = command.positional ?? [];
  const fields = fieldsOf(command.input);
  const lines = [
    usageOf(command),
    "",
    command.summary,
    "",
    command.description,
    "",
    `Effect: ${command.effect}`,
  ];
  const listed = [
    ...slots
      .flatMap((slot) => fields.filter((field) => field.name === slot))
      .map((field) => fieldLine(`<${kebab(field.name)}>`, field)),
    ...fields
      .filter((field) => !slots.includes(field.name))
      .map((field) =>
        fieldLine(
          field.kind === "boolean"
            ? field.flag
            : `${field.flag} ${placeholder(field)}`,
          field,
        ),
      ),
  ];
  lines.push("", "Fields:", ...(listed.length === 0 ? ["  none"] : listed));
  lines.push(
    "",
    "Common flags:",
    ...COMMON_FLAGS,
    ...(takesOn(command) ? [ON_FLAG] : []),
  );
  return lines.join("\n");
}

// 묶음은 첫 낱말이 같은 명령이다. 점 없는 이름(`hook`)은 혼자 한 묶음이다.
function groupsOf(commands: readonly CommandDoc[]): Map<string, CommandDoc[]> {
  const groups = new Map<string, CommandDoc[]>();
  for (const command of [...commands].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const group = wordsOf(command.name)[0];
    groups.set(group, [...(groups.get(group) ?? []), command]);
  }
  return groups;
}

// topic이 알려진 명령이나 묶음이 아니면 undefined다.
export function helpText(
  commands: readonly CommandDoc[],
  topic: readonly string[],
  takesOn: TakesOn,
): string | undefined {
  if (topic.length === 0) {
    const rows = [...groupsOf(commands)].map(([group, members]) => {
      const names = members.map((command) =>
        wordsOf(command.name).slice(1).join(" "),
      );
      return names.every((name) => name === "")
        ? `  ${group}`
        : `  ${group}  ${names.join(", ")}`;
    });
    return [
      "lophn <group> <command> [flags]",
      "",
      "Run `lophn <group> --help` for the commands of a group and `lophn <group> <command> --help` for the fields of a command.",
      "",
      "Groups:",
      ...rows,
    ].join("\n");
  }
  const command = commands.find(
    (item) => wordsOf(item.name).join(" ") === topic.join(" "),
  );
  if (command !== undefined) return commandHelp(command, takesOn);
  const members = groupsOf(commands).get(topic[0]);
  if (members === undefined || topic.length > 1) return undefined;
  return [
    `lophn ${topic[0]} <command>`,
    "",
    ...members.map(
      (item) => `  ${wordsOf(item.name).join(" ")} - ${item.summary}`,
    ),
  ].join("\n");
}

export function helpJson(commands: readonly CommandDoc[]): unknown {
  return {
    commands: commands.map((command) => ({
      name: command.name,
      summary: command.summary,
      effect: command.effect,
    })),
  };
}
