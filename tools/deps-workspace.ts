export type Member = {
  directory: string;
  name?: string;
  exports?: string | Record<string, string>;
};

export function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return (path.startsWith("/") ? "/" : "") + parts.join("/");
}

export function directory(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

export function inside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent + "/");
}

function glob(pattern: string): RegExp {
  let expression = "";
  const text = pattern.replace(/^\.\//, "").replace(/\/$/, "");
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "*" && text[index + 1] === "*") {
      index++;
      if (text[index + 1] === "/") {
        index++;
        expression += "(?:.*/)?";
      } else expression += ".*";
    } else if (char === "*") expression += "[^/]*";
    else if (char === "?") expression += "[^/]";
    else if (char === "{") expression += "(?:";
    else if (char === "}") expression += ")";
    else if (char === ",") expression += "|";
    else expression += char.replace(/[\\^$+.[\]()|]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`);
}

export async function readMembers(
  root: string,
  files: string[],
): Promise<Member[]> {
  let workspace: string[] = [];
  try {
    workspace =
      JSON.parse(await Deno.readTextFile(`${root}/deno.json`)).workspace ?? [];
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const member = workspaceMatcher(workspace);
  const configs = new Map<string, Omit<Member, "directory">>();
  for (const file of files.filter((file) => file.endsWith("/deno.json"))) {
    if (!member(directory(file))) continue;
    configs.set(file, JSON.parse(await Deno.readTextFile(`${root}/${file}`)));
  }
  return membersOf(workspace, configs);
}

function workspaceMatcher(
  workspace: string[],
): (directory: string) => boolean {
  const patterns = workspace.map(glob);
  return (directory) => patterns.some((pattern) => pattern.test(directory));
}

// 이미 읽은 설정으로 member를 만든다. configs는 deno.json 경로 → 내용이다.
export function membersOf(
  workspace: string[],
  configs: Map<string, Omit<Member, "directory">>,
): Member[] {
  const member = workspaceMatcher(workspace);
  const members: Member[] = [];
  for (const [file, config] of configs) {
    if (!file.endsWith("/deno.json") || !member(directory(file))) continue;
    members.push({
      directory: directory(file),
      name: config.name,
      exports: config.exports,
    });
  }
  return members;
}

export function resolveWorkspace(
  specifier: string,
  members: Member[],
): string | undefined {
  const member = members.filter((member) =>
    member.name &&
    (specifier === member.name || specifier.startsWith(member.name + "/"))
  ).sort((a, b) => b.name!.length - a.name!.length)[0];
  if (!member) return;
  const key = specifier === member.name
    ? "."
    : `.${specifier.slice(member.name!.length)}`;
  const exports = typeof member.exports === "string"
    ? { ".": member.exports }
    : member.exports ?? {};
  let target = exports[key];
  if (!target) {
    for (const [pattern, value] of Object.entries(exports)) {
      const star = pattern.indexOf("*");
      if (
        star < 0 || !key.startsWith(pattern.slice(0, star)) ||
        !key.endsWith(pattern.slice(star + 1))
      ) continue;
      const match = key.slice(star, key.length - (pattern.length - star - 1));
      target = value.replaceAll("*", match);
      break;
    }
  }
  return target ? normalize(`${member.directory}/${target}`) : undefined;
}
