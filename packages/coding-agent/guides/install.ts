// 배포 skill을 사람이 고른 harness의 skill root에 설치한다(coding-agent/guides#R4, R20, cli#R10). 설치는
// coding-agent/harnesses의 선택 target 설치 engine이 한다: receipt 없는 동명 skill은 덮지 않고 충돌로 남기고,
// 사람이 고친 skill은 충돌이며, 쓰기는 같은 폴더 temp와 rename이다. 이 module은 skill 입력(이름·파일)을
// 넘기고 engine의 skill 디렉터리 결과를 파일별 변경·무변경·충돌로 풀어 줄 뿐이다. 선택한 target의 skill
// root만 쓴다.
import { err, ok, type Result } from "../../base/mod.ts";
import type {
  IntegrationTarget,
  ReceiptOutcome,
} from "../../protocol/coding-agent/mod.ts";
import {
  type InstallPorts,
  installSelected,
  type McpLaunch,
  type RootInputs,
} from "../harnesses/mod.ts";
import type { DistributedSkill } from "./distribution.ts";

export type SkillFileResult = {
  path: string;
  outcome: ReceiptOutcome;
  reason: string;
};

export type SkillInstallResult = {
  name: string;
  version: string;
  hash: string;
  outcome: ReceiptOutcome;
  reason: string;
  files: SkillFileResult[];
};

export type SkillsInstallOutcome = {
  skills: SkillInstallResult[];
  notices: string[];
  status: "complete" | "partial" | "failed";
};

export type SkillsInstallInput = {
  target: IntegrationTarget;
  // 설치할 skill 이름이다. 없으면 배포하는 skill 전부다.
  names?: readonly string[];
  skills: readonly DistributedSkill[];
  roots: RootInputs;
  // skill 설치는 MCP 항목을 쓰지 않지만 engine 입력이 요구한다.
  launch: McpLaunch;
  connection?: string | null;
  operationId: string;
  now: string;
};

const SKILL_NOTICE = /skill/;

export async function installSkills(
  input: SkillsInstallInput,
  ports: InstallPorts,
): Promise<Result<SkillsInstallOutcome>> {
  const wanted = input.names ?? input.skills.map((skill) => skill.name);
  const chosen: DistributedSkill[] = [];
  for (const name of wanted) {
    const skill = input.skills.find((item) => item.name === name);
    if (skill === undefined) {
      return err({
        code: "invalid_input",
        message: `배포하는 skill이 아니다: ${name}`,
      });
    }
    if (!chosen.includes(skill)) chosen.push(skill);
  }
  const results: SkillInstallResult[] = [];
  const notices: string[] = [];
  let anyWrote = false;
  let allClean = true;
  for (const skill of chosen) {
    // 쓰기 직전 디렉터리 내용이다. engine이 실제로 쓰는 때만 부르므로 파일별 변경 여부를 여기서 안다.
    let before: Map<string, string> | null = null;
    const files: InstallPorts["files"] = {
      ...ports.files,
      async writeTree(dir, tree) {
        const listed = await ports.files.listFiles(dir);
        before = new Map(
          listed.kind === "files"
            ? listed.files.map((file) => [file.path, file.text])
            : [],
        );
        return await ports.files.writeTree(dir, tree);
      },
    };
    const installed = await installSelected({
      target: input.target,
      connection: input.connection ?? null,
      launch: input.launch,
      skill: { name: skill.name, files: skill.files },
      version: null,
      roots: input.roots,
      operationId: `${input.operationId}:${skill.name}`,
      now: input.now,
      components: ["skill"],
    }, { files, store: ports.store });
    if (!installed.ok) return installed;
    notices.push(
      ...installed.value.notices.filter((n) => SKILL_NOTICE.test(n)),
    );
    const resource = installed.value.resources.find((item) =>
      item.resource_identity.startsWith("skill:")
    );
    const outcome: ReceiptOutcome = resource?.outcome ?? "skipped";
    const reason = resource?.reason ??
      "이 target에서 만들 skill resource가 없어 건너뛴다";
    const written = before as Map<string, string> | null;
    const perFile: SkillFileResult[] = skill.files.map((file) => {
      if (outcome === "changed" && written !== null) {
        const same = written.get(file.path) === file.content;
        return {
          path: file.path,
          outcome: same ? "unchanged" : "changed",
          reason: same ? "이미 같은 내용이다" : "썼다",
        };
      }
      return { path: file.path, outcome, reason };
    });
    results.push({
      name: skill.name,
      version: skill.version,
      hash: skill.hash,
      outcome,
      reason,
      files: perFile,
    });
    if (installed.value.status !== "complete") allClean = false;
    if (outcome === "changed" || outcome === "unchanged") anyWrote = true;
  }
  return ok({
    skills: results,
    notices,
    status: allClean ? "complete" : anyWrote ? "partial" : "failed",
  });
}
