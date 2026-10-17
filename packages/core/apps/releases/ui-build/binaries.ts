// 준비 자식이 쓰는 신뢰된 도구의 위치와 최소 환경이다. AI가 쓴 앱 코드의 실수가 퍼지지 않게
// 자식에게는 필요한 환경 변수 몇 개만 넘기고(`clearEnv`) 실행을 허락하는 프로그램도 이름으로 좁힌다.

export function denoDirOf(): string {
  const set = Deno.env.get("DENO_DIR");
  if (set) return set;
  const cache = Deno.env.get("XDG_CACHE_HOME");
  if (cache) return `${cache}/deno`;
  return `${Deno.env.get("HOME") ?? "/tmp"}/.cache/deno`;
}

// 설치된(캐시된) esbuild 실행 파일의 절대 경로다. build는 이것과 deno만 실행할 수 있다.
export async function esbuildBinaries(denoDir: string): Promise<string[]> {
  const base = `${denoDir}/npm/registry.npmjs.org/@esbuild`;
  const found: string[] = [];
  try {
    for await (const platform of Deno.readDir(base)) {
      if (!platform.isDirectory) continue;
      for await (const version of Deno.readDir(`${base}/${platform.name}`)) {
        if (!version.isDirectory) continue;
        const binary = `${base}/${platform.name}/${version.name}/bin/esbuild`;
        if (await Deno.stat(binary).then((info) => info.isFile, () => false)) {
          found.push(binary);
        }
      }
    }
  } catch { /* esbuild가 설치되지 않았다 */ }
  return found.sort();
}

// 자식에게 넘기는 환경이다. 이 밖의 환경(credential·사람의 설정)은 자식에 없다.
export function buildEnvironment(tmp: string): Record<string, string> {
  const env: Record<string, string> = { TMPDIR: tmp };
  for (const name of ["HOME", "PATH", "DENO_DIR", "XDG_CACHE_HOME"]) {
    const value = Deno.env.get(name);
    if (value !== undefined) env[name] = value;
  }
  return env;
}

const REPO = new URL("../../../../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);

// build 도구(esbuild 실행 파일과 deno loader)를 deno-dir에 받는다. `deno cache`는 앱 코드를 실행하지 않는다.
// 준비 자식은 시작할 때 이미 있는 esbuild 실행 파일만 실행 허락 목록에 담을 수 있어서 자식을 띄우기 전에 부른다.
export async function cacheBuildTools(
  deno: string,
  env: Record<string, string>,
  signal?: AbortSignal,
): Promise<boolean> {
  const done = await new Deno.Command(deno, {
    args: [
      "cache",
      "--no-lock",
      `--config=${REPO}/deno.json`,
      `${REPO}/packages/core/apps/releases/ui-build/app-build.ts`,
    ],
    env,
    clearEnv: true,
    stdin: "null",
    stdout: "null",
    stderr: "null",
    signal,
  }).output();
  return done.success;
}
