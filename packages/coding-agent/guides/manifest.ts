// 배포 skill의 version·content hash 기록이다. 내용을 바꾸면 version을 올리고 새 hash를 함께 기록한다.
// 설치는 읽은 내용의 hash가 이 기록과 맞을 때만 한다(`loadSkills`).
import { sha256Hex } from "../../base/mod.ts";

type SkillRelease = {
  name: string;
  // `major.minor.patch`다.
  version: string;
  // 파일별 hash를 경로 순으로 접은 sha256 hex다(`skillContentHash`).
  hash: string;
};

export const SKILL_RELEASES: readonly SkillRelease[] = [
  {
    name: "lophn-build-app",
    version: "2.0.1",
    hash: "c6ccc8226fd0472744f2d09f5d02a181b9c3dcf2bd222bf31a53d1bad26850a3",
  },
  {
    name: "lophn-repair",
    version: "2.0.1",
    hash: "94ad46c4e355261a62fb43457f3f600a1cac3fae05210c33d40fe95eff5a220a",
  },
];

// skill 디렉터리 안 모든 파일의 내용 hash다.
export async function skillContentHash(
  files: readonly { path: string; content: string }[],
): Promise<string> {
  const lines: string[] = [];
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : 1)) {
    lines.push(`${file.path} ${await sha256Hex(file.content)}`);
  }
  return await sha256Hex(lines.join("\n"));
}
