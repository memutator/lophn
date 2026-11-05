// call 정책에 `private`(다른 workspace와 call을 주고받지 않는 workspace)이 생기면서 `settings.json`의 옛 정책에
// 빈 목록을 채운다. 틀린 key 하나가 settings 전체를 거절시키므로 옛 정책을 그대로 둘 수 없다.
// call 정책 이름을 옮기는 `settings.call-policy-workspaces`와 서로 다른 key만 만져 어느 쪽이 먼저 돌아도 같다.
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import { CALL_POLICY_SETTING_KEY } from "../../../../protocol/lophn-agent/call-policy.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// 다시 돌아도 같다: `private`이 있으면 아무것도 쓰지 않는다.
export const callPolicyPrivateStep: DataStep = {
  id: "settings.call-policy-private",
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
        // 사람이 고칠 파일이다. 옮길 수 없으면 그대로 둔다.
        return ok(undefined);
      }
      if (!isRecord(settings)) return ok(undefined);
      const policy = settings[CALL_POLICY_SETTING_KEY];
      if (!isRecord(policy) || "private" in policy) return ok(undefined);
      settings[CALL_POLICY_SETTING_KEY] = { private: [], ...policy };
      const mode = (await stat(path)).mode & 0o777;
      await writeFile(`${path}.tmp`, `${JSON.stringify(settings, null, 2)}\n`, {
        mode,
      });
      await rename(`${path}.tmp`, path);
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "settings.json의 call 정책에 private을 채우지 못했다",
      });
    }
  },
};
