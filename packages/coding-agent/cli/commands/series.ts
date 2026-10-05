// series command의 route 표다(T12·T14, cli#R20). series는 자리별 목록·규칙·정렬된
// 인스턴스·다음 key 제안만 읽는다. 새 series 등록 command는 없고 화면에서 한다.
import {
  cliSeriesListSchema,
  cliSeriesNextSchema,
  cliSeriesShowSchema,
} from "../../../contracts/coding-agent/mod.ts";
import {
  seriesGet,
  seriesList,
  seriesNext,
} from "../../../contracts/documents/mod.ts";
import type { CommandEntry } from "./types.ts";

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
