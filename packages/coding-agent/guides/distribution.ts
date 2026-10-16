// 배포 skill 원본을 읽는다. 원본은 이 module 옆 `skills/<name>/`이고 개발 저장소와 설치 묶음이 같다.
// 읽은 내용의 hash가 manifest 기록과 다르면 설치하지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import { CODING_SKILL_NAMES } from "../../protocol/coding-agent/mod.ts";
import { SKILL_RELEASES, skillContentHash } from "./manifest.ts";

export const DISTRIBUTED_SKILLS_DIR = decodeURIComponent(
  new URL("./skills", import.meta.url).pathname,
);

export type DistributedSkill = {
  name: string;
  files: { path: string; content: string }[];
};

async function collect(
  root: string,
  dir: string,
  files: DistributedSkill["files"],
): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory) await collect(root, full, files);
    else if (entry.isFile) {
      files.push({
        path: full.slice(root.length + 1),
        content: await Deno.readTextFile(full),
      });
    }
  }
}

export async function loadSkills(
  dir: string = DISTRIBUTED_SKILLS_DIR,
): Promise<Result<DistributedSkill[]>> {
  const skills: DistributedSkill[] = [];
  for (const name of CODING_SKILL_NAMES) {
    const files: DistributedSkill["files"] = [];
    try {
      await collect(`${dir}/${name}`, `${dir}/${name}`, files);
    } catch {
      return err({
        code: "unavailable",
        message: `배포 skill 원본을 읽지 못했다: ${name}`,
      });
    }
    const release = SKILL_RELEASES.find((item) => item.name === name);
    const actual = await skillContentHash(files);
    if (release === undefined || release.hash !== actual) {
      return err({
        code: "internal",
        message:
          `${name}의 내용이 manifest 기록과 다르다. 내용을 바꿨으면 version을 올리고 manifest에 hash(${actual})를 기록한다`,
      });
    }
    skills.push({ name, files });
  }
  return ok(skills);
}
