// 준비 자식이 쓰는 신뢰된 도구의 위치와 최소 환경이다(apps/releases#R3). 앱 source는 신뢰하지 않으므로
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
