// 개발 확인 전용 등록 폴더. LOPHN_DEV_SEED=1일 때 renderer 시드 작업대의 프로젝트에만
// LOPHN_DEV_SEED_FOLDERS(JSON 경로 배열)를 등록 폴더로 준다. 제품 실행은 이 변수를
// 주지 않고 documents read만 쓴다. 폴더 검사·시작은 제품과 같은 host 경로다.

/** renderer/desktop/dev-seed.ts의 DEV_SEED_PROJECT와 같다. */
export const DEV_SEED_PROJECT = "prj_01k6devseed000000000000000";

export function devSeedFolders(
  env: Readonly<Record<string, string | undefined>>,
  project: string,
): readonly { folder_ref: string; path: string }[] | null {
  if (env.LOPHN_DEV_SEED !== "1" || project !== DEV_SEED_PROJECT) return null;
  let paths: unknown;
  try {
    paths = JSON.parse(env.LOPHN_DEV_SEED_FOLDERS ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(paths)) return [];
  return paths
    .filter((path): path is string => typeof path === "string")
    .map((path, index) => ({ folder_ref: `${project}_${index}`, path }));
}
