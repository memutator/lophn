import { lstat } from "node:fs/promises";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  codingAgentsSetting,
  devicesSetting,
} from "../../../config/shell-settings.ts";
import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import type { ExtensionToolContent } from "../../../../protocol/extensions/manifest.ts";
import {
  BROWSER_WAIT_DEFAULT_MS,
  type BrowserAction,
  browserAct,
  browserActSchema,
  browserEvaluate,
  browserLogs,
  browserNavigate,
  browserRead,
  browserScreenshot,
  browserSnapshot,
  browserWait,
  hostDone,
  hostReport,
  hostTake,
  type HostWorkspace,
  tabsClose,
  tabsOpen,
  tabsShow,
} from "../../../../protocol/lophn-agent/mod.ts";
import {
  ARTIFACT_ENTRY,
  artifactsFolder,
} from "../../../../protocol/projects/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  createHostQueue,
  fileHandoffs,
  type HandoffFiles,
  type HarnessHold,
  type HostQueueService,
  SHELL_NOT_ATTACHED,
  type TabOwner,
} from "../../../host-queue/mod.ts";
import {
  type AgentSessionRow,
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { WiringFactory } from "./context.ts";

// core 메모리의 host queue를 shell main(host/*)과 agent·사람(tabs/*, browser/*)에 연다. 흐름은
// `protocol/lophn-agent/host-queue.ts`. 뒤 task가 쓰는 port는 `ctx.hostQueue`다.
const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// 부른 쪽이 shell이 떨어졌는지 보고 기한이 지났는지 보는 간격이다.
const WATCH_MS = 1000;

const hostWorkspaceOf = (
  workspace: ReturnType<typeof workspaceOf>,
): HostWorkspace => workspace ?? { kind: "home" };

type TabDeps = {
  queue: HostQueueService;
  sessionRow(session: string): AgentSessionRow | undefined;
  // 앱이 있는지. 없으면 null.
  app(app: string): Promise<Result<unknown | null>>;
  // 그 앱에서 지금 돌고 있는 preview. 없으면 null.
  preview(app: string): Promise<Result<unknown | null>>;
  // 그 workspace에 입구 `index.html`이 일반 file인 artifact가 있는가.
  artifactExists(
    workspace: { kind: "project" | "app"; id: string },
    name: string,
  ): Promise<boolean>;
  // 사람이 등록한 기기 이름들(설정 `shell.devices`).
  deviceNames(): readonly string[];
  harnessHold: Pick<HarnessHold, "open">;
  // 사람이 고른 coding agent 즐겨찾기 harness id(설정 `shell.coding_agents`).
  codingFavorites(): readonly string[];
  handoffs: HandoffFiles;
};

// agent는 자격의 session으로, 사람은 사람 token으로 부른다. 탭의 주인은 session, 사람 token은 모두 "person"이다.
export function createTabHandlers(deps: TabDeps) {
  const { queue, sessionRow } = deps;
  const agentSession = (who: AuthenticatedContext): Result<Id<"ses">> =>
    // agent 자격의 actor는 `agent:<session>`이다(lophn agent·harness 모두).
    who.actor.startsWith("agent:") && who.conditions.session !== undefined
      ? ok(who.conditions.session as Id<"ses">)
      : err({ code: "forbidden", message: "only an agent session" });
  const owner = (who: AuthenticatedContext): Result<TabOwner> =>
    who.actor === "user" ? ok("person") : agentSession(who);

  const open: MemoryHandler = async (who, body) => {
    const caller = owner(who);
    if (!caller.ok) return caller;
    const input = tabsOpen.input.parse(body);
    if ("preview" in input.target) {
      const { app } = input.target.preview;
      // 남의 앱은 있는지도 알리지 않는다.
      if (caller.value !== "person") {
        const row = sessionRow(caller.value);
        const here = row === undefined ? null : workspaceOf(row);
        if (here?.kind !== "app" || here.id !== app) {
          return err({ code: "not_found", message: "app not found" });
        }
      }
      const facts = await deps.app(app);
      if (!facts.ok) return facts;
      if (facts.value === null) {
        return err({ code: "not_found", message: "app not found" });
      }
      const { device } = input.target.preview;
      if (device !== null && !deps.deviceNames().includes(device)) {
        return err({
          code: "not_found",
          message: `no device named ${device}; register it in Settings > Browser`,
        });
      }
      const current = await deps.preview(app);
      if (!current.ok) return current;
      if (current.value === null) {
        return err({
          code: "conflict",
          message:
            "No preview is running for this app, so there is nothing to open. Run `lophn preview start`, then open the tab again.",
        });
      }
      const tab = queue.openTab({
        owner: caller.value,
        workspace: { kind: "app", id: app as Id<"app"> },
        target: input.target,
        relation: input.relation ?? null,
        source: caller.value === "person" ? null : caller.value,
      });
      return ok({ tab, status: "accepted" as const });
    }
    if ("artifact" in input.target) {
      // agent는 자기 session의 workspace, 사람 token은 입력의 workspace의 artifact만 연다.
      let where: HostWorkspace;
      if (caller.value === "person")
        where = input.workspace ?? { kind: "home" };
      else {
        const row = sessionRow(caller.value);
        if (row === undefined) {
          return err({ code: "not_found", message: "session not found" });
        }
        where = hostWorkspaceOf(workspaceOf(row));
      }
      if (where.kind === "home") {
        return err({
          code: "invalid_input",
          message: "artifacts belong to a project or an app; home has none",
        });
      }
      const { name } = input.target.artifact;
      if (!(await deps.artifactExists(where, name))) {
        return err({
          code: "not_found",
          message: `no artifact named ${name}; write <artifacts folder>/${name}/index.html first`,
        });
      }
      const tab = queue.openTab({
        owner: caller.value,
        workspace: where,
        target: input.target,
        relation: input.relation ?? null,
        source: caller.value === "person" ? null : caller.value,
      });
      return ok({ tab, status: "accepted" as const });
    }
    const person = caller.value === "person";
    if (person && !("browser" in input.target)) {
      return err({
        code: "invalid_input",
        message: "a person token opens --url, --preview and --artifact tabs",
      });
    }
    const from = person ? undefined : sessionRow(caller.value);
    if (!person && from === undefined) {
      return err({ code: "not_found", message: "session not found" });
    }
    let resume: { harness: string; external_session: string } | undefined;
    if ("coding" in input.target) {
      const here = workspaceOf(from!);
      if (here?.kind !== "project") {
        return err({
          code: "invalid_input",
          message:
            "coding tabs open in a project workspace; home and apps have no terminal",
        });
      }
      const { harness, handoff } = input.target.coding;
      const openable = deps
        .codingFavorites()
        .filter(
          (id) =>
            HARNESS_ADAPTERS[id as keyof typeof HARNESS_ADAPTERS]?.session
              .prompt,
        );
      if (!openable.includes(harness)) {
        return err({
          code: "invalid_input",
          message: `${harness} cannot open a handoff; use one of: ${openable.join(", ") || "(none; add a coding agent to the favorites in Settings)"}`,
        });
      }
      const tab = queue.newTabId();
      let file: string;
      try {
        file = await deps.handoffs.write(tab, handoff);
      } catch {
        return err({
          code: "unavailable",
          message:
            "The handoff file could not be written. Try once more; if it fails again, tell the person.",
        });
      }
      queue.openTab({
        owner: caller.value,
        workspace: here,
        target: { coding: { harness } },
        relation: input.relation ?? null,
        source: caller.value as Id<"ses">,
        handoff: { harness, file },
        tab,
      });
      return ok({ tab, status: "accepted" as const });
    }
    if ("session" in input.target || "tui" in input.target) {
      // 같은 workspace의 열린 session만 연다.
      const session =
        "session" in input.target ? input.target.session : input.target.tui;
      const target = sessionRow(session);
      const here = workspaceOf(from!);
      const there = target === undefined ? undefined : workspaceOf(target);
      if (
        target === undefined ||
        target.lifecycle !== "open" ||
        (there?.kind ?? "home") !== (here?.kind ?? "home") ||
        there?.id !== here?.id
      ) {
        return err({ code: "not_found", message: "session not found" });
      }
      if ("tui" in input.target) {
        const held = deps.harnessHold.open(input.target.tui as Id<"ses">);
        if (!held.ok) return held;
        resume = held.value;
      }
    } else if ("browser" in input.target) {
      const protocol = URL.canParse(input.target.browser.url)
        ? new URL(input.target.browser.url).protocol
        : "";
      if (protocol !== "http:" && protocol !== "https:") {
        return err({
          code: "invalid_input",
          message: "browser tabs open http or https urls only",
        });
      }
    }
    const opening = {
      owner: caller.value,
      // 사람 token은 입력의 workspace(없으면 home)에, agent는 자기 session의 workspace에 연다.
      workspace: person
        ? (input.workspace ?? { kind: "home" as const })
        : hostWorkspaceOf(workspaceOf(from!)),
      target: input.target,
      relation: input.relation ?? null,
      source: caller.value === "person" ? null : caller.value,
      ...(resume === undefined ? {} : { resume }),
    };
    if (!("browser" in input.target)) {
      const tab = queue.openTab(opening);
      return ok({ tab, status: "accepted" as const });
    }
    // browser 탭은 page가 생겼다는 shell의 답을 기다린다. 사람이 그 workspace를 띄우지 않아도 열린다.
    if (!queue.attached()) {
      return err({ code: "unavailable", message: SHELL_NOT_ATTACHED });
    }
    const sent = queue.openAndWait(opening);
    const opened = await settled(sent.id, sent.result);
    if (!opened.ok) {
      queue.close(sent.tab, caller.value);
      return opened;
    }
    return ok({ tab: sent.tab, status: "accepted" as const });
  };
  const close: MemoryHandler = (who, body) => {
    const caller = owner(who);
    if (!caller.ok) return caller;
    const input = tabsClose.input.parse(body);
    const closed = queue.close(input.tab as Id<"tab">, caller.value);
    return closed.ok
      ? ok({ tab: closed.value, status: "accepted" as const })
      : closed;
  };
  const show: MemoryHandler = (who, body) => {
    const caller = owner(who);
    if (!caller.ok) return caller;
    const input = tabsShow.input.parse(body);
    const shown = queue.show(input.tab as Id<"tab">, caller.value);
    return shown.ok
      ? ok({ tab: shown.value, status: "accepted" as const })
      : shown;
  };
  const read: MemoryHandler = (who, body) => {
    const caller = owner(who);
    if (!caller.ok) return caller;
    const input = browserRead.input.parse(body);
    return queue.read(input.tab as Id<"tab">, caller.value);
  };

  // 기다리는 browser 호출과 browser 탭 열기. core가 멈추기 전에 끝낸다.
  const inflight = new Set<() => void>();
  // 요청의 결과를 기다리며 기한과 shell이 떨어짐을 1초마다 본다.
  const settled = async (
    id: Id<"hrq">,
    result: Promise<Result<ExtensionToolContent[]>>,
  ) => {
    const abandon = () => queue.abandon(id);
    inflight.add(abandon);
    const watch = setInterval(() => {
      if (!queue.attached()) abandon();
      else queue.expire();
    }, WATCH_MS);
    try {
      return await result;
    } finally {
      clearInterval(watch);
      inflight.delete(abandon);
    }
  };
  // 주인을 대조한 뒤에만 요청을 넣는다.
  const call =
    (
      build: (
        input: never,
        view: "browser" | "preview" | "artifact",
      ) => Result<BrowserAction>,
      shape: (content: ExtensionToolContent[]) => Result<unknown>,
      route: { input: { parse(body: unknown): { tab: string } } },
    ): MemoryHandler =>
    async (who, body) => {
      const caller = owner(who);
      if (!caller.ok) return caller;
      const input = route.input.parse(body);
      const found = queue.browserTab(input.tab as Id<"tab">, caller.value);
      if (!found.ok) return found;
      const action = build(input as never, found.value.view);
      if (!action.ok) return action;
      if (!queue.attached()) {
        return err({ code: "unavailable", message: SHELL_NOT_ATTACHED });
      }
      const sent = queue.callBrowser({
        tab: input.tab as Id<"tab">,
        view: found.value.view,
        action: action.value,
      });
      const result = await settled(sent.id, sent.result);
      return result.ok ? shape(result.value) : result;
    };

  const textOf = (content: ExtensionToolContent[]): Result<string> => {
    const first = content[0];
    return first?.type === "text"
      ? ok(first.text)
      : err({ code: "internal", message: "the browser result has no text" });
  };
  // shell이 JSON 글로 답하는 결과(url·title, evaluate)를 편다.
  const jsonOf = (content: ExtensionToolContent[]): Result<unknown> => {
    const text = textOf(content);
    if (!text.ok) return text;
    try {
      return ok(JSON.parse(text.value));
    } catch {
      return err({
        code: "internal",
        message: "the browser result is not JSON",
      });
    }
  };
  const invalid = (message: string) =>
    err({ code: "invalid_input" as const, message });
  const snapshot = call(
    () => ok({ kind: "snapshot" }),
    (content) => {
      const text = textOf(content);
      return text.ok ? ok({ snapshot: text.value }) : text;
    },
    browserSnapshot,
  );
  const act = call(
    (input: Record<string, unknown>) => {
      const { tab: _tab, ...fields } = input;
      const parsed = browserActSchema.safeParse(fields);
      return parsed.success
        ? ok({ kind: "act", act: parsed.data })
        : invalid(`invalid act: ${parsed.error.issues[0]?.message ?? ""}`);
    },
    jsonOf,
    browserAct,
  );
  const navigate = call(
    (input: { url: string }, view) => {
      if (view !== "browser") {
        return invalid(
          `a ${view} tab shows one page; navigate is for browser tabs`,
        );
      }
      const protocol = URL.canParse(input.url)
        ? new URL(input.url).protocol
        : "";
      return input.url === "about:blank" ||
        protocol === "http:" ||
        protocol === "https:"
        ? ok({ kind: "navigate", url: input.url })
        : invalid("navigate opens http or https urls and about:blank only");
    },
    jsonOf,
    browserNavigate,
  );
  const screenshot = call(
    () => ok({ kind: "screenshot" }),
    (content) => {
      const image = content.find((block) => block.type === "image");
      return image?.type === "image"
        ? ok({ image: { media_type: "image/png", data_base64: image.data } })
        : err({ code: "internal", message: "the browser result has no image" });
    },
    browserScreenshot,
  );
  const evaluate = call(
    (input: { expression: string }) =>
      ok({ kind: "evaluate", expression: input.expression }),
    jsonOf,
    browserEvaluate,
  );
  const logs = call(
    () => ok({ kind: "logs" }),
    (content) => {
      const text = textOf(content);
      return text.ok ? ok({ logs: text.value }) : text;
    },
    browserLogs,
  );
  const wait = call(
    (input: { text?: string; url?: string; timeout_ms?: number }) =>
      (input.text === undefined) === (input.url === undefined)
        ? invalid("give exactly one of text or url")
        : ok({
            kind: "wait",
            ...(input.text === undefined ? {} : { text: input.text }),
            ...(input.url === undefined ? {} : { url: input.url }),
            timeout_ms: input.timeout_ms ?? BROWSER_WAIT_DEFAULT_MS,
          }),
    jsonOf,
    browserWait,
  );

  return {
    open,
    close,
    show,
    read,
    snapshot,
    act,
    navigate,
    screenshot,
    evaluate,
    logs,
    wait,
    abandonCalls() {
      for (const abandon of [...inflight]) abandon();
    },
  };
}

export const hostQueueWiring: WiringFactory = () => {
  let queue: HostQueueService | undefined;
  let tabs: ReturnType<typeof createTabHandlers> | undefined;
  return {
    name: "host-queue",
    build(ctx) {
      const made = createHostQueue({
        clock: ctx.clock,
        ids: createIdSource({ clock: ctx.clock, random: ctx.random }),
      });
      queue = made;
      ctx.provide("hostQueue", made);

      // shell main은 사람 token으로 부른다.
      const shell = (who: AuthenticatedContext): Result<void> =>
        who.actor === "user"
          ? ok(undefined)
          : err({ code: "forbidden", message: "only the shell host" });
      const sessionRow = (session: string) => {
        const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
          loadSession(lookup, session),
        );
        return found.ok ? found.value : undefined;
      };
      const handlers = createTabHandlers({
        queue: made,
        sessionRow,
        app: (app) => ctx.appsControl.facts.app(app),
        preview: (app) => ctx.appsControl.previews.current(app),
        artifactExists: async (workspace, name) => {
          const dir = `${artifactsFolder(ctx.root.path, workspace)}/${name}`;
          try {
            // lstat이라 symlink 폴더와 symlink 입구는 artifact가 아니다(목록과 같은 규칙).
            return (
              (await lstat(dir)).isDirectory() &&
              (await lstat(`${dir}/${ARTIFACT_ENTRY}`)).isFile()
            );
          } catch {
            return false;
          }
        },
        deviceNames: () =>
          (ctx.settings.get(devicesSetting) ?? []).map((d) => d.name),
        harnessHold: ctx.harnessHold,
        codingFavorites: () =>
          ctx.settings.get(codingAgentsSetting)?.favorites ?? [],
        handoffs: fileHandoffs(ctx.root.path),
      });
      tabs = handlers;

      const take: MemoryHandler = async (who, body) => {
        const allowed = shell(who);
        if (!allowed.ok) return allowed;
        const input = hostTake.input.parse(body);
        ctx.harnessHold.heartbeat(input.tui as Id<"ses">[]);
        return ok({ request: await made.wait(input.workspaces) });
      };
      const done: MemoryHandler = (who, body) => {
        const allowed = shell(who);
        if (!allowed.ok) return allowed;
        const input = hostDone.input.parse(body);
        made.done(input.id as Id<"hrq">, input.result, input.output);
        return ok({});
      };
      const report: MemoryHandler = (who, body) => {
        const allowed = shell(who);
        if (!allowed.ok) return allowed;
        const input = hostReport.input.parse(body);
        made.report(input.tab as Id<"tab">, input.state);
        return ok({});
      };

      return ok({
        memory: [
          [key(hostTake), take],
          [key(hostDone), done],
          [key(hostReport), report],
          [key(tabsOpen), handlers.open],
          [key(tabsClose), handlers.close],
          [key(tabsShow), handlers.show],
          [key(browserRead), handlers.read],
          [key(browserSnapshot), handlers.snapshot],
          [key(browserAct), handlers.act],
          [key(browserNavigate), handlers.navigate],
          [key(browserScreenshot), handlers.screenshot],
          [key(browserEvaluate), handlers.evaluate],
          [key(browserLogs), handlers.logs],
          [key(browserWait), handlers.wait],
        ],
      });
    },
    // 기다리는 take와 browser 호출은 서버가 멈추기 전에 끝낸다.
    closeIntake() {
      queue?.releaseTakers();
      tabs?.abandonCalls();
    },
  };
};
