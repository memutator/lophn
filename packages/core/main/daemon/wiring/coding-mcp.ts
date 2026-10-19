import { err, ok } from "../../../../base/mod.ts";
import { CODING_MCP_OPERATION } from "../../../../protocol/coding-agent/mod.ts";
import { createCodingMcpTools } from "../../../apps/mcp/mod.ts";
import { loadActiveBlueprint } from "../../../apps/releases/store.ts";
import { createMcpEndpoint } from "../../../server/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

// coding agent의 MCP endpoint(`POST /mcp`). apps wiring 뒤, server wiring 앞에 둔다.
// 호출 길과 preview service는 부를 때 읽는다.
export const codingMcpWiring: WiringFactory = () => ({
  name: "coding-mcp",
  operations: () => [
    { name: CODING_MCP_OPERATION, actors: ["coding_agent"], kind: "command" },
  ],
  build(ctx) {
    const tools = createCodingMcpTools({
      authorize(auth) {
        const app = auth.conditions.app;
        if (app === undefined) {
          return err({ code: "forbidden", message: "no app in the token" });
        }
        const allowed = ctx.registry.authorize(auth, CODING_MCP_OPERATION, {
          app,
        });
        return allowed.ok ? ok({ app }) : allowed;
      },
      previews: { current: (app) => ctx.appsControl.previews.current(app) },
      activeTools(app) {
        const opened = openConnection(ctx.ledgerPath);
        if (!opened.ok) return opened;
        try {
          const loaded = loadActiveBlueprint(opened.value.sql, app);
          return loaded.ok ? ok(loaded.value?.blueprint.tools ?? []) : loaded;
        } finally {
          opened.value.close();
        }
      },
      calls: { call: (input, auth) => ctx.appCallPath.call(input, auth) },
    });
    return ok({ mcp: createMcpEndpoint(tools) });
  },
});
