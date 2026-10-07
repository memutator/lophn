// 배포 skill 원본을 읽고 검사해 설치·목록·발견 입력으로 낸다(coding-agent/guides#R1, R2, R4, R20).
// 원본은 `<dir>/<name>/SKILL.md`와 그 보조 자료다. 형식 검사(`checkSkill`)와 manifest(version·hash)를 모두
// 통과한 skill만 설치할 수 있고 통과하지 못한 것은 이유와 함께 목록에만 남는다. symlink는 따라가지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  checkSkill,
  type SkillFileInput,
  type SkillIssue,
} from "./skill-check.ts";
import {
  checkManifest,
  SKILL_RELEASES,
  skillContentHash,
  type SkillRelease,
} from "./manifest.ts";

// 개발 저장소와 설치 묶음 모두 이 module 옆의 `skills/`다(설치 묶음은 같은 내용을 `<설치>/skills/`에도 둔다).
export const DISTRIBUTED_SKILLS_DIR = decodeURIComponent(
  new URL("./skills", import.meta.url).pathname,
);

export type DistributedSkill = {
  name: string;
  description: string;
  version: string;
  hash: string;
  body: string;
  files: readonly { path: string; content: string }[];
};

export type RejectedSkill = {
  directory: string;
  issues: readonly string[];
};

export type Distribution = {
  skills: readonly DistributedSkill[];
  rejected: readonly RejectedSkill[];
};

// 디렉터리 안 파일을 상대 경로로 모은다. symlink가 있으면 그 경로를 돌려준다.
async function collect(
  root: string,
  dir: string,
  files: SkillFileInput[],
  problems: string[],
): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const full = `${dir}/${entry.name}`;
    const stat = await Deno.lstat(full);
    const relative = full.slice(root.length + 1);
    if (stat.isSymlink) {
      problems.push(`symlink는 쓰지 않는다: ${relative}`);
    } else if (stat.isDirectory) {
      await collect(root, full, files, problems);
    } else if (stat.isFile) {
      files.push({ path: relative, content: await Deno.readFile(full) });
    }
  }
}

function describe(issue: SkillIssue): string {
  return `${issue.path}: ${issue.message}`;
}

export async function loadDistribution(
  dir: string = DISTRIBUTED_SKILLS_DIR,
  manifest: readonly SkillRelease[] = SKILL_RELEASES,
): Promise<Result<Distribution>> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isDirectory && !entry.name.startsWith(".")) {
        names.push(entry.name);
      }
    }
  } catch {
    return err({
      code: "unavailable",
      message: "배포 skill 원본을 읽지 못했다",
    });
  }
  names.sort();
  const skills: DistributedSkill[] = [];
  const rejected: RejectedSkill[] = [];
  for (const name of names) {
    const files: SkillFileInput[] = [];
    const problems: string[] = [];
    await collect(`${dir}/${name}`, `${dir}/${name}`, files, problems);
    const checked = checkSkill(name, files);
    problems.push(...checked.issues.map(describe));
    if (checked.skill === null || problems.length > 0) {
      rejected.push({ directory: name, issues: problems });
      continue;
    }
    const release = manifest.find((item) => item.name === name);
    const manifestIssues = await checkManifest(
      [{ name, files: checked.skill.files }],
      release === undefined ? [] : [release],
    );
    if (release === undefined || manifestIssues.length > 0) {
      rejected.push({
        directory: name,
        issues: release === undefined
          ? ["manifest에 없는 skill이다"]
          : manifestIssues.map((item) => item.message),
      });
      continue;
    }
    skills.push({
      name,
      description: checked.skill.description,
      version: release.version,
      hash: await skillContentHash(checked.skill.files),
      body: checked.skill.body,
      files: checked.skill.files,
    });
  }
  return ok({ skills, rejected });
}

// 세션 시작에 발견하는 입력이다. 이름과 설명뿐이고 본문과 보조 자료는 없다(R1).
export function startupDiscovery(
  skills: readonly DistributedSkill[],
): { name: string; description: string }[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
  }));
}

// 사용하려고 고른 skill의 본문이다. 고른 것만 읽힌다(R1).
export function selectSkill(
  skills: readonly DistributedSkill[],
  name: string,
): DistributedSkill | undefined {
  return skills.find((skill) => skill.name === name);
}
