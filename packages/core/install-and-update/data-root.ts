import { err, ok, type Result } from "../../base/mod.ts";

// Linux 데이터 root·관리 앱 폴더·runtime 제어 폴더는 0700보다 넓으면 기동을 거절한다
// (install-and-update R7, R9). 다른 OS의 동등 ACL 검사는 아직 실측이 없다.
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
async function ownerOnly(path: string, uid: number): Promise<boolean> {
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.lstat(path);
  } catch (thrown) {
    if (thrown instanceof Deno.errors.NotFound) return true;
    return false;
  }
  if (stat.isSymlink || !stat.isDirectory) return false;
  if (stat.uid !== uid) return false;
  return ((stat.mode ?? 0) & 0o077) === 0;
}

async function ensure(path: string, uid: number): Promise<boolean> {
  if (!await ownerOnly(path, uid)) return false;
  try {
    await Deno.mkdir(path, { mode: OWNER_ONLY, recursive: false });
  } catch (thrown) {
    if (!(thrown instanceof Deno.errors.AlreadyExists)) return false;
  }
  // mkdir이 mode를 umask로 좁히므로 만든 뒤에는 0700을 명시한다.
  try {
    await Deno.chmod(path, OWNER_ONLY);
  } catch {
    return false;
  }
  return await ownerOnly(path, uid);
}

// LOPHN_HOME이 있으면 그 경로, 없으면 ~/.lophn. 설정 override가 아니라 시작 전 선택이다.
export async function resolveDataRoot(
  env: { home?: string; lophnHome?: string },
): Promise<Result<DataRoot>> {
  const requested = env.lophnHome && env.lophnHome.length > 0
    ? env.lophnHome
    : env.home
    ? `${env.home}/.lophn`
    : undefined;
  if (requested === undefined || !requested.startsWith("/")) return refused();
  // 요청 경로 자체가 symlink면 다른 곳으로 열린다. 그 경로는 거절한다.
  try {
    if ((await Deno.lstat(requested)).isSymlink) return refused();
  } catch (thrown) {
    if (!(thrown instanceof Deno.errors.NotFound)) return refused();
  }
  let real: string;
  try {
    real = await Deno.realPath(requested);
  } catch (thrown) {
    if (!(thrown instanceof Deno.errors.NotFound)) return refused();
    // 아직 없는 root만 만든다. 중간 경로의 symlink는 realpath가 이미 풀었다.
    try {
      await Deno.mkdir(requested, { mode: OWNER_ONLY, recursive: true });
      real = await Deno.realPath(requested);
    } catch {
      return refused();
    }
  }
  const uid = Deno.uid();
  if (uid === null || !await ensure(real, uid)) return refused();
  for (const name of MANAGED) {
    if (!await ensure(`${real}/${name}`, uid)) return refused();
  }
  return ok({ path: real, run: `${real}/run`, apps: `${real}/apps` });
}
