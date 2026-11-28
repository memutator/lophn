import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { DataStep } from "../../storage/migration/mod.ts";

// 이 컴퓨터 앱의 할당(`apps`)과 그 앱 command의 규칙(`permissions.deny`, `permissions.ask`)은 skill 배포로 바뀌었다. 배포는 앱의 active release가
// 가진 public skill에서만 만들 수 있어 옛 할당을 옮기지 않고 지운다(그 앱을 부르면 Gate가 묻는다). 다른 컴퓨터 앱(`remote_apps`)과 다른 칸, 본문은 그대로다.
// 정의를 schema로 읽는 step들보다 앞서 돈다: 새 schema는 두 칸을 받지 않는다. lophn의 정의 파일(`lophn_*.md`)도 지운다.
export const AGENT_DROP_APPS_PERMISSIONS_STEP_ID =
  "agents.drop-apps-permissions";

const FENCE = "---";
const YAML_OPTIONS = { schema: "core" } as const;
const STRINGIFY_OPTIONS = {
  schema: "core",
  lineWidth: 0,
  aliasDuplicateObjects: false,
} as const;

export const agentDropAppsPermissionsStep: DataStep = {
  id: AGENT_DROP_APPS_PERMISSIONS_STEP_ID,
  async run(root): Promise<Result<void>> {
    try {
      const files = await readdir(`${root}/agents`).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const path = `${root}/agents/${file}`;
        const lines = (await readFile(path, "utf8")).split("\n");
        const close = lines.findIndex(
          (line, i) => i > 0 && line.replace(/\r$/, "") === FENCE,
        );
        if (lines[0]?.replace(/\r$/, "") !== FENCE || close === -1) continue;
        let fields: unknown;
        try {
          fields = parse(lines.slice(1, close).join("\n"), YAML_OPTIONS);
        } catch {
          continue;
        }
        if (
          fields === null ||
          typeof fields !== "object" ||
          Array.isArray(fields)
        ) {
          continue;
        }
        const { apps, permissions, ...rest } = fields as Record<
          string,
          unknown
        >;
        if (apps === undefined && permissions === undefined) continue;
        const front =
          Object.keys(rest).length === 0
            ? ""
            : `${FENCE}\n${stringify(rest, STRINGIFY_OPTIONS)}${FENCE}\n`;
        await writeFile(
          `${path}.tmp`,
          `${front}${lines.slice(close + 1).join("\n")}`,
          "utf8",
        );
        await rename(`${path}.tmp`, path);
      }
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "agent apps and permissions could not be removed",
      });
    }
  },
};
