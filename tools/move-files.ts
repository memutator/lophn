// 실행: deno run --allow-read --allow-write --allow-run tools/move-files.ts <mapping.json> [--dry-run] [--report <file>] [--root <dir>]
// mapping대로 파일과 폴더를 옮기고, 옮긴 자리를 가리키는 import·설정 경로를 고친다.
// 고치지 못하는 경로 문자열과 옛 경로 언급은 보고서에 file:line으로 남긴다. 손으로 고칠 목록이다.
import { readSpecifierSites, readStringSites } from "./deps-imports.ts";
import {
  inside,
  type Member,
  membersOf,
  resolveWorkspace,
} from "./deps-workspace.ts";

export type Mapping = {
  moves?: { from: string; to: string }[];
  packages?: { from: string; to: string }[];
  remove?: string[];
};

export type Note = {
  file: string;
  line: number;
  kind: "error" | "warning" | "path" | "config" | "mention";
  message: string;
};

export type Plan = {
  // 옛 경로 → 새 경로. 자리가 바뀌는 파일만 담는다.
  moved: Map<string, string>;
  removed: string[];
  // 새 경로 → 고친 내용. 내용이 바뀌는 파일만 담는다.
  contents: Map<string, string>;
  rewrites: number;
  notes: Note[];
};

type Rule = { from: string; to: string; folder: boolean };
type Site = { specifier: string; line: number; start: number; end: number };
type Edit = { start: number; end: number; text: string };
type Found = { path: string; kind: "file" | "dir" | "removed" | "unknown" };
type Config = Omit<Member, "directory">;

const CODE = /\.[cm]?[jt]sx?$/;
const CSS = /\.css$/;
const TEXT = /\.(?:[cm]?[jt]sx?|css|json|jsonc|md|ya?ml|html|sh|toml|txt)$/;
const CONFIG = /(?:^|\/)(?:deno|package|tsconfig[^/]*)\.json$/;
const decoder = new TextDecoder();

async function git(root: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args: ["-C", root, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(`git ${args[0]}: ${decoder.decode(output.stderr).trim()}`);
  }
  return decoder.decode(output.stdout);
}

function parent(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

// root 기준 경로로 푼다. root 밖으로 나가면 undefined다.
function resolve(directory: string, relative: string): string | undefined {
  const parts = directory ? directory.split("/") : [];
  for (const part of relative.split("/")) {
    if (!part || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.length) parts.pop();
    else return;
  }
  return parts.join("/");
}

// directory에서 path로 가는 상대 경로다. 늘 "./"나 "../"로 시작한다.
function relative(directory: string, path: string): string {
  const from = directory ? directory.split("/") : [];
  const to = path ? path.split("/") : [];
  let same = 0;
  while (same < from.length && same < to.length && from[same] === to[same]) {
    same++;
  }
  const rest = to.slice(same).join("/");
  const up = from.length - same;
  return up ? "../".repeat(up) + rest : `./${rest}`;
}

function ancestors(paths: Iterable<string>): Set<string> {
  const result = new Set<string>([""]);
  for (const path of paths) {
    for (let dir = parent(path); dir && !result.has(dir); dir = parent(dir)) {
      result.add(dir);
    }
  }
  return result;
}

function readRules(list: unknown, what: string): Rule[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error(`${what}는 목록이어야 한다`);
  return list.map((entry) => {
    const { from, to } = (entry ?? {}) as { from?: unknown; to?: unknown };
    const folder = typeof from === "string" && from.endsWith("/");
    if (
      typeof from !== "string" || typeof to !== "string" ||
      !from.replace(/\/$/, "") || folder !== to.endsWith("/") ||
      /^\.{0,2}\//.test(from) || /^\.{0,2}\//.test(to)
    ) {
      throw new Error(
        `${what} 줄이 잘못됨: ${
          JSON.stringify(entry)
        } (root 기준 경로, 폴더는 from·to 둘 다 /로 끝낸다)`,
      );
    }
    return {
      from: folder ? from.slice(0, -1) : from,
      to: folder ? to.slice(0, -1) : to,
      folder,
    };
  });
}

// 가장 긴 from이 이긴다. 길이가 같으면 파일 규칙이 이긴다.
function match(path: string, rules: Rule[]): Rule | undefined {
  let best: Rule | undefined;
  for (const rule of rules) {
    if (rule.folder ? !inside(path, rule.from) : path !== rule.from) continue;
    if (
      !best || rule.from.length > best.from.length ||
      (rule.from.length === best.from.length && !rule.folder)
    ) best = rule;
  }
  return best;
}

function apply(path: string, rule: Rule): string {
  return rule.folder ? rule.to + path.slice(rule.from.length) : rule.to;
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index++) {
    if (source[index] === "\n") line++;
  }
  return line;
}

function splice(source: string, edits: Edit[]): string {
  let result = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

type JsonString = {
  path: (string | number)[];
  value: string;
  start: number;
  end: number;
  key: boolean;
};

// 주석과 끝 쉼표를 허용하는 JSON에서 문자열마다 자리와 경로(위 key 목록)를 낸다.
function jsonStrings(source: string): JsonString[] {
  const result: JsonString[] = [];
  let index = 0;
  const space = () => {
    for (;;) {
      if (/\s/.test(source[index] ?? "")) index++;
      else if (source.startsWith("//", index)) {
        const end = source.indexOf("\n", index);
        index = end < 0 ? source.length : end;
      } else if (source.startsWith("/*", index)) {
        const end = source.indexOf("*/", index + 2);
        index = end < 0 ? source.length : end + 2;
      } else return;
    }
  };
  const text = () => {
    const start = index++;
    while (index < source.length && source[index] !== '"') {
      index += source[index] === "\\" ? 2 : 1;
    }
    index++;
    const value = JSON.parse(source.slice(start, index)) as string;
    return { value, start, end: index };
  };
  const value = (path: (string | number)[]): void => {
    space();
    const char = source[index];
    if (char === "{" || char === "[") {
      index++;
      for (let position = 0;; position++) {
        space();
        if (index >= source.length) throw new Error("JSON이 끝나지 않음");
        if (source[index] === (char === "{" ? "}" : "]")) break;
        if (char === "{") {
          if (source[index] !== '"') throw new Error("JSON key 자리가 잘못됨");
          const key = text();
          result.push({ path, ...key, key: true });
          space();
          if (source[index++] !== ":") throw new Error("JSON에 : 없음");
          value([...path, key.value]);
        } else value([...path, position]);
        space();
        if (source[index] === ",") index++;
      }
      index++;
    } else if (char === '"') {
      result.push({ path, ...text(), key: false });
    } else {
      const start = index;
      while (index < source.length && !/[\s,\]}]/.test(source[index])) index++;
      if (index === start) throw new Error("JSON 값 자리가 잘못됨");
    }
  };
  value([]);
  return result;
}

type Role = "name" | "pattern" | "path" | "exports";

// 설정 파일의 문자열이 무엇인지다. pattern은 ./ 없이도 설정 폴더 기준 경로이고, path는 ./·../로 시작할 때만 경로다.
function role(file: string, path: (string | number)[]): Role {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const [first, second, third] = path.map(String);
  if (name === "deno.json") {
    if (path.length === 1 && first === "name") return "name";
    if (first === "workspace") return "pattern";
    if (["include", "exclude"].includes(first) && path.length === 2) {
      return "pattern";
    }
    if (
      ["test", "lint", "fmt", "publish", "bench"].includes(first) &&
      ["include", "exclude"].includes(second)
    ) return "pattern";
    return first === "exports" ? "exports" : "path";
  }
  if (name === "package.json") {
    if (
      path.length === 1 &&
      ["main", "module", "types", "typings", "browser"].includes(first)
    ) return "pattern";
    return ["files", "workspaces"].includes(first) && path.length === 2
      ? "pattern"
      : "path";
  }
  if (["include", "exclude", "files"].includes(first) && path.length === 2) {
    return "pattern";
  }
  if (path.length === 1 && first === "extends") return "pattern";
  if (
    first === "compilerOptions" &&
    [
      "rootDir",
      "outDir",
      "baseUrl",
      "declarationDir",
      "rootDirs",
      "typeRoots",
      "paths",
    ]
      .includes(second)
  ) return "pattern";
  return first === "references" && third === "path" ? "pattern" : "path";
}

// exports key가 값의 폴더나 파일 이름과 같으면 값을 따라 key 이름도 바꾼다.
function renameKey(
  key: string,
  before: string,
  after: string,
): string | undefined {
  const strip = (text: string) => text.replace(/^\.\//, "");
  const stem = (text: string) => text.replace(/\.[^./]+$/, "");
  const name = strip(key);
  const old = strip(before);
  const fresh = strip(after);
  if (!name || name === ".") return;
  if (old.startsWith(`${name}/`)) {
    const depth = name.split("/").length;
    const parts = fresh.split("/");
    if (
      parts.slice(depth).join("/") !== old.split("/").slice(depth).join("/")
    ) {
      return;
    }
    return `./${parts.slice(0, depth).join("/")}`;
  }
  if (stem(old) === name) return `./${stem(fresh)}`;
}

function ownerOf(path: string, members: Member[]): Member | undefined {
  return members.filter((member) => inside(path, member.directory))
    .sort((a, b) => b.directory.length - a.directory.length)[0];
}

function memberNamed(
  specifier: string,
  members: Member[],
): Member | undefined {
  return members.filter((member) =>
    member.name &&
    (specifier === member.name || specifier.startsWith(`${member.name}/`))
  ).sort((a, b) => b.name!.length - a.name!.length)[0];
}

function exportKeys(member: Member, file: string): string[] {
  const exports = typeof member.exports === "string"
    ? { ".": member.exports }
    : member.exports ?? {};
  return Object.entries(exports).filter(([, value]) =>
    !value.includes("*") && resolve(member.directory, value) === file
  ).map(([key]) => key);
}

function cssSites(source: string): Site[] {
  const pattern =
    /@import\s+(?:url\(\s*)?(["']?)([^"'()\s;]+)\1|url\(\s*(["']?)([^"'()\s]+)\3\s*\)|\bfrom\s+(["'])([^"']+)\5/dg;
  const sites: Site[] = [];
  for (const found of source.matchAll(pattern)) {
    const group = found[2] !== undefined ? 2 : found[4] !== undefined ? 4 : 6;
    const [start, end] = found.indices![group]!;
    sites.push({
      specifier: found[group],
      line: lineAt(source, start),
      start,
      end,
    });
  }
  return sites;
}

function cssRelative(value: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/|#|~)/i.test(value);
}

function splitSuffix(specifier: string): [string, string] {
  const at = specifier.search(/[?#]/);
  return at < 0
    ? [specifier, ""]
    : [specifier.slice(0, at), specifier.slice(at)];
}

export async function planMoves(root: string, mapping: Mapping): Promise<Plan> {
  const notes: Note[] = [];
  const note = (
    file: string,
    line: number,
    kind: Note["kind"],
    message: string,
  ) => notes.push({ file, line, kind, message });
  const moves = readRules(mapping.moves, "moves");
  const removes = readRules(
    mapping.remove?.map((path) => ({ from: path, to: path })),
    "remove",
  );
  const folders = moves.filter((rule) => rule.folder);
  const renames = new Map(
    readRules(
      mapping.packages?.map(({ from, to }) => ({ from, to })),
      "packages",
    ).map((rule) => [rule.from, rule.to]),
  );

  // 1. 파일마다 새 자리
  const files = (await git(root, ["ls-files", "-z"])).split("\0").filter(
    Boolean,
  );
  const next = new Map<string, string>();
  const owners = new Map<string, string>();
  const removed: string[] = [];
  for (const file of files) {
    if (match(file, removes)) {
      removed.push(file);
      continue;
    }
    const rule = match(file, moves);
    const target = rule ? apply(file, rule) : file;
    const taken = owners.get(target);
    if (taken !== undefined) {
      note(file, 0, "error", `${taken}와 같은 자리로 옮김: ${target}`);
    }
    owners.set(target, file);
    next.set(file, target);
  }
  for (const rule of [...moves, ...removes]) {
    if (
      !files.some((file) =>
        rule.folder ? inside(file, rule.from) : file === rule.from
      )
    ) note(rule.from, 0, "error", "mapping의 from에 맞는 파일이 없음");
  }
  for (const target of owners.keys()) {
    for (let dir = parent(target); dir; dir = parent(dir)) {
      if (owners.has(dir)) {
        note(owners.get(target)!, 0, "error", `파일 자리 아래로 옮김: ${dir}`);
      }
    }
  }
  const removedSet = new Set(removed);
  const oldDirs = ancestors(files);
  const newDirs = ancestors(next.values());
  const mapDir = (dir: string) => {
    const rule = match(dir, folders);
    return rule ? apply(dir, rule) : dir;
  };
  const locate = (path: string): Found => {
    const moved = next.get(path);
    if (moved !== undefined) return { path: moved, kind: "file" };
    if (removedSet.has(path)) return { path, kind: "removed" };
    return { path: mapDir(path), kind: oldDirs.has(path) ? "dir" : "unknown" };
  };

  // 2. 글 파일 읽기
  const texts = new Map<string, string>();
  for (const file of files) {
    if (TEXT.test(file)) {
      texts.set(file, await Deno.readTextFile(`${root}/${file}`));
    }
  }
  const contents = new Map<string, string>();
  const current = (file: string) =>
    contents.get(next.get(file)!) ?? texts.get(file)!;
  let rewrites = 0;

  // 3. 설정 파일
  const keyRenames = new Map<string, Map<string, string>>();
  const configPath = (
    value: string,
    before: string,
    after: string,
    pattern: boolean,
  ): string | undefined => {
    if (!pattern && !/^\.\.?\//.test(value)) return;
    const negated = value.startsWith("!");
    const body = negated ? value.slice(1) : value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(body) || body.startsWith("/")) return;
    const glob = body.search(/[*?[{]/);
    const base =
      (glob < 0 ? body : body.slice(0, body.lastIndexOf("/", glob) + 1))
        .replace(/\/+$/, "");
    const rest = body.slice(base.length);
    const target = resolve(before, base);
    if (target === undefined) return;
    const found = glob < 0 ? locate(target).path : mapDir(target);
    if (relative(before, target) === relative(after, found)) return;
    let fresh = relative(after, found);
    if (!body.startsWith("./") && fresh.startsWith("./")) {
      fresh = fresh.slice(2);
    }
    const joined = base
      ? fresh + rest
      : fresh === "./" || fresh === ""
      ? rest
      : `${fresh.replace(/\/$/, "")}/${rest}`;
    return (negated ? "!" : "") + joined;
  };
  for (const [file, source] of texts) {
    if (!CONFIG.test(file) || removedSet.has(file)) continue;
    const target = next.get(file)!;
    let strings: JsonString[];
    try {
      strings = jsonStrings(source);
    } catch (error) {
      note(
        file,
        0,
        "warning",
        `설정 파일을 읽지 못함: ${(error as Error).message}`,
      );
      continue;
    }
    const edits: Edit[] = [];
    const replace = (item: JsonString, value: string) => {
      edits.push({
        start: item.start,
        end: item.end,
        text: JSON.stringify(value),
      });
      note(
        target,
        lineAt(source, item.start),
        "config",
        `${item.value} → ${value}`,
      );
      rewrites++;
    };
    const keys = new Map<string, JsonString>();
    for (const item of strings) {
      if (item.key && item.path.length === 1 && item.path[0] === "exports") {
        keys.set(item.value, item);
      }
    }
    for (const item of strings) {
      if (item.key) continue;
      const kind = role(file, item.path);
      if (kind === "name") {
        const renamed = renames.get(item.value);
        if (renamed) replace(item, renamed);
        continue;
      }
      const fresh = configPath(
        item.value,
        parent(file),
        parent(target),
        kind === "pattern",
      );
      if (fresh === undefined) continue;
      replace(item, fresh);
      if (kind !== "exports" || item.path.length !== 2) continue;
      const key = String(item.path[1]);
      const renamed = renameKey(key, item.value, fresh);
      if (!renamed || renamed === key) continue;
      if (keys.has(renamed)) {
        note(
          target,
          0,
          "warning",
          `export key ${key}를 ${renamed}로 바꾸지 못함: 이미 있음`,
        );
        continue;
      }
      replace(keys.get(key)!, renamed);
      const member = parent(target);
      if (!keyRenames.has(member)) keyRenames.set(member, new Map());
      keyRenames.get(member)!.set(key, renamed);
    }
    if (edits.length) contents.set(target, splice(source, edits));
  }

  // 4. workspace member: 옛 모양과 옮긴 뒤 모양
  const members = (after: boolean): Member[] => {
    const configs = new Map<string, Config>();
    let workspace: string[] = [];
    for (const [file, source] of texts) {
      if (!/(?:^|\/)deno\.json$/.test(file)) continue;
      if (after && removedSet.has(file)) continue;
      const path = after ? next.get(file)! : file;
      let config: Config & { workspace?: string[] };
      try {
        config = JSON.parse(after ? current(file) : source);
      } catch {
        note(path, 0, "error", "deno.json이 JSON이 아님");
        continue;
      }
      if (path === "deno.json") workspace = config.workspace ?? [];
      else configs.set(path, config);
    }
    return membersOf(workspace, configs);
  };
  const oldMembers = members(false);
  const newMembers = members(true);

  // 5. 코드와 CSS의 specifier
  const skip = new Set<string>();
  const specifier = (
    file: string,
    target: string,
    site: Site,
    css: boolean,
  ): string | undefined => {
    const [path, suffix] = splitSuffix(site.specifier);
    const local = /^\.\.?\//.test(path) || path === "." || path === ".." ||
      (css && cssRelative(path));
    if (local) {
      const found = resolve(parent(file), path);
      if (found === undefined) {
        note(
          target,
          site.line,
          "warning",
          `저장소 밖을 가리킴: ${site.specifier}`,
        );
        skip.add(`${target}\0${site.specifier}`);
        return;
      }
      const place = locate(found);
      if (place.kind === "removed") {
        note(
          target,
          site.line,
          "error",
          `지우는 파일을 가리킴: ${site.specifier}`,
        );
        skip.add(`${target}\0${site.specifier}`);
        return;
      }
      const before = relative(parent(file), found);
      let after = relative(parent(target), place.path);
      // 추적하지 않는 대상(만들어지는 파일 등)은 옮긴 뒤 확인에서 뺀다.
      const unknown = place.kind === "unknown";
      if (before === after) {
        if (unknown) skip.add(`${target}\0${site.specifier}`);
        return;
      }
      if (unknown) {
        note(
          target,
          site.line,
          "warning",
          `추적하지 않는 대상: ${site.specifier}`,
        );
      }
      if (
        (path.endsWith("/") || path === "." || path === "..") &&
        !after.endsWith("/")
      ) after += "/";
      if (css && !path.startsWith(".") && after.startsWith("./")) {
        after = after.slice(2);
      }
      if (unknown) skip.add(`${target}\0${after}${suffix}`);
      return after + suffix;
    }
    if (css) return;
    const member = memberNamed(path, oldMembers);
    if (!member) return;
    const old = resolveWorkspace(path, oldMembers);
    if (!old) {
      note(target, site.line, "warning", `이미 풀리지 않는 specifier: ${path}`);
      skip.add(`${target}\0${site.specifier}`);
      return;
    }
    const place = locate(old);
    if (place.kind === "removed") {
      note(target, site.line, "error", `지우는 파일을 가리킴: ${path}`);
      skip.add(`${target}\0${site.specifier}`);
      return;
    }
    const mine = ownerOf(target, newMembers);
    const theirs = ownerOf(place.path, newMembers);
    const before = ownerOf(file, oldMembers);
    const merged = mine && theirs && mine.directory === theirs.directory &&
      before?.directory !== member.directory;
    if (!merged && resolveWorkspace(path, newMembers) === place.path) return;
    if (merged || !theirs) {
      if (!theirs) {
        note(
          target,
          site.line,
          "warning",
          `workspace member 밖이 되어 상대 경로로 씀: ${path}`,
        );
      }
      return relative(parent(target), place.path) + suffix;
    }
    if (!theirs.name) {
      note(target, site.line, "error", `이름 없는 member로 옮김: ${path}`);
      return;
    }
    const key = path === member.name
      ? "."
      : `.${path.slice(member.name!.length)}`;
    const renamed = keyRenames.get(theirs.directory)?.get(key) ?? key;
    const keys = exportKeys(theirs, place.path);
    if (!keys.length) {
      note(
        target,
        site.line,
        "error",
        `${theirs.name}에 ${place.path}를 내보내는 export가 없음`,
      );
      return;
    }
    const chosen = keys.includes(renamed) ? renamed : keys[0];
    return theirs.name + (chosen === "." ? "" : chosen.slice(1)) + suffix;
  };
  const specifierSites = new Map<string, Site[]>();
  for (const [file, source] of texts) {
    const css = CSS.test(file);
    if (removedSet.has(file) || !(CODE.test(file) || css)) continue;
    const target = next.get(file)!;
    const sites = css ? cssSites(source) : readSpecifierSites(source);
    specifierSites.set(file, sites);
    const edits: Edit[] = [];
    for (const site of sites) {
      const fresh = specifier(file, target, site, css);
      if (fresh === undefined || fresh === site.specifier) continue;
      const quote = css ? "" : source[site.start];
      edits.push({
        start: site.start,
        end: site.end,
        text: quote + fresh + quote,
      });
    }
    if (!edits.length) continue;
    rewrites += edits.length;
    contents.set(target, splice(source, edits));
  }

  // 6. 고치지 못하는 경로 문자열과 언급
  const markers = [
    ...[...moves, ...removes].map((rule) => rule.from),
    ...renames.keys(),
  ].sort((a, b) => b.length - a.length);
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const markerPattern = markers.length
    ? new RegExp(`(?<![\\w-])(?:${markers.map(escape).join("|")})(?![\\w-])`)
    : undefined;
  const mentioned = (text: string) => markerPattern?.test(text) ?? false;
  for (const [file, source] of texts) {
    if (removedSet.has(file)) continue;
    const target = next.get(file)!;
    const reported = new Set<number>();
    if (CODE.test(file)) {
      const starts = new Set(
        (specifierSites.get(file) ?? []).map((site) => site.start),
      );
      for (const site of readStringSites(source)) {
        if (starts.has(site.start)) continue;
        const value = site.specifier;
        if (mentioned(value)) {
          note(target, site.line, "path", `옛 경로 문자열: ${value}`);
          reported.add(site.line);
          continue;
        }
        if (!/^\.\.?\//.test(value)) continue;
        const found = resolve(parent(file), splitSuffix(value)[0]);
        if (found === undefined) continue;
        const place = locate(found);
        if (place.kind === "unknown") continue;
        const after = relative(parent(target), place.path);
        if (relative(parent(file), found) === after) continue;
        note(target, site.line, "path", `경로 문자열 ${value} → ${after}`);
        reported.add(site.line);
      }
    }
    current(file).split("\n").forEach((line, index) => {
      if (!reported.has(index + 1) && mentioned(line)) {
        note(target, index + 1, "mention", line.trim().slice(0, 160));
      }
    });
  }

  // 7. 옮긴 뒤에도 모든 specifier가 풀리는지
  const present = new Set(next.values());
  for (const [file, target] of next) {
    const css = CSS.test(target);
    if (!texts.has(file) || !(CODE.test(target) || css)) continue;
    const source = current(file);
    for (const site of css ? cssSites(source) : readSpecifierSites(source)) {
      if (skip.has(`${target}\0${site.specifier}`)) continue;
      const [path] = splitSuffix(site.specifier);
      if (/^\.\.?\//.test(path) || (css && cssRelative(path))) {
        const found = resolve(parent(target), path);
        if (found === undefined || present.has(found) || newDirs.has(found)) {
          continue;
        }
        note(
          target,
          site.line,
          "error",
          `옮긴 뒤 풀리지 않음: ${site.specifier}`,
        );
      } else if (!css && memberNamed(path, oldMembers.concat(newMembers))) {
        const found = resolveWorkspace(path, newMembers);
        if (found && present.has(found)) continue;
        note(
          target,
          site.line,
          "error",
          `옮긴 뒤 풀리지 않음: ${site.specifier}`,
        );
      }
    }
  }

  const moved = new Map([...next].filter(([from, to]) => from !== to));
  notes.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line ||
    a.message.localeCompare(b.message)
  );
  return { moved, removed, contents, rewrites, notes };
}

// 옮긴 뒤 남은 옛 폴더(추적하지 않는 파일만 있는 곳)를 돌려준다.
export async function applyPlan(root: string, plan: Plan): Promise<string[]> {
  if ((await git(root, ["status", "--porcelain"])).trim()) {
    throw new Error("commit하지 않은 변경이 있다. 치운 뒤 돌린다");
  }
  for (const file of plan.removed) await Deno.remove(`${root}/${file}`);
  // 새 자리가 다른 파일의 옛 자리일 수 있어서 임시 폴더를 거쳐 옮긴다.
  const temp = await Deno.makeTempDir({ dir: root, prefix: ".move-files-" });
  const pairs = [...plan.moved];
  for (const [index, [from]] of pairs.entries()) {
    await Deno.rename(`${root}/${from}`, `${temp}/${index}`);
  }
  for (const [index, [, to]] of pairs.entries()) {
    await Deno.mkdir(`${root}/${parent(to)}`, { recursive: true });
    await Deno.rename(`${temp}/${index}`, `${root}/${to}`);
  }
  await Deno.remove(temp);
  for (const [file, source] of plan.contents) {
    await Deno.writeTextFile(`${root}/${file}`, source);
  }
  const dirs = [...ancestors([...plan.moved.keys(), ...plan.removed])]
    .filter(Boolean).sort((a, b) => b.length - a.length);
  const left: string[] = [];
  for (const dir of dirs) {
    let empty = true;
    try {
      for await (const _ of Deno.readDir(`${root}/${dir}`)) {
        empty = false;
        break;
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
    if (empty) await Deno.remove(`${root}/${dir}`);
    else left.push(dir);
  }
  await git(root, ["add", "-A"]);
  const tracked = ancestors(
    (await git(root, ["ls-files", "-z"])).split("\0").filter(Boolean),
  );
  return left.filter((dir) => !tracked.has(dir))
    .filter((dir, _, list) => !list.includes(parent(dir))).sort();
}

export function summary(plan: Plan): string {
  const count = (kind: Note["kind"]) =>
    plan.notes.filter((note) => note.kind === kind).length;
  return [
    `옮김 ${plan.moved.size}개, 지움 ${plan.removed.length}개`,
    `고친 specifier·설정 값 ${plan.rewrites}곳 (파일 ${plan.contents.size}개)`,
    `오류 ${count("error")}, 경고 ${count("warning")}, 손으로 고칠 경로 ${
      count("path")
    }, 옛 경로 언급 ${count("mention")}`,
  ].join("\n");
}

export function formatReport(plan: Plan): string {
  const groups: [Note["kind"], string][] = [
    ["error", "오류: 고치기 전에는 옮기지 않는다"],
    ["warning", "경고: 확인할 것"],
    ["path", "손으로 고칠 경로 문자열"],
    ["config", "고친 설정 값"],
    ["mention", "옛 경로 언급: 주석·문서·설정 문자열"],
  ];
  const lines: string[] = [];
  for (const [kind, title] of groups) {
    const list = plan.notes.filter((note) => note.kind === kind);
    lines.push(
      `# ${title} (${list.length})`,
      ...list.map((note) => `${note.file}:${note.line} ${note.message}`),
      "",
    );
  }
  lines.push(
    `# 옮김 (${plan.moved.size})`,
    ...[...plan.moved].map(([from, to]) => `${from} → ${to}`),
    "",
    `# 지움 (${plan.removed.length})`,
    ...plan.removed,
    "",
  );
  return lines.join("\n");
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  if (at < 0) return;
  return args.splice(at, 2)[1];
}

if (import.meta.main) {
  const args = [...Deno.args];
  const dryRun = args.includes("--dry-run");
  if (dryRun) args.splice(args.indexOf("--dry-run"), 1);
  const root = option(args, "--root") ?? Deno.cwd();
  const reportPath = option(args, "--report");
  if (args.length !== 1) {
    console.error(
      "사용: tools/move-files.ts <mapping.json> [--dry-run] [--report <file>] [--root <dir>]",
    );
    Deno.exit(2);
  }
  const [mappingPath] = args;
  try {
    const mapping = JSON.parse(await Deno.readTextFile(mappingPath)) as Mapping;
    const plan = await planMoves(root, mapping ?? {});
    const report = reportPath ??
      mappingPath.replace(/(\.json)?$/, ".report.txt");
    await Deno.writeTextFile(report, formatReport(plan));
    console.log(`${summary(plan)}\n보고서: ${report}`);
    if (plan.notes.some((note) => note.kind === "error")) {
      console.error("오류가 있어 옮기지 않음");
      Deno.exit(1);
    }
    if (!dryRun) {
      for (const dir of await applyPlan(root, plan)) {
        console.log(`남은 옛 폴더(추적하지 않는 파일): ${dir}`);
      }
      console.log("옮김. deno fmt와 deno check를 돌린다.");
    }
  } catch (error) {
    console.error(
      `move-files: ${error instanceof Error ? error.message : error}`,
    );
    Deno.exit(1);
  }
}
