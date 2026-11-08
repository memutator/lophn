// `lophn tab open|close`: lophn agent session이나 사람 token이 shell에 탭을 열고 자기가 연 탭을 닫는다. 사람 token은
// --url과 --preview 탭만 연다(core가 거절). core는 접수만 답한다(탭은 shell이 그 workspace를 보이는 창에서 연다).
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import {
  tabPlaceSchema,
  tabsClose,
  tabsOpen,
} from "../../protocol/lophn-agent/host-queue.ts";
import {
  type Workspace,
  WORKSPACE_KINDS,
} from "../../protocol/lophn-agent/workspaces.ts";
import { defineCommand } from "./types.ts";

// `{"project":"<prj id>"}`나 `{"app":"<app id>"}`다. `--workspace`와 env `LOPHN_WORKSPACE`(project 터미널에 shell이 넣는다)의 꼴이다.
const workspaceTextSchema = z.union([
  z.strictObject({ project: idSchema("prj") }),
  z.strictObject({ app: idSchema("app") }),
]);
export function parseWorkspaceText(text: string): Workspace | undefined {
  try {
    const found = workspaceTextSchema.safeParse(JSON.parse(text));
    if (!found.success) return undefined;
    return "project" in found.data
      ? { kind: "project", id: found.data.project }
      : { kind: "app", id: found.data.app };
  } catch {
    return undefined;
  }
}

const open = defineCommand({
  name: "tab.open",
  summary:
    "Open an agent session, a browser page or an app preview as a tab in the shell",
  description:
    "Open a tab in the shell: --session <ses> shows an open session of this workspace, --url <url> opens an http or https page in a browser tab, --preview <app> shows the running preview of an app (give exactly one). " +
    "--preview is for the session of that app's workspace and for the person; another app's workspace gets not_found, and it is conflict if no preview is running (run preview start first). " +
    'A person token opens only --url and --preview tabs. --url from a person goes to --workspace \'{"project":"<prj id>"}\' or \'{"app":"<app id>"}\', else env LOPHN_WORKSPACE (a project terminal sets it), else home; an agent session ignores it and uses its own workspace. ' +
    "An app has one preview tab: opening it again returns the same tab and you own it. " +
    "--session <ses> --tui opens a harness agent session (claude-code, codex, opencode) of a project workspace in a terminal tab through the CLI's own resume; " +
    "while it is open that session starts no turn and its inputs and calls wait in its queue, and they run after the TUI ends. " +
    "A tui is invalid_input for a session that is not a harness agent of a project workspace, and conflict if the session has not run yet, a turn is running, or it is already open in a tui. " +
    "--place beside|group|float hints where it goes (next to your own tab, into your tab's group, or floating); without it the tab goes right after your tab. " +
    "Returns the tab ID with status accepted: the shell opens it when it shows this workspace, and an opened tab never takes focus from what the person is looking at. " +
    "Close only tabs you opened (tab close). Look at and drive a browser or preview tab you opened with browser snapshot and browser act.",
  input: z.strictObject({
    session: idSchema("ses").optional(),
    tui: z.boolean().optional(),
    url: z.string().min(1).max(8192).optional(),
    preview: idSchema("app").optional(),
    place: tabPlaceSchema.optional(),
    workspace: z.string().min(1).max(200).optional(),
  }),
  effect: "write",
  routes: [tabsOpen],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const given = [input.session, input.url, input.preview].filter(
      (value) => value !== undefined,
    );
    if (given.length !== 1) {
      return err({
        code: "invalid_input",
        message: "give exactly one of --session, --url or --preview",
      });
    }
    if (input.tui === true && input.session === undefined) {
      return err({
        code: "invalid_input",
        message: "--tui needs --session",
      });
    }
    const explicit =
      input.workspace === undefined
        ? undefined
        : parseWorkspaceText(input.workspace);
    if (input.workspace !== undefined && explicit === undefined) {
      return err({
        code: "invalid_input",
        message: '--workspace is {"project":"<prj id>"} or {"app":"<app id>"}',
      });
    }
    const workspace = explicit ?? ctx.workspace ?? undefined;
    const opened = await ctx.core.read(tabsOpen, {
      target:
        input.preview !== undefined
          ? { preview: { app: input.preview } }
          : input.session === undefined
            ? { browser: { url: input.url! } }
            : input.tui === true
              ? { tui: input.session }
              : { session: input.session },
      ...(input.place === undefined ? {} : { place: input.place }),
      ...(workspace === undefined ? {} : { workspace }),
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
    "Close a tab you opened with tab open (a person token closes tabs a person token opened). You cannot close tabs other sessions or the person opened (forbidden). Returns accepted: the shell closes it when it shows this workspace.",
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
