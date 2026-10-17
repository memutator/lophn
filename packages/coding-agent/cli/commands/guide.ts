// `lophn guide <name>`: 전역에 놓인 얇은 skill이 가리키는 절차 본문이다. 배포 skill 원본을 그대로 내주고
// core를 부르지 않는 local 명령이다.
import { ok } from "../../../base/mod.ts";
import { loadSkills } from "../../guides/mod.ts";
import { type CommandEntry, entryOf } from "./types.ts";

export const GUIDE_COMMANDS: readonly CommandEntry[] = [
  entryOf("guide", "skill의 절차 본문을 읽는다", {
    positional: ["name"],
    run: async (input) => {
      const skills = await loadSkills();
      if (!skills.ok) return skills;
      const skill = skills.value.find((one) => one.name === input.name);
      if (skill === undefined) return ok("");
      const main = skill.files.find((file) => file.path === "SKILL.md");
      const rest = skill.files.filter((file) => file !== main).sort((a, b) =>
        a.path < b.path ? -1 : 1
      );
      return ok(
        [
          main?.content ?? "",
          ...rest.map((file) => `## ${file.path}\n\n${file.content}`),
        ].join("\n\n"),
      );
    },
  }),
];
