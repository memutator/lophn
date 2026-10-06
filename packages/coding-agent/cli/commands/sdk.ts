// SDK command의 route 표와 실행이다(T22, cli#R30). catalog·show·add는 MCP
// `lophn_sdk`과 같은 op·같은 소유 route·같은 흐름(connection/sdk-ops)이다: 같은
// credential·입력의 결과와 거절이 같다(cli#R1, connection#R6).
import {
  cliSdkAddSchema,
  cliSdkCatalogSchema,
  cliSdkShowSchema,
} from "../../../contracts/coding-agent/mod.ts";
import { SDK_OP_ROUTES } from "../../connection/mod.ts";
import type { CommandEntry } from "./types.ts";

export const SDK_COMMANDS: readonly CommandEntry[] = [
  {
    name: "sdk catalog",
    input: cliSdkCatalogSchema,
    monoRoute: SDK_OP_ROUTES.catalog,
  },
  {
    name: "sdk show",
    input: cliSdkShowSchema,
    monoRoute: SDK_OP_ROUTES.show,
  },
  {
    name: "sdk add",
    input: cliSdkAddSchema,
    monoRoute: SDK_OP_ROUTES.add,
  },
];
