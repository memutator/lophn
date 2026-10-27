// 구독 OAuth live 전용 data root다. `test:live:login`이 사람의 진짜 로그인으로 token을 한 번 저장하고,
// `test:live`가 같은 root에 core를 띄워 그 token으로 부른다.
// - 복사하지 않는다. refresh token은 갱신 때마다 회전해서, 복사본과 원본 중 하나가 갱신하면 다른 쪽은 낡은 token을 들고 있다.
// - core는 한 번에 하나만 띄운다(둘째 core는 start_failed). `test:live:login`과 `test:live`를 동시에 돌리지 않는다.
// - 이 코드는 root를 지우지 않는다. 만든 Run의 remove는 빈 함수이고 지우는 길을 만들지 않는다. 다시 로그인하려면
//   사람이 `chmod -R u+w .dev-data/live && rm -rf .dev-data/live`로 직접 지운다(core가 깐 sdk 사본이 읽기 전용이다). schema가 바뀌어 core가 못 뜰 때(history_mismatch)도 같다.
// - 사람의 `~/.lophn`을 건드리지 않는다. bootCore는 env를 비우고 HOME을 `run/user-home`으로 두며, token은 root의
//   `secrets.json`(0600)에 있어 그대로 쓴다. 환경 변수로 token을 넣지 않는다.
// 경로는 repo의 `.dev-data/live`(git이 무시한다)다. core의 log와 user-home은 root 밖 `run`에 둔다.

import { realpathSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { errorCode } from "../../packages/base/mod.ts";
import { bootCore, type Core, type Run } from "../support/core/mod.ts";

const REPO = realpathSync(`${import.meta.dirname}/../..`);
export const LIVE_HOME = `${REPO}/.dev-data/live/home`;
export const LIVE_RUN = `${REPO}/.dev-data/live/run`;

// 로그인으로 token이 한 번 저장된 root인가.
export async function liveRootReady(): Promise<boolean> {
  try {
    await stat(`${LIVE_HOME}/secrets.json`);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

export async function bootLiveCore(): Promise<Core> {
  await mkdir(LIVE_HOME, { recursive: true, mode: 0o700 });
  await mkdir(`${LIVE_RUN}/user-home`, { recursive: true });
  await mkdir(`${LIVE_RUN}/work`, { recursive: true });
  const run: Run = {
    dir: LIVE_RUN,
    home: LIVE_HOME,
    work: `${LIVE_RUN}/work`,
    remove: () => Promise.resolve(),
  };
  // settings는 settings.json이 아직 없을 때만 쓰인다. 구독 호출이 되풀이로 새지 않게 turn의 model 호출 시도를 묶는다.
  return await bootCore(run, {
    settings: { "lophn-agent.run.model_attempts": 3 },
  });
}
