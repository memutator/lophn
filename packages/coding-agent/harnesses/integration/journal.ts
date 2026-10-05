// receipt·journal의 파일 저장과 실제 파일 눈이다(coding-agent/harnesses#R9,
// T29). receipt와 journal은 `~/.lophn/integrations/` 아래 local metadata다
// (domain-model). home root는 인자로 받는다. 고정 HOME을 읽지 않는다.
// 쓰기는 같은 폴더 temp·fsync·rename이다(R9). symlink는 따라가지 않는다(R7).
import type { IntegrationTarget } from "../../../contracts/coding-agent/mod.ts";
import type { FilePort, Store } from "./apply.ts";
import type { Journal, Receipt } from "./receipt.ts";

const INTEGRATIONS = ".lophn/integrations";

function targetKey(target: IntegrationTarget): string {
  const scope = target.scope_kind === "app" ? target.app_realpath : "user";
  return `${target.harness_id}-${target.environment.kind}-${scope}`;
}

// 새 파일의 기본 권한이다. 기존 파일이 있으면 그 mode를 따른다.
const DEFAULT_MODE = 0o644;

async function atomic(path: string, text: string): Promise<boolean> {
  const dir = path.slice(0, path.lastIndexOf("/"));
  // 기존 파일의 mode를 보존한다. temp 파일은 0600이라 그대로 두면 실행 권한이
  // 사라진다.
  const mode = await existingMode(path);
  let temp: string | null = null;
  try {
    await Deno.mkdir(dir, { recursive: true });
    temp = await Deno.makeTempFile({ dir, prefix: ".lophn-" });
    const handle = await Deno.open(temp, { write: true });
    try {
      await handle.write(new TextEncoder().encode(text));
      await handle.sync();
    } finally {
      handle.close();
    }
    await Deno.chmod(temp, mode);
    await Deno.rename(temp, path);
    temp = null;
    // rename 뒤 디렉터리를 fsync해 이름 변경이 디스크에 남게 한다.
    const dirHandle = await Deno.open(dir);
    try {
      await dirHandle.sync();
    } finally {
      dirHandle.close();
    }
    return true;
  } catch {
    if (temp !== null) await Deno.remove(temp).catch(() => {});
    return false;
  }
}

async function existingMode(path: string): Promise<number> {
  try {
    const stat = await Deno.lstat(path);
    return stat.mode === null ? DEFAULT_MODE : stat.mode & 0o777;
  } catch {
    return DEFAULT_MODE;
  }
}

// root 밖으로 나가는 경로를 거절한다. symlink는 따라가지 않는다(R7).
function contained(root: string, path: string): boolean {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(prefix) &&
    !path.slice(prefix.length).split("/").includes("..");
}

export function filePort(): FilePort {
  return {
    async read(path) {
      try {
        const stat = await Deno.lstat(path);
        if (stat.isSymlink) return { kind: "symlink" };
        if (stat.isDirectory) return { kind: "directory" };
        if (!stat.isFile) return { kind: "error" };
        return { kind: "file", text: await Deno.readTextFile(path) };
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return { kind: "absent" };
        return { kind: "error" };
      }
    },
    async listFiles(dir) {
      const files: { path: string; text: string }[] = [];
      try {
        const walked = await walkFiles(dir, dir, files);
        if (walked !== null) return walked;
        return { kind: "files", files };
      } catch {
        return { kind: "error" };
      }
    },
    async escapes(root, path) {
      return await pathEscapes(root, path);
    },
    async writeAtomic(path, text) {
      return await atomic(path, text);
    },
    async writeTree(dir, files) {
      for (const file of files) {
        if (!contained(dir, `${dir}/${file.path}`)) return false;
        const wrote = await atomic(`${dir}/${file.path}`, file.content);
        if (!wrote) return false;
      }
      return true;
    },
    async remove(path) {
      try {
        const stat = await Deno.lstat(path);
        if (stat.isSymlink) return false;
        await Deno.remove(path, { recursive: true });
        return true;
      } catch {
        return false;
      }
    },
  };
}

// receipt·journal 저장이다. home은 lophn home이지 harness home이 아니다.
export function storeOf(home: string): Store {
  const dir = `${home}/${INTEGRATIONS}`;
  return {
    async receipt(target) {
      return await readJson<Receipt>(`${dir}/${targetKey(target)}.json`);
    },
    async saveReceipt(receipt) {
      return await atomic(
        `${dir}/${targetKey(receipt.target)}.json`,
        JSON.stringify(receipt),
      );
    },
    async journal() {
      return await readJson<Journal>(`${dir}/journal.json`) ?? { entries: [] };
    },
    async saveJournal(journal) {
      return await atomic(`${dir}/journal.json`, JSON.stringify(journal));
    },
  };
}

// 디렉터리 안의 파일을 상대 경로로 모은다. symlink는 따라가지 않는다(R7).
async function walkFiles(
  root: string,
  dir: string,
  files: { path: string; text: string }[],
): Promise<{ kind: "symlink"; path: string } | null> {
  for await (const entry of Deno.readDir(dir)) {
    const full = `${dir}/${entry.name}`;
    const stat = await Deno.lstat(full);
    if (stat.isSymlink) {
      return { kind: "symlink", path: full.slice(root.length + 1) };
    }
    if (stat.isDirectory) {
      const inner = await walkFiles(root, full, files);
      if (inner !== null) return inner;
      continue;
    }
    if (stat.isFile) {
      files.push({
        path: full.slice(root.length + 1),
        text: await Deno.readTextFile(full),
      });
    }
  }
  return null;
}

// root에서 target까지의 부모를 lstat한다. 하나라도 symlink거나, 실제로 있는
// 가장 깊은 조상의 realpath가 root 밖이면 빠져나간다(R7). 마지막 컴포넌트만
// 보면 `root/.claude`가 밖을 가리킬 때 놓친다.
async function pathEscapes(root: string, path: string): Promise<boolean> {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (!path.startsWith(prefix)) return true;
  const relative = path.slice(prefix.length);
  const parts = relative.split("/");
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index++) {
    cursor = `${cursor}/${parts[index]}`;
    try {
      const stat = await Deno.lstat(cursor);
      if (stat.isSymlink) return true;
      if (!stat.isDirectory) return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      return true;
    }
  }
  try {
    const realRoot = await Deno.realPath(root);
    const real = await Deno.realPath(cursor);
    const bound = realRoot.endsWith("/") ? realRoot : `${realRoot}/`;
    return real !== realRoot && !real.startsWith(bound);
  } catch (error) {
    // 아직 없는 root(처음 설치하는 `~/.codex`)에는 따라갈 symlink가 없다.
    if (error instanceof Deno.errors.NotFound) return false;
    return true;
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return null;
  }
}
