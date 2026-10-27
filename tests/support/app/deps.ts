// 앱 E2E의 core env 규칙 한 곳. 앱 release 준비는 staging에서 npm 의존을 받으므로 `npm run e2e:deps`가
// `.dev-data/e2e/npm-cache`를 미리 채운다. E2E 중 network는 loopback뿐이라 사람의 `~/.npm`이나 인터넷에
// 기대지 않고, cache에 없는 것은 offline 설치가 실패로 드러낸다.
import { readdir } from "node:fs/promises";
import process from "node:process";

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");

export function e2eNpmCache(): string {
  return `${REPO}/.dev-data/e2e/npm-cache`;
}

/** `bootCore(run, { env })`에 넘길 값. */
export async function appCoreEnv(): Promise<Record<string, string>> {
  const cache = e2eNpmCache();
  let filled = false;
  try {
    for (const _entry of await readdir(cache, { withFileTypes: true })) {
      filled = true;
      break;
    }
  } catch {
    /* 없다 */
  }
  if (!filled) {
    throw new Error(`${cache}가 비었다. npm run e2e:deps를 먼저 돌려라`);
  }
  // 앱 socket 폴더가 XDG_RUNTIME_DIR 아래 data root마다 있다.
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (!runtime) {
    throw new Error(
      "XDG_RUNTIME_DIR이 없다. 앱 socket 폴더가 그 아래 data root마다 생긴다",
    );
  }
  return {
    npm_config_cache: cache,
    // 설치가 registry에 닿지 않게 한다.
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    XDG_RUNTIME_DIR: runtime,
  };
}
