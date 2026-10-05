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

async function atomic(path: string, text: string): Promise<boolean> {
  const dir = path.slice(0, path.lastIndexOf("/"));
  try {
    await Deno.mkdir(dir, { recursive: true });
    const temp = await Deno.makeTempFile({ dir, prefix: ".lophn-" });
    const handle = await Deno.open(temp, { write: true });
    try {
      await handle.write(new TextEncoder().encode(text));
      await handle.sync();
    } finally {
      handle.close();
    }
    await Deno.rename(temp, path);
    return true;
  } catch {
    return false;
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
        if (!stat.isFile) return { kind: "error" };
        return { kind: "file", text: await Deno.readTextFile(path) };
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return { kind: "absent" };
        return { kind: "error" };
      }
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

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return null;
  }
}
