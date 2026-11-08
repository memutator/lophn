// `lophn tab open|close`: lophn agent가 shell에 탭을 열고 자기가 연 탭을 닫는다. 두 route는 actor가 agent뿐이라
// binary(사람)에서는 forbidden이다. core는 접수만 답한다(탭은 shell이 그 workspace를 보이는 창에서 연다).
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import {
  tabPlaceSchema,
  tabsClose,
  tabsOpen,
} from "../../protocol/lophn-agent/host-queue.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { defineCommand } from "./types.ts";

const open = defineCommand({
  name: "tab.open",
  summary: "Open an agent session or a browser page as a tab in the shell",
  description:
    "Open a tab in the shell: --session <ses> shows an open session of this workspace, --url <url> opens an http or https page in a browser tab (give exactly one). " +
    "--session <ses> --tui opens a harness agent session (claude-code, codex, opencode) of a project workspace in a terminal tab through the CLI's own resume; " +
    "while it is open that session starts no turn and its inputs and calls wait in its queue, and they run after the TUI ends. " +
    "A tui is invalid_input for a session that is not a harness agent of a project workspace, and conflict if the session has not run yet, a turn is running, or it is already open in a tui. " +
    "--place beside|group|float hints where it goes (next to your own tab, into your tab's group, or floating); without it the tab goes right after your tab. " +
    "Returns the tab ID with status accepted: the shell opens it when it shows this workspace, and an opened tab never takes focus from what the person is looking at. " +
    "Close only tabs you opened (tab close). Read a browser tab with browser read.",
  input: z.strictObject({
    session: idSchema("ses").optional(),
    tui: z.boolean().optional(),
    url: z.string().min(1).max(8192).optional(),
    place: tabPlaceSchema.optional(),
  }),
  effect: "write",
  routes: [tabsOpen],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    if ((input.session === undefined) === (input.url === undefined)) {
      return err({
        code: "invalid_input",
        message: "give exactly one of --session or --url",
      });
    }
    if (input.tui === true && input.session === undefined) {
      return err({
        code: "invalid_input",
        message: "--tui needs --session",
      });
    }
    const opened = await ctx.core.read(tabsOpen, {
      target:
        input.session === undefined
          ? { browser: { url: input.url! } }
          : input.tui === true
            ? { tui: input.session }
            : { session: input.session },
      ...(input.place === undefined ? {} : { place: input.place }),
    });
    if (!opened.ok) return opened;
    return ok({
      summary: `tab ${opened.value.tab} accepted`,
      content: opened.value,
    });
  },
});

const close = defineCommand({
  name: "tab.close",
  summary: "Close a tab you opened",
  description:
    "Close a tab you opened with tab open. You cannot close tabs other sessions or the person opened (forbidden). Returns accepted: the shell closes it when it shows this workspace.",
  input: z.strictObject({ tab: idSchema("tab") }),
  positional: ["tab"],
  effect: "write",
  routes: [tabsClose],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const closed = await ctx.core.read(tabsClose, input);
    if (!closed.ok) return closed;
    return ok({
      summary: `tab ${closed.value.tab} accepted`,
      content: closed.value,
    });
  },
});

export const TAB_COMMANDS = [open, close];
