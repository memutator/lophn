import type { CommandEntry } from "../../contracts/lophn-agent/mod.ts";
import type { CommandRegistry } from "./registry.ts";

// `/` 메뉴의 묶음·필터와 제출 해석(concern lophn-agent/commands). registry 하나에서
// 메뉴·자동완성·이름 검사가 모두 나오게 한다(R4). IO가 없는 순수 함수다.

// Commands · <agent 이름> · Skills 세 묶음 중 하나다. 맞는 명령이 없는 묶음은 목록에
// 없다(R1).
export type CommandGroup = {
  source: "builtin" | "role" | "skill";
  title: string;
  entries: readonly CommandEntry[];
};

const GROUP_ORDER = ["builtin", "role", "skill"] as const;

function hasWordStartingWith(text: string, separator: RegExp, query: string) {
  return text.split(separator).some((word) => word.startsWith(query));
}

function matches(entry: CommandEntry, query: string): boolean {
  if (query === "") return true;
  const name = entry.name.toLowerCase();
  return name.startsWith(query) || hasWordStartingWith(name, /-/, query) ||
    hasWordStartingWith(entry.description.toLowerCase(), /\s+/, query);
}

// `query`는 `/` 뒤에 사람이 지금까지 친 글자다. 빈 문자열이면 전부다.
// 맞춤은 대소문자를 가리지 않고, 이름이 query로 시작하거나 이름의 단어(`-`로 나눔)가
// query로 시작하거나 설명의 단어(공백으로 나눔)가 query로 시작할 때다. 묶음 안 순서는
// registry 순서를 그대로 지킨다(R1, R2, R7).
export function listCommands(
  registry: CommandRegistry,
  agent_name: string,
  query: string,
): readonly CommandGroup[] {
  const needle = query.toLowerCase();
  const titles = {
    builtin: "Commands",
    role: agent_name,
    skill: "Skills",
  } as const;
  const groups: CommandGroup[] = [];
  for (const source of GROUP_ORDER) {
    const entries = registry.entries.filter((entry) =>
      entry.source === source && matches(entry, needle)
    );
    if (entries.length > 0) {
      groups.push({ source, title: titles[source], entries });
    }
  }
  return groups;
}

export type Submission =
  // `/`로 시작하지 않는 입력이다. 일반 메시지다.
  | { kind: "message" }
  // 실행할 명령 하나다. `argument`는 이름 뒤 글자를 앞뒤 공백 없이 준 것이다(없으면 "").
  | { kind: "command"; entry: CommandEntry; argument: string }
  // 같은 이름 skill이 둘 이상이라 실행하지 않고 고르게 한다(R6).
  | { kind: "choose_skill"; name: string; candidates: readonly CommandEntry[] }
  // 맞는 명령이 없다. 명령으로도 일반 메시지로도 접수하지 않는다(R11).
  | { kind: "unknown_command"; name: string };

// 제출한 입력을 registry로 푼다. registry에 없는 이름은 실행되지 않는다(R4).
export function resolveSubmission(
  registry: CommandRegistry,
  text: string,
): Submission {
  if (!text.startsWith("/")) return { kind: "message" };
  const body = text.slice(1);
  const split = body.search(/\s/);
  const name = split === -1 ? body : body.slice(0, split);
  const argument = split === -1 ? "" : body.slice(split).trim();
  const found = registry.entries.filter((entry) => entry.name === name);
  if (found.length === 0) return { kind: "unknown_command", name };
  // 이름이 겹칠 수 있는 것은 skill뿐이다(built-in·role 이름은 예약이다).
  if (found.length > 1) {
    return { kind: "choose_skill", name, candidates: found };
  }
  return { kind: "command", entry: found[0], argument };
}
