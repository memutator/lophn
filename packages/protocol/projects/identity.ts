// 기계를 넘는 project id(`pri_…`)의 저장소 file 꼴과 remote 힌트. renderer와 폰도 import하므로 node import가 없다.
import { projectIdentitySchema } from "./values.ts";

export const PROJECT_IDENTITY_FILE = ".lophn-project.json";
export const IDENTITY_FORMAT = 1;

// 이름·remote·경로를 넣지 않는다: rename마다 file이 바뀌어 merge 충돌을 만들지 않게.
export function serializeIdentityFile(id: string): string {
  return JSON.stringify({ lophn_project: IDENTITY_FORMAT, id }, null, 2) + "\n";
}

export type IdentityFileRead =
  | { kind: "ok"; id: string }
  | { kind: "conflict"; id: string; ids: string[] }
  | {
      kind: "unreadable";
      reason: "empty" | "not_json" | "bad_shape" | "newer_format";
    };

type Unreadable = Extract<IdentityFileRead, { kind: "unreadable" }>;

function unreadable(reason: Unreadable["reason"]): Unreadable {
  return { kind: "unreadable", reason };
}

// 모르는 칸은 무시한다. 판이 더 높은 file은 읽지 못한 것이라 덮지 않게 따로 알린다.
function parseOne(text: string): IdentityFileRead {
  if (text.trim() === "") return unreadable("empty");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return unreadable("not_json");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return unreadable("bad_shape");
  }
  const { lophn_project: format, id } = value as Record<string, unknown>;
  if (
    typeof format === "number" &&
    Number.isInteger(format) &&
    format > IDENTITY_FORMAT
  ) {
    return unreadable("newer_format");
  }
  if (format !== IDENTITY_FORMAT) return unreadable("bad_shape");
  return projectIdentitySchema.safeParse(id).success
    ? { kind: "ok", id: id as string }
    : unreadable("bad_shape");
}

const OURS = /^<{7}(?: |$)/;
const BASE = /^\|{7}(?: |$)/;
const SPLIT = /^={7}$/;
const THEIRS = /^>{7}(?: |$)/;

// git merge 충돌 표지의 양쪽을 따로 모은다. 표지 밖 줄은 양쪽에 다 붙이고, diff3의 base 쪽은 버린다.
function conflictSides(text: string): [string, string] | null {
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => OURS.test(line))) return null;
  const ours: string[] = [];
  const theirs: string[] = [];
  let at: "both" | "ours" | "base" | "theirs" = "both";
  for (const line of lines) {
    if (OURS.test(line)) at = "ours";
    else if (BASE.test(line) && at === "ours") at = "base";
    else if (SPLIT.test(line) && at !== "both") at = "theirs";
    else if (THEIRS.test(line) && at === "theirs") at = "both";
    else if (at === "both") {
      ours.push(line);
      theirs.push(line);
    } else if (at === "ours") ours.push(line);
    else if (at === "theirs") theirs.push(line);
  }
  return [ours.join("\n"), theirs.join("\n")];
}

// 충돌이면 양쪽에서 읽은 id 가운데 가장 작은 것(ULID라 먼저 만든 것)이 id다. 누가 풀어도 같은 값이 된다.
export function parseIdentityFile(text: string): IdentityFileRead {
  const sides = conflictSides(text);
  if (sides === null) return parseOne(text);
  const ids = [
    ...new Set(
      sides.flatMap((side) => {
        const read = parseOne(side);
        return read.kind === "ok" ? [read.id] : [];
      }),
    ),
  ].sort();
  if (ids.length === 0) return unreadable("bad_shape");
  return { kind: "conflict", id: ids[0]!, ids };
}

type Remote = { name: string; url: string };
type ParsedRemote = { key: string; url: string };

const DEFAULT_PORTS: Record<string, string> = {
  ssh: "22",
  "git+ssh": "22",
  "ssh+git": "22",
  git: "9418",
  http: "80",
  https: "443",
};

// userinfo는 authority 안 마지막 `@`까지다(password에 `@`가 있어도 host로 새지 않게).
const URL_FORM =
  /^([a-z][a-z0-9+.-]*):\/\/(?:([^/]*)@)?(\[[^\]]+\]|[^/:?#@]+)(?::(\d*))?(\/[^?#]*)?$/i;
// `[user@]host:path`. host에 `/`가 있거나 한 글자(drive)면 git도 경로로 본다.
const SCP_FORM = /^(?:([^@/]+)@)?([^/:]{2,}):(.+)$/;

function canonicalKey(host: string, port: string, path: string): string | null {
  const cleanHost = host.toLowerCase().replace(/\.+$/, "");
  let cleanPath = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  cleanPath = cleanPath.replace(/\/+$/, "");
  if (cleanHost === "" || cleanPath === "") return null;
  if (cleanHost === "github.com") cleanPath = cleanPath.toLowerCase();
  return `${cleanHost}${port === "" ? "" : `:${port}`}/${cleanPath}`;
}

// local remote(file:, 경로, drive)는 null이다. url에는 password·token을 남기지 않는다.
function parseRemote(url: string): ParsedRemote | null {
  const text = url.trim();
  if (/^file:/i.test(text) || /^[/.~\\]/.test(text)) return null;
  const form = URL_FORM.exec(text);
  if (form !== null) {
    const scheme = form[1]!.toLowerCase();
    const defaultPort = DEFAULT_PORTS[scheme];
    if (defaultPort === undefined) return null;
    const user = form[2];
    const port =
      form[4] === undefined || form[4] === defaultPort ? "" : form[4];
    const key = canonicalKey(form[3]!, port, form[5] ?? "");
    if (key === null) return null;
    // http(s)의 userinfo는 자격(token)이다. ssh·git은 사용자 이름만 남긴다.
    const keptUser =
      user === undefined || scheme.startsWith("http")
        ? ""
        : `${user.split(":")[0]}@`;
    const rest = text.slice(text.indexOf("://") + 3);
    const afterUser = user === undefined ? rest : rest.slice(user.length + 1);
    return { key, url: `${form[1]}://${keptUser}${afterUser}` };
  }
  const scp = SCP_FORM.exec(text);
  if (scp === null) return null;
  const key = canonicalKey(scp[2]!, "", scp[3]!);
  return key === null ? null : { key, url: text };
}

function remoteOrder(left: Remote, right: Remote): number {
  const rank = (name: string) =>
    name === "origin" ? 0 : name === "upstream" ? 1 : 2;
  return (
    rank(left.name) - rank(right.name) ||
    (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  );
}

// fetch remote 목록에서 대표 하나의 key를 낸다. 같은 사람의 clone끼리 origin이 같고 fork를 upstream으로 제안하지 않게
// origin이 먼저다. 저장소 안 하위 폴더 project는 `#<subpath>`를 붙여 root project와 갈린다.
export function remoteKeyOf(
  remotes: readonly Remote[],
  subpath: string,
): { key: string; url: string } | null {
  const chosen = [...remotes]
    .sort(remoteOrder)
    .map((remote) => parseRemote(remote.url))
    .find((parsed) => parsed !== null);
  if (chosen === undefined) return null;
  const sub = subpath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return sub === "" ? chosen : { key: `${chosen.key}#${sub}`, url: chosen.url };
}

// id는 부르는 쪽이 정하는 열쇠다(다른 기계의 것이면 `<machine>:<prj>`처럼).
export type ProjectKeys = {
  id: string;
  identity: string | null;
  remote_key: string | null;
};

function uniqueKeys(list: readonly ProjectKeys[]): Set<string> {
  const seen = new Map<string, number>();
  for (const item of list) {
    if (item.remote_key === null) continue;
    seen.set(item.remote_key, (seen.get(item.remote_key) ?? 0) + 1);
  }
  return new Set(
    [...seen].filter(([, count]) => count === 1).map(([key]) => key),
  );
}

// same은 identity가 같은 짝이다. suggested는 identity로 짝이 되지 않은 것끼리 remote key가 같고 하나 이상 identity가
// 없는 짝이다. 둘 다 identity가 있는데 다르면 사람이 나눈 것이라 제안하지 않는다. 한 목록에 같은 key가 둘 이상이면
// 어느 쪽인지 모르므로 제안하지 않는다. 힌트는 제안일 뿐 합치지 않는다.
export function matchProjects(
  local: readonly ProjectKeys[],
  other: readonly ProjectKeys[],
): {
  same: [ProjectKeys, ProjectKeys][];
  suggested: [ProjectKeys, ProjectKeys][];
} {
  const same: [ProjectKeys, ProjectKeys][] = [];
  const paired = new Set<ProjectKeys>();
  for (const left of local) {
    if (left.identity === null) continue;
    for (const right of other) {
      if (right.identity !== left.identity) continue;
      same.push([left, right]);
      paired.add(left).add(right);
    }
  }
  const localKeys = uniqueKeys(local);
  const otherKeys = uniqueKeys(other);
  const suggested: [ProjectKeys, ProjectKeys][] = [];
  for (const left of local) {
    const key = left.remote_key;
    if (key === null || paired.has(left) || !localKeys.has(key)) continue;
    if (!otherKeys.has(key)) continue;
    const right = other.find((item) => item.remote_key === key)!;
    if (paired.has(right)) continue;
    if (left.identity !== null && right.identity !== null) continue;
    suggested.push([left, right]);
  }
  return { same, suggested };
}
