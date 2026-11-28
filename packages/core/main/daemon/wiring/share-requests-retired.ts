// 앱 공유 요청을 걷어낸 뒤 옛 ledger에 남은 `share_requests` 표를 거두는 step이다.
// - `approvals.share_requests`는 이미 적용한 ledger가 이 id를 기록하고 SQL hash가 lock에 얼어 있어 목록에서 뺄 수 없다
//   (빼면 기동을 거절한다). 옛 위치(TEAMS의 옛 share-requests 자리)에 그대로 둔다. `lophn.split-per-workspace`가 이 표를
//   고치므로 순서도 그대로여야 한다.
// - `approvals.share_requests.drop`은 새 step이라 낸 step 목록의 맨 끝에 붙는다(WIRINGS 맨 뒤 wiring인 worktrees의 schemaStepsAfterTeams 끝).
// - `settings.coding-shared-apps-drop`은 설정 `coding-agent.shared_apps`를 settings.json에서 지운다. 배포 목록(`coding-agent.deployed_skills`)으로
//   옮기지 않는다: 옛 값은 앱 전체를 가리켰고 새 값은 skill 하나씩 가리키므로 사람이 다시 고른다.
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import type { SchemaStep } from "../../../../protocol/server/mod.ts";

const CREATE_STEP: SchemaStep = {
  id: "approvals.share_requests",
  sql: `
create table share_requests (
  app text primary key,
  agents text not null,
  coding_agents integer not null check (coding_agents in (0, 1)),
  reason text not null,
  session text not null,
  requested_at text not null
);`,
};

export const SHARE_REQUESTS_DROP_STEP: SchemaStep = {
  id: "approvals.share_requests.drop",
  sql: "drop table share_requests;",
};

export function createCoreRegistration() {
  return { schemaSteps: [CREATE_STEP] };
}

export const sharedAppsSettingDropStep: DataStep = {
  id: "settings.coding-shared-apps-drop",
  async run(root): Promise<Result<void>> {
    const path = `${root}/settings.json`;
    try {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (thrown) {
        if (errorCode(thrown) === "ENOENT") return ok(undefined);
        throw thrown;
      }
      let settings: unknown;
      try {
        settings = JSON.parse(text);
      } catch {
        return ok(undefined);
      }
      if (
        typeof settings !== "object" ||
        settings === null ||
        Array.isArray(settings) ||
        !("coding-agent.shared_apps" in settings)
      ) {
        return ok(undefined);
      }
      const { "coding-agent.shared_apps": _gone, ...rest } = settings as Record<
        string,
        unknown
      >;
      const mode = (await stat(path)).mode & 0o777;
      await writeFile(`${path}.tmp`, `${JSON.stringify(rest, null, 2)}\n`, {
        mode,
      });
      await rename(`${path}.tmp`, path);
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "settings.json에서 coding-agent.shared_apps를 지우지 못했다",
      });
    }
  },
};
