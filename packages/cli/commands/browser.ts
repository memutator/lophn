// `lophn browser read`: lophn agent가 자기가 연 browser 탭의 url·title·loading을 읽는다. page 내용·screenshot·조작은
// 없다. route의 actor가 agent뿐이라 binary(사람)에서는 forbidden이다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { browserRead } from "../../protocol/lophn-agent/host-queue.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { defineCommand } from "./types.ts";

const read = defineCommand({
  name: "browser.read",
  summary: "Read the url, title and loading state of a browser tab you opened",
  description:
    "Read url, title and loading of a browser tab you opened with tab open --url. It returns only these three (no page content). " +
    "not_found means the tab is not yours, is not a browser tab, or has not reported its state yet (the shell opens it only when it shows this workspace).",
  input: z.strictObject({ tab: idSchema("tab") }),
  positional: ["tab"],
  effect: "read",
  routes: [browserRead],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const state = await ctx.core.read(browserRead, input);
    if (!state.ok) return state;
    return ok({
      summary: `${state.value.url}${state.value.loading ? " (loading)" : ""}`,
      content: state.value,
    });
  },
});

export const BROWSER_COMMANDS = [read];
