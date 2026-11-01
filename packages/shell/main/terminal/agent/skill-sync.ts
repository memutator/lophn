// 공유 skill 사본 맞추기(`lophn harness sync-skills`)를 부른다. 한 번에 하나만 돌고, 도는 중에 또 요청이 오면 끝난 뒤 한 번 더 돈다.
// 실패는 log만 남기고 호출한 쪽을 막지 않는다.
import type { CliRun } from "./hook-install.ts";

export type SkillSync = { request(): void };

export function createSkillSync(deps: {
  /** `lophn` CLI. 설치 경로를 모르면 null이고 아무것도 하지 않는다. */
  runCli: CliRun | null;
  log(message: string): void;
}): SkillSync {
  let running = false;
  let again = false;

  async function run(): Promise<void> {
    running = true;
    try {
      do {
        again = false;
        try {
          const done = await deps.runCli!(["harness", "sync-skills"]);
          if (!done.ok) deps.log(`shared skills not synced: ${done.message}`);
        } catch (cause) {
          deps.log(`shared skills not synced: ${String(cause)}`);
        }
      } while (again);
    } finally {
      running = false;
    }
  }

  return {
    request() {
      if (deps.runCli === null) return;
      if (running) again = true;
      else void run();
    },
  };
}
