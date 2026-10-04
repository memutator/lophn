// project command의 route 표다(T12, cli#R22). 등록된 project의 list·show,
// 현재 작업 위치 일치만 읽는다. 등록·보관·context 연결은 화면의 몫이며 표에
// 없다(cli#R22). current는 caller cwd를 받지 않는다. core가 connection
// credential의 고정 근거로 읽는다(documents/project-routes).
import {
  cliProjectCurrentSchema,
  cliProjectListSchema,
  cliProjectShowSchema,
} from "../../../contracts/coding-agent/mod.ts";
import {
  projectGet,
  projectList,
  projectResolveCwd,
} from "../../../contracts/documents/mod.ts";
import type { CommandEntry } from "./types.ts";

export const PROJECT_COMMANDS: readonly CommandEntry[] = [
  {
    name: "project list",
    input: cliProjectListSchema,
    monoRoute: projectList,
  },
  {
    name: "project show",
    input: cliProjectShowSchema,
    monoRoute: projectGet,
  },
  {
    name: "project current",
    input: cliProjectCurrentSchema,
    monoRoute: projectResolveCwd,
  },
];
