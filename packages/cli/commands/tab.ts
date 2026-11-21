// `lophn tab open|close|show`: lophn agent session이나 사람 token이 shell에 탭을 열고 자기가 연 탭을 닫는다. 사람 token은
// --url, --preview, --artifact, --phone 탭만 연다(core가 거절). core는 접수만 답한다(탭은 shell이 그 workspace를 보이는 창에서 연다). --url은 어느 창이든 page가 붙을 때까지 기다리고, 창이나 shell이 없으면 띄운다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { artifactNameSchema } from "../../protocol/projects/values.ts";
import {
  tabRelationSchema,
  tabsClose,
  tabsOpen,
  tabsShow,
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
    "Open an agent session, a browser page, an app preview, an artifact, a coding agent handoff or the app's screen on the person's phone as a tab",
  description:
    "Open a tab in the shell: --session <ses> shows an open session of this workspace, --url <url> opens an http or https page in a browser tab, --preview <app> shows the running preview of an app, --artifact <name> shows an artifact of this workspace's artifacts folder, --phone <app> shows the app's preview screen on the person's phone (give exactly one). " +
    "--artifact is for a project or app workspace (home has no artifacts: invalid_input); it is not_found until <artifacts folder>/<name>/index.html exists. An artifact has one such tab: opening it again returns the same tab and you own it. " +
    "--device <name> (with --preview) shows it in a device registered in Settings > Browser (size, pixel ratio, touch and user agent); an unknown name is not_found, and without --device it is desktop size. " +
    "--screen <key> (with --preview or --phone) opens that screen of the preview's release instead of the app's first tab screen; a key the release does not declare is not_found and the message lists its screens. " +
    'A phone screen (places ["phone"]) opens in the phone place inside a device frame: without --device lophn uses the person\'s main phone (its entry in Settings > Browser), and with neither it is conflict (pair a phone or register a device, then pass --device). ' +
    "This is a web emulation of the phone (react-native-web): input, keyboard, scrolling and fonts differ from the phone, so the person does the last check on the phone itself. " +
    "--phone <app> opens a phone tab: the preview screen of that app as it runs on the person's real phone, which you then read with browser snapshot and screenshot and drive with browser act (a phone tab supports only part of browser, see those commands). Only a session of that app's workspace and the person can open it (another app's workspace gets not_found). " +
    "The person must open that app's Preview from lophn in the lophn app on the phone and keep the app in front; otherwise it is unavailable and the message says why and what to do (ask the person; retrying before that does not help). If no preview is running it is conflict (run preview start first). An app has one phone tab: opening it again returns the same tab. " +
    "--screen <key> (with --phone) opens only while the phone shows that screen (else unavailable); without it the tab is the screen the phone shows now. --device does not apply (the phone is real). The phone's data is the preview's throwaway data. The desktop --preview --screen is a web emulation, not the phone. " +
    "Giving --screen or --device to a preview tab that is already open switches that same tab to the screen and device. " +
    "--preview is for the session of that app's workspace and for the person; another app's workspace gets not_found, and it is conflict if no preview is running (run preview start first). " +
    'A person token opens only --url, --preview, --artifact and --phone tabs. --url and --artifact from a person go to --workspace \'{"project":"<prj id>"}\' or \'{"app":"<app id>"}\', else env LOPHN_WORKSPACE (a project terminal sets it), else home; an agent session ignores it and uses its own workspace. ' +
    "An app has one preview tab: opening it again returns the same tab and you own it. " +
    "--session <ses> --tui opens a harness agent session (claude-code, codex, opencode) of a project workspace in a terminal tab through the CLI's own resume; " +
    "while it is open that session starts no turn and its inputs and calls wait in its queue, and they run after the TUI ends. " +
    "A tui is invalid_input for a session that is not a harness agent of a project workspace, and conflict if the session has not run yet, a turn is running, or it is already open in a tui. " +
    "--as peer|stage|aside|work|glance says what the tab is to you; you never choose where it goes, the shell does. " +
    "work: your own working tab, e.g. browsing for your task (folded; the person can expand it to watch or take control). " +
    "aside: something to show the person, e.g. a result page, artifact, preview or tui. " +
    "glance: a brief look you want the person to see now (expanded; it folds when the person clicks away). " +
    "peer: a colleague session splitting the same work as you. stage: a session that takes the next step or other work (peer and stage are for --session). " +
    "Without --as the shell picks a default per target: a --url page is work, everything else is aside; use --as aside when you open a page to show the person. " +
    "When the person must use your work tab (login, captcha, payment confirmation), run tab show <tab> together with ask. " +
    "--coding <harness> --handoff <text> opens a terminal tab in this project (at home, in the person's home folder) and starts that coding agent's TUI (a harness id the person marked as a favorite in Settings > Coding agents and that is detected on this computer) with <text> as its first prompt (give both; at most 64 KiB; project and home workspaces only, apps get invalid_input; any other harness is invalid_input and the message lists the usable ids, or says none can be opened so the person should favorite or check one in Settings > Coding agents). " +
    "Use it for work the person will pick up or debug together (a handoff). Write <text> like a note for an agent that knows nothing yet: the goal, what is known so far, the next steps. The text is saved to a file and only that file's path reaches the terminal. For one-off work that needs no person, send it headless with `lophn team spawn <handle>` instead. " +
    "Returns the tab ID with status accepted, and an opened tab never takes focus from what the person is looking at. " +
    "A --url page is created in a lophn window even when no window shows this workspace, and the call returns once the page exists (unavailable means no page was made and the message says what to do). If no lophn window is open, lophn opens one without taking focus; if the lophn app is not running, lophn starts it first (the wait is then up to 30 seconds, otherwise up to 10). That window stays open until the person closes it. The page stays alive while that window is open, at most 12 such pages per window; a page that is dropped or whose window closes takes its tab with it, so open it again. " +
    "On a Linux computer without a display, lophn starts a windowless browser that holds the pages instead; the same commands work, and the limit of 12 pages is for the whole computer, not per window. " +
    "Every other target opens when the shell shows this workspace. " +
    "Close only tabs you opened (tab close). Look at and drive a browser, preview, artifact or phone tab you opened with browser snapshot, browser screenshot and browser act.",
  input: z.strictObject({
    session: idSchema("ses").optional(),
    tui: z.boolean().optional(),
    coding: z.string().min(1).max(64).optional(),
    handoff: z.string().min(1).optional(),
    url: z.string().min(1).max(8192).optional(),
    preview: idSchema("app").optional(),
    phone: idSchema("app").optional(),
    artifact: artifactNameSchema.optional(),
    device: z.string().min(1).max(40).optional(),
    screen: z.string().min(1).max(64).optional(),
    as: tabRelationSchema.optional(),
    workspace: z.string().min(1).max(200).optional(),
  }),
  effect: "write",
  routes: [tabsOpen],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const given = [
      input.session,
      input.url,
      input.preview,
      input.artifact,
      input.coding,
      input.phone,
    ].filter((value) => value !== undefined);
    if (given.length !== 1) {
      return err({
        code: "invalid_input",
        message:
          "give exactly one of --session, --url, --preview, --artifact, --coding or --phone",
      });
    }
    if ((input.coding === undefined) !== (input.handoff === undefined)) {
      return err({
        code: "invalid_input",
        message: "--coding and --handoff go together",
      });
    }
    if (input.device !== undefined && input.preview === undefined) {
      return err({
        code: "invalid_input",
        message: "--device needs --preview (a phone tab is the real phone)",
      });
    }
    if (
      input.screen !== undefined &&
      input.preview === undefined &&
      input.phone === undefined
    ) {
      return err({
        code: "invalid_input",
        message: "--screen needs --preview or --phone",
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
          ? {
              preview: {
                app: input.preview,
                device: input.device ?? null,
                screen: input.screen ?? null,
              },
            }
          : input.phone !== undefined
            ? { phone: { app: input.phone, screen: input.screen ?? null } }
            : input.artifact !== undefined
              ? { artifact: { name: input.artifact } }
              : input.coding !== undefined
                ? { coding: { harness: input.coding, handoff: input.handoff! } }
                : input.session === undefined
                  ? { browser: { url: input.url! } }
                  : input.tui === true
                    ? { tui: input.session }
                    : { session: input.session },
      ...(input.as === undefined ? {} : { relation: input.as }),
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
    "Close a tab you opened with tab open (a person token closes tabs a person token opened). You cannot close tabs other sessions or the person opened (forbidden). Returns accepted: a --url page closes at once, any other tab closes when the shell shows this workspace.",
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

const show = defineCommand({
  name: "tab.show",
  summary: "Show a tab you opened to the person",
  description:
    "Expand a folded tab you opened (a --as work tab) in place so the person sees it, without moving their focus or layout. " +
    "Use it when you need the person's hands on your work tab (login, captcha, payment confirmation) and send `ask` with it saying what to do. " +
    "A tab that is not folded needs nothing. A phone tab is on the phone, so it is invalid_input (ask the person to look at the phone). You cannot show tabs other sessions or the person opened (forbidden); an unknown tab is not_found. Returns accepted: the shell shows it when it shows this workspace.",
  input: z.strictObject({ tab: idSchema("tab") }),
  positional: ["tab"],
  effect: "write",
  routes: [tabsShow],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const shown = await ctx.core.read(tabsShow, input);
    if (!shown.ok) return shown;
    return ok({
      summary: `tab ${shown.value.tab} accepted`,
      content: shown.value,
    });
  },
});

export const TAB_COMMANDS = [open, close, show];
