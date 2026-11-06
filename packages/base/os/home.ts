export type OsPlatform = "linux" | "darwin" | "win32" | string;

// 빈 값은 없음으로 친다. Windows는 USERPROFILE이 정본이고 HOMEDRIVE+HOMEPATH가 뒤따른다.
export function homeOf(
  env: Readonly<Record<string, string | undefined>>,
  platform: OsPlatform,
): string | undefined {
  if (platform !== "win32") return env.HOME || undefined;
  if (env.USERPROFILE) return env.USERPROFILE;
  return env.HOMEDRIVE && env.HOMEPATH
    ? `${env.HOMEDRIVE}${env.HOMEPATH}`
    : undefined;
}
