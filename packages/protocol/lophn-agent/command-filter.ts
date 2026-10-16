import type { CommandEntry } from "./commands.ts";

// `/` 메뉴의 묶음과 `/` 뒤 글자로 거르는 규칙이다. 화면(renderer)과
// core가 같은 입력에 같은 목록을 얻도록 contracts에 둔다. 의존성·시각·무작위·IO가 없고 zod를
// import하지 않는다.

// Commands · <agent 이름> · Skills 세 묶음 중 하나다. 맞는 명령이 없는 묶음은 목록에
// 없다.
type CommandGroup = {
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
// registry 순서를 그대로 지킨다.
export function listCommands(
  registry: { readonly entries: readonly CommandEntry[] },
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
