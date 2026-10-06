// `lophn skills list|install` command 표다(cli#R10, guides#R4·R5). 목록은 배포 skill의 이름·설명·version을
// 읽고 설치는 사람이 고른 catalog target에 한다. 배포 skill 원본은 guides의 일이라 원본이 설치 묶음에
// 없으면 실행은 성공으로 꾸미지 않고 unavailable이다(dispatch).
import {
  cliSkillsInstallSchema,
  cliSkillsListSchema,
} from "../../../contracts/coding-agent/mod.ts";
import type { CommandEntry } from "./types.ts";

export const SKILLS_COMMANDS: readonly CommandEntry[] = [
  { name: "skills list", input: cliSkillsListSchema },
  { name: "skills install", input: cliSkillsInstallSchema },
];
