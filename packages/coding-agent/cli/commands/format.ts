// format·series command의 route 표다(T12, cli#R15·R20). format은 설치된
// 선언과(bytes 검사는 format worker 요청) series는 규칙·다음 key 제안만 읽는다.
// series 생성 command는 없다(cli#R20). save 접수는 T14 자리다.
import {
  cliFormatListSchema,
  cliFormatShowSchema,
  cliFormatValidateSchema,
  cliSeriesListSchema,
  cliSeriesNextSchema,
  cliSeriesShowSchema,
} from "../../../contracts/coding-agent/mod.ts";
import {
  formatGet,
  formatList,
  formatValidate,
  seriesGet,
  seriesList,
  seriesNext,
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

export const SERIES_COMMANDS: readonly CommandEntry[] = [
  {
    name: "series list",
    input: cliSeriesListSchema,
    monoRoute: seriesList,
  },
  {
    name: "series show",
    input: cliSeriesShowSchema,
    monoRoute: seriesGet,
  },
  {
    name: "series next",
    input: cliSeriesNextSchema,
    monoRoute: seriesNext,
  },
];
