// format command의 route 표다(T12·T14, cli#R15). format은 설치된 선언을 읽고
// bytes 검사는 format worker 요청이다.
import {
  cliFormatListSchema,
  cliFormatShowSchema,
  cliFormatValidateSchema,
} from "../../../contracts/coding-agent/mod.ts";
import {
  formatGet,
  formatList,
  formatValidate,
} from "../../../contracts/documents/mod.ts";
import type { CommandEntry } from "./types.ts";

export const FORMAT_COMMANDS: readonly CommandEntry[] = [
  {
    name: "format list",
    input: cliFormatListSchema,
    monoRoute: formatList,
  },
  {
    name: "format show",
    input: cliFormatShowSchema,
    monoRoute: formatGet,
  },
  {
    name: "format validate",
    input: cliFormatValidateSchema,
    monoRoute: formatValidate,
  },
];
