// 사람의 설정 file 안에 lophn이 표시한 block 하나로 hook을 놓는 두 형식이다: Kimi(TOML)와 Hermes(YAML).
// 표시한 block 안만 고치고 나머지 byte(주석, 다른 항목)는 그대로 둔다. 원본이나 결과가 파싱되지 않으면
// null이다(쓰지 않고 `failed`).
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { isObject } from "./install-common.ts";

const KIMI_BEGIN = "# >>> lophn kimi hooks";
const KIMI_END = "# <<< lophn kimi hooks";

// BEGIN·END 줄의 위치다. 둘 다 없으면 null, 하나만 있거나 순서가 틀리면 undefined다.
function blockLines(
  lines: readonly string[],
  begin: string,
  end: string,
): [number, number] | null | undefined {
  const from = lines.flatMap((one, i) => (one.trim() === begin ? [i] : []));
  const to = lines.flatMap((one, i) => (one.trim() === end ? [i] : []));
  if (from.length === 0 && to.length === 0) return null;
  if (from.length !== 1 || to.length !== 1 || from[0] > to[0]) return undefined;
  return [from[0], to[0]];
}

export function kimiHooksText(
  text: string | null,
  input: {
    events: readonly string[];
    command(event: string): string;
    timeout: number;
    matchers?: Readonly<Record<string, string>>;
  },
): string | null {
  if (text !== null) {
    try {
      parseToml(text);
    } catch {
      return null;
    }
  }
  const block = [
    KIMI_BEGIN,
    ...input.events.flatMap((event) => {
      const matcher = input.matchers?.[event];
      return [
        "[[hooks]]",
        `event = ${JSON.stringify(event)}`,
        ...(matcher === undefined
          ? []
          : [`matcher = ${JSON.stringify(matcher)}`]),
        `command = ${JSON.stringify(input.command(event))}`,
        `timeout = ${input.timeout}`,
        "",
      ];
    }),
    KIMI_END,
  ];
  let next: string;
  if (text === null) next = `${block.join("\n")}\n`;
  else {
    const lines = text.split("\n");
    const found = blockLines(lines, KIMI_BEGIN, KIMI_END);
    if (found === undefined) return null;
    if (found === null) {
      const gap = text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n";
      next = `${text}${gap}${block.join("\n")}\n`;
    } else {
      lines.splice(found[0], found[1] - found[0] + 1, ...block);
      next = lines.join("\n");
    }
  }
  try {
    parseToml(next);
  } catch {
    return null;
  }
  return next;
}

const HERMES_BEGIN = "# >>> lophn hermes hooks";
const HERMES_END = "# <<< lophn hermes hooks";

// 줄 끝 주석을 뺀 글이다.
function bare(line: string): string {
  return line.replace(/\s+#.*$/, "").trimEnd();
}

function significant(line: string): boolean {
  return line.trim() !== "" && !line.trim().startsWith("#");
}

// Hermes는 `config.yaml`의 `hooks:`에 event마다 shell hook 목록을 받는다. 우리 event들을 표시한 block으로 놓는다.
//   - 사람의 `hooks:`가 없으면 file 끝에 `hooks:`째 block으로 붙인다.
//   - 있고 block mapping이면(비었으면 포함) 그 안 맨 앞에 block을 끼운다. 우리 event 이름을 사람이 이미 쓰고 있으면
//     같은 key가 둘이 되어 YAML이 깨지므로 null이다.
//   - `hooks: {}`처럼 한 줄 값이거나 목록이면 안전하게 고칠 수 없어 null이다.
export function hermesHooksText(
  text: string | null,
  input: {
    events: readonly string[];
    command(event: string): string;
    timeout: number;
  },
): string | null {
  if (text !== null) {
    try {
      parseYaml(text);
    } catch {
      return null;
    }
  }
  const entries = (indent: string) =>
    input.events.flatMap((event) => [
      `${indent}${event}:`,
      `${indent}  - command: ${JSON.stringify(input.command(event))}`,
      `${indent}    timeout: ${input.timeout}`,
    ]);
  // 표시는 `markerIndent`에 두고, 사람의 `hooks:` 안에 끼우는 block(`withKey` 아님)은 항목도 그 들여쓰기를 쓴다.
  const build = (markerIndent: string, withKey: boolean) => [
    `${markerIndent}${HERMES_BEGIN}`,
    ...(withKey ? ["hooks:"] : []),
    ...entries(withKey ? "  " : markerIndent),
    `${markerIndent}${HERMES_END}`,
  ];
  let next: string;
  if (text === null) next = `${build("", true).join("\n")}\n`;
  else {
    const lines = text.split("\n");
    const found = blockLines(lines, HERMES_BEGIN, HERMES_END);
    if (found === undefined) return null;
    if (found !== null) {
      // 놓았던 모양을 그대로 따른다.
      const withKey = lines[found[0] + 1]?.trim() === "hooks:";
      lines.splice(
        found[0],
        found[1] - found[0] + 1,
        ...build(lines[found[0]].match(/^\s*/)![0], withKey),
      );
      next = lines.join("\n");
    } else {
      const top = lines.findIndex((one) => /^hooks\s*:/.test(one));
      if (top === -1) {
        const gap = text === "" ? "" : text.endsWith("\n") ? "" : "\n";
        next = `${text}${gap}${build("", true).join("\n")}\n`;
      } else {
        if (
          bare(lines[top])
            .replace(/^hooks\s*:/, "")
            .trim() !== ""
        ) {
          return null;
        }
        const after = lines.slice(top + 1);
        const firstAt = after.findIndex(significant);
        // 다음 의미 있는 줄이 들여쓴 줄이면 block mapping이고, 아니면 값이 빈 `hooks:`다.
        const body =
          firstAt !== -1 && /^\s/.test(after[firstAt])
            ? after[firstAt]
            : undefined;
        if (body?.trim().startsWith("-")) return null;
        const indent = body === undefined ? "  " : body.match(/^\s*/)![0];
        const mine = new RegExp(`^${indent}(${input.events.join("|")})\\s*:`);
        if (lines.some((one) => mine.test(one))) return null;
        lines.splice(top + 1, 0, ...build(indent, false));
        next = lines.join("\n");
      }
    }
  }
  try {
    const hooks = (parseYaml(next) as { hooks?: unknown } | null)?.hooks;
    const ok =
      isObject(hooks) &&
      input.events.every((event) => {
        const list = hooks[event];
        return (
          Array.isArray(list) &&
          list.some(
            (one) => isObject(one) && one.command === input.command(event),
          )
        );
      });
    return ok ? next : null;
  } catch {
    return null;
  }
}
