// 기계를 넘는 project를 다른 컴퓨터의 같은 저장소와 맞추는 remote key. renderer와 폰도 import하므로 node import가 없다.

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
