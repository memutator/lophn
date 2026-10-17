// 앱 E2E의 core env 규칙 한 곳. 의존(npm·jsr·esbuild)은 `.dev-data/e2e/deno-dir` 하나에 `deno task e2e:deps`가
// 미리 받아 둔다. E2E 중 network는 loopback뿐이라 사람의 ~/.cache/deno나 인터넷에 기대지 않는다.

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");

export function e2eDenoDir(): string {
  return `${REPO}/.dev-data/e2e/deno-dir`;
}

/** `bootCore(run, { env })`에 넘길 값. */
export async function appCoreEnv(): Promise<Record<string, string>> {
  const denoDir = e2eDenoDir();
  let filled = false;
  try {
    for await (const _ of Deno.readDir(denoDir)) {
      filled = true;
      break;
    }
  } catch { /* 없다 */ }
  if (!filled) {
    throw new Error(`${denoDir}가 비었다. deno task e2e:deps를 먼저 돌려라`);
  }
  // app test가 systemd-run --user로 자식을 띄운다.
  const runtime = Deno.env.get("XDG_RUNTIME_DIR");
  if (!runtime) {
    throw new Error(
      "XDG_RUNTIME_DIR이 없다. app test가 systemd-run --user를 쓴다",
    );
  }
  return { DENO_DIR: denoDir, XDG_RUNTIME_DIR: runtime };
}
