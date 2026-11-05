import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import type { Stats } from "node:fs";
import { isAbsolute, join } from "node:path";
import process from "node:process";
import {
  err,
  errorCode,
  ok,
  type OsPlatform,
  type Result,
} from "../../base/mod.ts";

// POSIX 데이터 root·관리 앱 폴더·runtime 제어 폴더는 소유자가 아니거나 0700보다 넓으면 기동을 거절한다.
// Windows는 소유자·mode를 보지 않는다: stat mode가 ACL을 나타내지 못하고, 사용자 profile 아래 폴더는 ACL이 이미 사용자만 연다.
const OWNER_ONLY = 0o700;
const MANAGED = ["apps", "run"] as const;

export type DataRoot = {
  // 소유자·symlink를 확인한 정규 경로 하나. 이후 모든 위치는 이 경로 기준이다.
  path: string;
  run: string;
  apps: string;
};

function refused(): Result<never> {
  return err({
    code: "unavailable",
    message:
      "데이터 root의 소유자·권한·symlink 검사를 통과하지 못해 기동을 거절한다",
  });
}

// symlink를 따라가지 않는다. 링크 자체나 그 안의 구성 요소면 거절한다.
async function ownerOnly(path: string, uid: number | null): Promise<boolean> {
  let stat: Stats;
  try {
    stat = await lstat(path);
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return true;
    return false;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
  if (uid === null) return true;
  if (stat.uid !== uid) return false;
  return ((stat.mode ?? 0) & 0o077) === 0;
}

async function ensure(path: string, uid: number | null): Promise<boolean> {
  if (!(await ownerOnly(path, uid))) return false;
  try {
    await mkdir(path, { mode: OWNER_ONLY, recursive: false });
  } catch (thrown) {
    if (errorCode(thrown) !== "EEXIST") return false;
  }
  // mkdir이 mode를 umask로 좁히므로 만든 뒤에는 0700을 명시한다. Windows는 mode가 없다.
  if (uid !== null) {
    try {
      await chmod(path, OWNER_ONLY);
    } catch {
      return false;
    }
  }
  return await ownerOnly(path, uid);
}

// LOPHN_HOME이 있으면 그 경로, 없으면 ~/.lophn. 설정 override가 아니라 시작 전 선택이다.
export async function resolveDataRoot(
  env: {
    home?: string;
    lophnHome?: string;
  },
  platform: OsPlatform = process.platform,
): Promise<Result<DataRoot>> {
  const requested =
    env.lophnHome && env.lophnHome.length > 0
      ? env.lophnHome
      : env.home
        ? join(env.home, ".lophn")
        : undefined;
  if (requested === undefined || !isAbsolute(requested)) return refused();
  // 요청 경로 자체가 symlink면 다른 곳으로 열린다. 그 경로는 거절한다.
  try {
    if ((await lstat(requested)).isSymbolicLink()) return refused();
  } catch (thrown) {
    if (errorCode(thrown) !== "ENOENT") return refused();
  }
  let real: string;
  try {
    real = await realpath(requested);
  } catch (thrown) {
    if (errorCode(thrown) !== "ENOENT") return refused();
    // 아직 없는 root만 만든다. 중간 경로의 symlink는 realpath가 이미 풀었다.
    try {
      await mkdir(requested, { mode: OWNER_ONLY, recursive: true });
      real = await realpath(requested);
    } catch {
      return refused();
    }
  }
  // POSIX에서 uid를 모르면 거절한다. null은 소유자·mode 검사를 건너뛰는 Windows만이다.
  const uid = platform === "win32" ? null : (process.getuid?.() ?? undefined);
  if (uid === undefined || !(await ensure(real, uid))) return refused();
  for (const name of MANAGED) {
    if (!(await ensure(join(real, name), uid))) return refused();
  }
  return ok({ path: real, run: join(real, "run"), apps: join(real, "apps") });
}
