// index·search command의 route 표다(T12, cli#R11). 소유 route는 contracts의
// documents table 그대로다. MCP가 없는 세션에서도 같은 route로 core에 닿는다
// (cli#R1). 등록·보관·연결 command는 화면의 몫이며 표에 없다(cli#R22).
import {
  cliIndexSchema,
  cliSearchSchema,
} from "../../../contracts/coding-agent/mod.ts";
import {
  outlineContext,
  outlineDocument,
  outlinePlace,
  outlineRoot,
  searchQuery,
  searchStatus,
} from "../../../contracts/documents/mod.ts";
import type { Route } from "../../../contracts/platform/mod.ts";
import type { CommandEntry } from "./types.ts";

export const INDEX_COMMANDS: readonly CommandEntry[] = [
  {
    name: "index",
    input: cliIndexSchema,
    // index는 op마다 소유 route가 다르다. op를 푼 뒤 route를 고른다.
    opRoutes: {
      root: outlineRoot,
      place: outlinePlace,
      context: outlineContext,
      document: outlineDocument,
      section: outlineDocument,
      status: searchStatus,
    },
  },
  {
    name: "search",
    input: cliSearchSchema,
    // search의 query는 owner worker route 하나다.
    opRoutes: { query: searchQuery },
  },
];
