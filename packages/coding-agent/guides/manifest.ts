// 배포 skill의 version·content hash manifest다(coding-agent/guides#R20). 배포하는 skill마다 version과
// 파일 내용 hash를 여기에 기록하고, 같은 version의 내용이 바뀌면 배포 테스트가 실패한다. 내용을 바꾸면
// version을 올리고 새 hash를 함께 기록한다. 설치 묶음은 이 manifest와 함께 서명되므로 설치 때도 내용
// hash가 기록과 맞아야 설치한다. 사용자가 만든 skill은 이 manifest에 없고 로컬 파일로만 다룬다.
import { sha256Hex } from "../../base/mod.ts";

export type SkillRelease = {
  name: string;
  // `major.minor.patch`다.
  version: string;
  // 파일별 hash를 경로 순으로 접은 sha256 hex다(`skillContentHash`).
  hash: string;
};

export const SKILL_RELEASES: readonly SkillRelease[] = [
  {
    name: "lophn-build-app",
    version: "1.0.1",
    hash: "60d366d72ea47ec2755ea06620ab9c4b6c3a5740b3bd692cda61c09089e29f52",
  },
  {
    name: "lophn-navigate",
    version: "1.0.1",
    hash: "de7f295c9a797e4da15226627cd2645607313dadb51f247a63e455e059c35887",
  },
  {
    name: "lophn-repair",
    version: "1.0.0",
    hash: "48dc8ea3d2dda91ce01159529d2b5a0d672c88f77055a4ac9e82c0d3827883c2",
  },
  {
    name: "lophn-save",
    version: "1.0.0",
    hash: "79616e372b2eb61fbbd7eb73e935d4ca0ac9b638c95f84b149da24cb185e381b",
  },
];

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// skill 디렉터리 안 모든 파일의 내용 hash다. 줄바꿈과 인코딩은 파일 bytes 그대로 본다.
export async function skillContentHash(
  files: readonly { path: string; content: string }[],
): Promise<string> {
  const lines: string[] = [];
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : 1)) {
    lines.push(`${file.path} ${await sha256Hex(file.content)}`);
  }
  return await sha256Hex(lines.join("\n"));
}

export type ManifestIssue = {
  name: string;
  message: string;
};

// 읽은 skill 내용이 manifest 기록과 맞는지 본다. 기록에 없는 skill, 내용 없는 기록, 같은 version의
// 내용 변경, version 형식 오류를 모두 낸다.
export async function checkManifest(
  skills: readonly {
    name: string;
    files: readonly { path: string; content: string }[];
  }[],
  manifest: readonly SkillRelease[] = SKILL_RELEASES,
): Promise<ManifestIssue[]> {
  const issues: ManifestIssue[] = [];
  const seen = new Set<string>();
  for (const release of manifest) {
    if (seen.has(release.name)) {
      issues.push({ name: release.name, message: "manifest에 이름이 겹친다" });
    }
    seen.add(release.name);
    if (!VERSION.test(release.version)) {
      issues.push({
        name: release.name,
        message: `version이 major.minor.patch가 아니다: ${release.version}`,
      });
    }
    if (!/^[0-9a-f]{64}$/.test(release.hash)) {
      issues.push({
        name: release.name,
        message: "hash가 sha256 hex가 아니다",
      });
    }
  }
  for (const skill of skills) {
    const release = manifest.find((item) => item.name === skill.name);
    if (release === undefined) {
      issues.push({ name: skill.name, message: "manifest에 없는 skill이다" });
      continue;
    }
    const actual = await skillContentHash(skill.files);
    if (actual !== release.hash) {
      issues.push({
        name: skill.name,
        message:
          `version ${release.version}의 내용이 manifest 기록과 다르다. 내용을 바꿨으면 version을 올리고 manifest에 version과 hash(${actual})를 함께 기록한다`,
      });
    }
  }
  for (const release of manifest) {
    if (!skills.some((skill) => skill.name === release.name)) {
      issues.push({
        name: release.name,
        message: "manifest의 skill 내용이 없다",
      });
    }
  }
  return issues;
}
