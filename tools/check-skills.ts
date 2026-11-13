// 내장 skill 크기 검사. 실행: node tools/check-skills.ts [root]
// 내장 skill의 SKILL.md와 딸린 .md가 skill reader의 읽기 상한 안인지 본다. 넘은 SKILL.md는 발견에서 빠지고
// 딸린 file은 읽히지 않으므로, skill을 늘린 변경이 여기서 멈춘다.
import { readdir, stat } from "node:fs/promises";
import process from "node:process";

import { SKILL_BODY_MAX_BYTES } from "../packages/core/lophn-agent/extensions/skills.ts";

const SKILLS = "packages/core/agent-workspaces/skills";

const root = process.argv[2] ?? ".";
const problems: string[] = [];
for (const entry of await readdir(`${root}/${SKILLS}`, {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  const folder = `${SKILLS}/${entry.name}`;
  for (const name of (await readdir(`${root}/${folder}`)).sort()) {
    if (!name.endsWith(".md")) continue;
    const bytes = (await stat(`${root}/${folder}/${name}`)).size;
    if (bytes > SKILL_BODY_MAX_BYTES) {
      problems.push(
        `${folder}/${name}: ${bytes} bytes, over ${SKILL_BODY_MAX_BYTES}. Move parts into bundled .md files.`,
      );
    }
  }
}
if (problems.length > 0) {
  for (const line of problems) console.error(line);
  process.exit(1);
}
console.log("내장 skill 크기 통과");
