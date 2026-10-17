// 배포 skill 원본을 읽는다. 원본은 이 module 옆 `skills/<name>/`이고 개발 저장소와 설치 묶음이 같다.
// `lophn guide`가 이 원본을 그대로 내준다.
import { err, ok, type Result } from "../../base/mod.ts";
import { CODING_SKILL_NAMES } from "../../protocol/coding-agent/mod.ts";

const DISTRIBUTED_SKILLS_DIR = decodeURIComponent(
  new URL("./skills", import.meta.url).pathname,
);

type DistributedSkill = {
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
    skills.push({ name, files });
  }
  return ok(skills);
}
