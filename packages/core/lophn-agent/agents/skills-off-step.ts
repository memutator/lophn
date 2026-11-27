import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { AgentId } from "../../../protocol/lophn-agent/mod.ts";
import { createFileSettingsReader } from "../../config/mod.ts";
import { platformEntryUrl } from "../../install-and-update/mod.ts";
import type { DataStep } from "../../storage/migration/mod.ts";
import { skillFoldersSetting } from "../extensions/settings.ts";
import { discoverSkills, type SkillFiles } from "../extensions/skills.ts";
import { parseAgentFile, serializeAgentFile } from "./definition-file.ts";

// 옛 정의의 `skills`(받을 이름)를 `skills_off`(끈 이름)로 옮긴다. 옮기기 전에 받던 skill이 그대로 받아지도록, 그때 발견되는
// 후보(내장, 개인 보관소, 등록 폴더, 그 agent가 맡은 domain의 skill) 가운데 `skills`에 없는 이름을 `skills_off`에 적는다.
// 정의 schema가 `skills`를 더 받지 않게 되어도 돌도록 파일을 schema 없이 YAML로 읽고, 새 모양만 schema로 검사해 쓴다.
export const SKILLS_OFF_STEP_ID = "agents.skills-off";

const FENCE = "---";
const YAML_OPTIONS = { schema: "core" } as const;
const STRINGIFY_OPTIONS = {
  schema: "core",
  lineWidth: 0,
  aliasDuplicateObjects: false,
} as const;

// 동기 file 눈은 core 프로세스의 module graph에 둘 수 없어 쓸 때 URL로 연다.
const NODE_FS = platformEntryUrl(import.meta.url, "extensionNodeFs").href;

type Plain = Record<string, unknown>;

function split(text: string): { fields: Plain; body: string } | null {
  const lines = text.split("\n");
  if (lines[0].replace(/\r$/, "") !== FENCE) return null;
  const close = lines.findIndex(
    (line, i) => i > 0 && line.replace(/\r$/, "") === FENCE,
  );
  if (close === -1) return null;
  try {
    const fields = parse(lines.slice(1, close).join("\n"), YAML_OPTIONS);
    if (
      fields === null ||
      typeof fields !== "object" ||
      Array.isArray(fields)
    ) {
      return null;
    }
    return { fields: fields as Plain, body: lines.slice(close + 1).join("\n") };
  } catch {
    return null;
  }
}

async function folderNames(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

export function createSkillsOffStep(bundledSkillsRoot: string): DataStep {
  return {
    id: SKILLS_OFF_STEP_ID,
    async run(root): Promise<Result<void>> {
      try {
        const files = (
          (await import(NODE_FS)) as {
            createNodeSkillFiles(): SkillFiles;
          }
        ).createNodeSkillFiles();
        const registered =
          createFileSettingsReader(root).get(skillFoldersSetting) ?? [];
        const allDomains = (await folderNames(`${root}/domains`)).filter(
          (name) => /^dom_[0-9a-z]+$/.test(name),
        );
        for (const file of await folderNames(`${root}/agents`)) {
          if (!file.endsWith(".md")) continue;
          const path = `${root}/agents/${file}`;
          const agent = file.slice(0, -3) as AgentId;
          const found = split(await readFile(path, "utf8"));
          if (found === null || !Array.isArray(found.fields.skills)) continue;
          const { skills, ...kept } = found.fields;
          const chosen = skills as string[];
          const own = Array.isArray(kept.skills_off)
            ? (kept.skills_off as string[])
            : [];
          // 옛 규칙에서 고른 이름이 없으면 모두 받았다.
          // 발견은 domain 층을 따로 갖지 않으므로 domain마다 한 번씩 돌려 합친다. 이름 집합은 같다.
          const folders = (
            Array.isArray(kept.domains)
              ? (kept.domains as string[])
              : allDomains
          ).map((domain) => `${root}/domains/${domain}/skills`);
          const off =
            chosen.length === 0
              ? own
              : [
                  ...new Set([
                    ...own,
                    ...[null, ...folders]
                      .flatMap(
                        (workspaceData) =>
                          discoverSkills(
                            files,
                            {
                              bundled: bundledSkillsRoot,
                              registered,
                              personal: `${root}/skills`,
                              workspaceData,
                            },
                            { kind: null, off: [] },
                          ).entries,
                      )
                      .filter(
                        (skill) =>
                          skill.can_disable && !chosen.includes(skill.name),
                      )
                      .map((skill) => skill.name),
                  ]),
                ];
          // 정의 schema는 `domains` 칸을 더 받지 않아 여기서 함께 뺀다(남기면 아래 검사가 파일을 틀렸다고 본다).
          const { domains: _domains, ...rest } = kept;
          const moved = {
            ...rest,
            ...(off.length > 0 ? { skills_off: off } : {}),
          };
          const parsed = parseAgentFile(
            `${FENCE}\n${stringify(moved, STRINGIFY_OPTIONS)}${FENCE}\n${found.body}`,
            { agent },
          );
          // 틀린 파일은 그대로 둔다. 사람이 고칠 일이다.
          if (!parsed.ok) continue;
          const text = serializeAgentFile(parsed.value, { agent });
          if (!text.ok) continue;
          await writeFile(`${path}.tmp`, text.value, "utf8");
          await rename(`${path}.tmp`, path);
        }
        return ok(undefined);
      } catch {
        return err({
          code: "unavailable",
          message: "agent skills could not be moved to skills_off",
        });
      }
    },
  };
}
