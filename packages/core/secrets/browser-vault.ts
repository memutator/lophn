// `<data root>/browser-vault.json`(0600): browser profile 정의와 저장 login metadata, 칸마다의 stamp, 지운 것의 흔적.
// 값은 없다(값은 secrets.json의 `login.<id>.*`). 파일이 없으면 빈 vault다. 쓰기는 임시 파일에 0600으로 쓰고 rename한다.
// 쓰는 것은 core 하나이고 file이 작아 동기 I/O로 읽고 쓴다: 읽고 바꾸는 사이에 다른 쓰기가 끼지 않는다.
import {
  chmodSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { type Clock, err, errorCode, ok, type Result } from "../../base/mod.ts";
import {
  BROWSER_VAULT_FILE_NAME,
  type BrowserProfile,
  type Login,
  type VaultFile,
  vaultFileSchema,
} from "../../protocol/secrets/mod.ts";

export type VaultChange<T> = (
  vault: VaultFile,
  stamp: number,
) => Result<{ vault: VaultFile; value: T }>;

export type BrowserVault = {
  read(): Result<VaultFile>;
  // 바꾼 vault를 쓴다. stamp는 이번 바꿈에 쓸 칸 stamp다.
  update<T>(change: VaultChange<T>): Result<T>;
  // 지금 vault가 `seen`(read가 준 그 값)이면 `next`로 바꾼다. 그 사이 바뀌었으면 쓰지 않고 false다(합치기가 다시 한다).
  replace(seen: VaultFile, next: VaultFile): Result<boolean>;
};

export const EMPTY_VAULT: VaultFile = {
  format: 1,
  profiles: [],
  logins: [],
  removed: [],
  clear: [],
};

const unavailable = (message: string) =>
  err({ code: "unavailable" as const, message });

/** vault에 적힌 가장 큰 stamp. 새 stamp는 이보다 커야 받은 변경을 이긴다. */
export function largestStamp(vault: VaultFile): number {
  let largest = 0;
  const see = (revs: Record<string, number>) => {
    for (const value of Object.values(revs)) largest = Math.max(largest, value);
  };
  for (const profile of vault.profiles) see(profile.revs);
  for (const login of vault.logins) see(login.revs);
  for (const removed of vault.removed) {
    largest = Math.max(largest, removed.at);
    see(removed.seen);
  }
  return largest;
}

export function parseVault(text: string): Result<VaultFile> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return unavailable("browser vault 파일 모양이 맞지 않는다");
  }
  const parsed = vaultFileSchema.safeParse(json);
  return parsed.success
    ? ok(parsed.data)
    : unavailable("browser vault 파일 모양이 맞지 않는다");
}

/** 임시 파일(0600)에 쓰고 rename한다. */
export function writeVaultFile(path: string, vault: VaultFile): Result<void> {
  const temp = `${path}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(vault), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
    return ok(undefined);
  } catch {
    rmSync(temp, { force: true });
    return unavailable("browser vault 파일을 쓰지 못했다");
  }
}

export function createBrowserVault(options: {
  root: string;
  clock: Clock;
}): BrowserVault {
  const path = `${options.root}/${BROWSER_VAULT_FILE_NAME}`;
  let cached: VaultFile | undefined;

  function read(): Result<VaultFile> {
    if (cached !== undefined) return ok(cached);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return ok(EMPTY_VAULT);
      return unavailable("browser vault 파일을 읽을 수 없다");
    }
    const parsed = parseVault(text);
    if (parsed.ok) cached = parsed.value;
    return parsed;
  }

  return {
    read,
    update(change) {
      const current = read();
      if (!current.ok) return current;
      const stamp = Math.max(
        options.clock.nowMs(),
        largestStamp(current.value) + 1,
      );
      const changed = change(current.value, stamp);
      if (!changed.ok) return changed;
      const written = writeVaultFile(path, changed.value.vault);
      if (!written.ok) return written;
      cached = changed.value.vault;
      return ok(changed.value.value);
    },
    replace(seen, next) {
      const current = read();
      if (!current.ok) return current;
      if (current.value !== seen) return ok(false);
      const written = writeVaultFile(path, next);
      if (!written.ok) return written;
      cached = next;
      return ok(true);
    },
  };
}

export function profilesOf(vault: VaultFile): BrowserProfile[] {
  return vault.profiles.map(({ id, name, color }) => ({ id, name, color }));
}

/** login의 view. `profile`이 없으면 기본 profile(null)이다. */
export function loginsOf(vault: VaultFile): Login[] {
  return vault.logins.map(({ id, label, origin, username, note, profile }) => ({
    id,
    label,
    origin,
    username,
    note,
    profile: profile ?? null,
  }));
}
