// 앱 sidebar panel과 tray가 "사람이 켜야 나온다"에서 "선언하면 나온다"로 바뀌면서 `settings.json`의 옛 `shell.sidebar_panels`와
// `shell.tray`(켠 목록)가 의미를 잃었다. 켠 것은 이제 기본이라 잃는 것이 없다. 모르는 key 하나가 settings 전체를 거절시키므로 지운다.
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";

const OLD_KEYS = ["shell.sidebar_panels", "shell.tray"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// 다시 돌아도 같다: 옛 key가 없으면 아무것도 쓰지 않는다.
export const placesDefaultOnStep: DataStep = {
  id: "settings.places-default-on",
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
      if (!isRecord(settings) || !OLD_KEYS.some((key) => key in settings)) {
        return ok(undefined);
      }
      for (const key of OLD_KEYS) delete settings[key];
      const mode = (await stat(path)).mode & 0o777;
      await writeFile(`${path}.tmp`, `${JSON.stringify(settings, null, 2)}\n`, {
        mode,
      });
      await rename(`${path}.tmp`, path);
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "settings.json의 옛 sidebar panel·tray 목록을 지우지 못했다",
      });
    }
  },
};
