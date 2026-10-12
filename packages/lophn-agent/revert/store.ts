import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

// session 저장소(lophn-agent/revert "저장"). pre-image와 redo용 복원 직전 내용을 platform/blob-store가
// 아니라 data root 아래 session 단위 디렉터리(`<dataRoot>/rewind/<session>/`)에 sha256으로 주소를
// 매겨 둔다. 같은 내용은 하나다. 쓰기는 임시 파일 → hash 확인 → 원자 설치다. 파일 일은 모두 async
// API로 한다(core graph에 동기 file API를 들이지 않는다).

export type StoredBlob = {
  // 내용의 sha256(hex). 파일 이름이자 FileState.blob의 key다.
  key: string;
  size: number;
  // 이번 호출이 새로 설치했으면 true, 이미 같은 내용이 있었으면 false.
  created: boolean;
};

export type RewindStore = {
  put(session: string, content: Uint8Array): Promise<StoredBlob>;
  // 없거나 내용 hash가 key와 다르면 던진다.
  read(session: string, key: string): Promise<Uint8Array>;
  has(session: string, key: string): Promise<boolean>;
  // session 안 서로 다른 저장물의 크기 합(byte). 임시 파일은 세지 않는다.
  totalBytes(session: string): Promise<number>;
  // live에 없는 저장물(고아)과 남은 임시 파일을 지운다. 지운 저장물의 key를 돌려준다.
  sweep(session: string, live: ReadonlySet<string>): Promise<string[]>;
  // session 디렉터리 전체를 지운다. 없어도 성공이다.
  removeSession(session: string): Promise<void>;
};

const KEY = /^[0-9a-f]{64}$/;
const SESSION = /^[a-z0-9_]+$/;
const TEMP_SUFFIX = ".tmp";

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function missing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ENOENT";
}

export function createRewindStore(dataRoot: string): RewindStore {
  // 같은 process 안의 임시 파일 이름이 겹치지 않게 한다.
  let temps = 0;

  const dirOf = (session: string): string => {
    // session ID는 경로의 한 조각이다. 다른 값은 저장소 밖을 가리킬 수 있어 쓰지 않는다.
    if (!SESSION.test(session)) throw new Error("invalid session id");
    return join(dataRoot, "rewind", session);
  };
  const fileOf = (session: string, key: string): string => {
    if (!KEY.test(key)) throw new Error("invalid store key");
    return join(dirOf(session), key);
  };
  const entries = async (session: string): Promise<string[]> => {
    try {
      return await readdir(dirOf(session));
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
  };

  return {
    async put(session, content) {
      const key = sha256(content);
      const target = fileOf(session, key);
      const size = content.length;
      try {
        if ((await stat(target)).size === size) {
          return { key, size, created: false };
        }
      } catch (error) {
        if (!missing(error)) throw error;
      }
      await mkdir(dirOf(session), { recursive: true, mode: 0o700 });
      temps += 1;
      const temp = join(dirOf(session), `${key}.${temps}${TEMP_SUFFIX}`);
      try {
        await writeFile(temp, content, { mode: 0o600 });
        if (sha256(await readFile(temp)) !== key) {
          throw new Error("stored content does not match its hash");
        }
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        throw error;
      }
      return { key, size, created: true };
    },

    async read(session, key) {
      const content = await readFile(fileOf(session, key));
      if (sha256(content) !== key) {
        throw new Error("stored content does not match its key");
      }
      return new Uint8Array(content);
    },

    async has(session, key) {
      try {
        return (await stat(fileOf(session, key))).isFile();
      } catch (error) {
        if (missing(error)) return false;
        throw error;
      }
    },

    async totalBytes(session) {
      let total = 0;
      for (const name of await entries(session)) {
        if (!KEY.test(name)) continue;
        total += (await stat(join(dirOf(session), name))).size;
      }
      return total;
    },

    async sweep(session, live) {
      const removed: string[] = [];
      for (const name of (await entries(session)).sort()) {
        const path = join(dirOf(session), name);
        if (name.endsWith(TEMP_SUFFIX)) {
          await rm(path, { force: true });
        } else if (KEY.test(name) && !live.has(name)) {
          await rm(path, { force: true });
          removed.push(name);
        }
      }
      return removed;
    },

    async removeSession(session) {
      await rm(dirOf(session), { recursive: true, force: true });
    },
  };
}
