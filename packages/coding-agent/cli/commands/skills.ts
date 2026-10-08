// `lophn skills list|install` command의 표와 실행이다(cli#R10, guides#R4·R5·R20). 목록은 배포 skill의
// 이름·설명·version·content hash를 읽고, 설치는 사람이 고른 exact target 하나의 skill root에만 한다.
// 설치 engine·충돌 규칙은 coding-agent/harnesses의 것이고(receipt 없는 동명 skill은 덮지 않는다) 여기는
// 입력을 넘기고 결과를 파일별 변경·무변경·충돌로 보여 주는 일만 한다.
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  cliSkillsInstallSchema,
  cliSkillsListSchema,
  type IntegrationTarget,
} from "../../../contracts/coding-agent/mod.ts";
import type { Distribution, SkillsInstallOutcome } from "../../guides/mod.ts";
import type { CommandOutput } from "./connection.ts";
import type { CommandEntry } from "./types.ts";

export const SKILLS_COMMANDS: readonly CommandEntry[] = [
  { name: "skills list", input: cliSkillsListSchema },
  { name: "skills install", input: cliSkillsInstallSchema },
];

export type SkillsRunDeps = {
  actor: "user" | "coding_agent";
  // 검사와 manifest 확인을 통과한 배포 skill과 통과하지 못한 원본이다.
  distribution(): Promise<Result<Distribution>>;
  // 선택 target 설치다. 조립이 root·store·launch를 묶어 준다.
  install(request: {
    target: IntegrationTarget;
    names: readonly string[] | undefined;
    operationId: string;
  }): Promise<Result<SkillsInstallOutcome>>;
};

export async function runSkillsList(
  deps: Pick<SkillsRunDeps, "distribution">,
): Promise<Result<CommandOutput, LophnError>> {
  const loaded = await deps.distribution();
  if (!loaded.ok) return loaded;
  const { skills, rejected } = loaded.value;
  return ok({
    summary: rejected.length === 0
      ? `배포 skill ${skills.length}개가 있다`
      : `배포 skill ${skills.length}개가 있고 ${rejected.length}개는 검사를 통과하지 못해 설치할 수 없다`,
    data: {
      skills: skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        version: skill.version,
        hash: skill.hash,
      })),
      rejected,
    },
    next: [
      "사람이 `lophn skills install --target`으로 고른 제품 하나에 설치한다",
    ],
    ...(rejected.length === 0 ? {} : { isError: true as const }),
  });
}

export async function runSkillsInstall(
  input: { target: IntegrationTarget; names?: string[]; operation_id?: string },
  deps: SkillsRunDeps,
): Promise<Result<CommandOutput, LophnError>> {
  if (deps.actor !== "user") {
    return err({ code: "forbidden", message: "skill 설치는 사람 전용이다" });
  }
  const installed = await deps.install({
    target: input.target,
    names: input.names,
    operationId: input.operation_id ?? `cli-${crypto.randomUUID()}`,
  });
  if (!installed.ok) return installed;
  const { skills, notices, status } = installed.value;
  const data = { install: status, skills, notices };
  if (status === "complete") {
    const changed = skills.filter((skill) =>
      skill.outcome === "changed"
    ).length;
    return ok({
      summary: `skill ${skills.length}개 중 ${changed}개를 새로 썼다`,
      data,
      next: [
        "`lophn doctor`로 loading 단계를 확인한다(파일 설치가 loading 성공은 아니다)",
      ],
    });
  }
  return ok({
    summary: status === "partial"
      ? "skill 설치가 일부만 됐다. 충돌한 skill은 덮지 않았다"
      : "skill을 설치하지 못했다",
    data,
    next: [
      "파일별 결과의 충돌·실패를 사람이 확인한다. 같은 이름의 사람 skill은 자동으로 교체하지 않는다",
    ],
    isError: true,
  });
}
