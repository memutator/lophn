import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  browserRead,
  hostDone,
  hostReport,
  hostTake,
  type HostWorkspace,
  tabsClose,
  tabsOpen,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  createHostQueue,
  type HarnessHold,
  type HostQueueService,
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

// core 메모리의 host queue를 shell main(host/*)과 agent(tabs/*, browser/read)에 연다. 흐름은
// `protocol/lophn-agent/host-queue.ts`. 뒤 task가 쓰는 port는 `ctx.hostQueue`다.
const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

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
  harnessHold: Pick<HarnessHold, "open">;
};

// agent는 자격의 session으로, 사람은 사람 token으로 부른다. 탭의 주인은 session, 사람 token은 모두 "person"이다.
export function createTabHandlers(deps: TabDeps) {
  const { queue, sessionRow } = deps;
  const agentSession = (who: AuthenticatedContext): Result<Id<"ses">> =>
    who.actor === "agent" && who.conditions.session !== undefined
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
      const current = await deps.preview(app);
      if (!current.ok) return current;
      if (current.value === null) {
        return err({
          code: "conflict",
          message: "no preview is running; run preview start first",
        });
      }
      const tab = queue.openTab({
        owner: caller.value,
        workspace: { kind: "app", id: app as Id<"app"> },
        target: input.target,
        place: input.place ?? null,
        source: caller.value === "person" ? null : caller.value,
      });
      return ok({ tab, status: "accepted" as const });
    }
    if (caller.value === "person") {
      return err({
        code: "invalid_input",
        message: "a person token opens --preview tabs",
      });
    }
    const from = sessionRow(caller.value);
    if (from === undefined) {
      return err({ code: "not_found", message: "session not found" });
    }
    let resume: { harness: string; external_session: string } | undefined;
    if ("session" in input.target || "tui" in input.target) {
      // 같은 workspace의 열린 session만 연다.
      const session =
        "session" in input.target ? input.target.session : input.target.tui;
      const target = sessionRow(session);
      const here = workspaceOf(from);
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
    } else {
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
    const tab = queue.openTab({
      owner: caller.value,
      workspace: hostWorkspaceOf(workspaceOf(from)),
      target: input.target,
      place: input.place ?? null,
      source: caller.value,
      ...(resume === undefined ? {} : { resume }),
    });
    return ok({ tab, status: "accepted" as const });
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
  const read: MemoryHandler = (who, body) => {
    const caller = agentSession(who);
    if (!caller.ok) return caller;
    const input = browserRead.input.parse(body);
    return queue.read(input.tab as Id<"tab">, caller.value);
  };

  return { open, close, read };
}

export const hostQueueWiring: WiringFactory = () => ({
  name: "host-queue",
  build(ctx) {
    const queue = createHostQueue({
      clock: ctx.clock,
      ids: createIdSource({ clock: ctx.clock, random: ctx.random }),
    });
    ctx.provide("hostQueue", queue);

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
    const { open, close, read } = createTabHandlers({
      queue,
      sessionRow,
      app: (app) => ctx.appsControl.facts.app(app),
      preview: (app) => ctx.appsControl.previews.current(app),
      harnessHold: ctx.harnessHold,
    });

    const take: MemoryHandler = (who, body) => {
      const allowed = shell(who);
      if (!allowed.ok) return allowed;
      const input = hostTake.input.parse(body);
      ctx.harnessHold.heartbeat(input.tui as Id<"ses">[]);
      return ok({ request: queue.take(input.workspaces) });
    };
    const done: MemoryHandler = (who, body) => {
      const allowed = shell(who);
      if (!allowed.ok) return allowed;
      const input = hostDone.input.parse(body);
      queue.done(input.id as Id<"hrq">, input.result, input.output);
      return ok({});
    };
    const report: MemoryHandler = (who, body) => {
      const allowed = shell(who);
      if (!allowed.ok) return allowed;
      const input = hostReport.input.parse(body);
      queue.report(input.tab as Id<"tab">, input.state);
      return ok({});
    };

    return ok({
      memory: [
        [key(hostTake), take],
        [key(hostDone), done],
        [key(hostReport), report],
        [key(tabsOpen), open],
        [key(tabsClose), close],
        [key(browserRead), read],
      ],
    });
  },
});
