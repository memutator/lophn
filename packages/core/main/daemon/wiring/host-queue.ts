import { lstat } from "node:fs/promises";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import { describeThrown } from "../../../../base/telemetry/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  codingAgentsSetting,
  devicesSetting,
} from "../../../config/shell-settings.ts";
import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import { handoffCommand } from "../../../../protocol/coding-agent/handoff.ts";
import type { HarnessId } from "../../../../protocol/coding-agent/harnesses.ts";
import {
  HOME_TERMINAL_PROJECT,
  type TerminalProject,
} from "../../../../protocol/coding-agent/terminals.ts";
import type { Login } from "../../../../protocol/secrets/mod.ts";
import { appTools } from "../../../../protocol/apps/declaration/read.ts";
import { devicesList } from "../../../../protocol/remote/routes.ts";
import type { HostToolContent } from "../../../../protocol/lophn-agent/host-queue.ts";
import { publishStateChanged } from "../../../../protocol/events/changes.ts";
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
  type HostWorkspace,
  pageViewControl,
  pageViewInput,
  pageViewList,
  pageViewOpen,
  pageViewSnapshot,
  pageViewWatch,
  tabsClose,
  tabsGive,
  tabsHand,
  tabsList,
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
  SHELL_LOST,
  SHELL_NOT_ATTACHED,
  SHELL_START_FAILED,
  type TabOwner,
  withinTeam,
} from "../../../host-queue/mod.ts";
import {
  createPhoneDriver,
  PHONE_BY_PERSON,
  type PhoneDriveDeps,
  type PhoneDriver,
  type PreviewView,
} from "../../../host-queue/phone.ts";
import type { PhoneTab } from "../../../host-queue/queue.ts";
import {
  createPageView,
  type PageView,
} from "../../../host-queue/page-view.ts";
import {
  type AgentSessionRow,
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import { workspaceDepsOf } from "../../../lophn-agent/workspaces/mod.ts";
import { PHONE_TAB_TEXT } from "../../../../protocol/phone/drive.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import { createHostLink, type MemoryHandler } from "../../../server/mod.ts";
import { createLoginStore, loginProfileOn } from "../../../secrets/mod.ts";
import { agentBrowserProfile } from "./browser-profile.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";

// core 메모리의 host queue를 shell main(`/host-link` 연결)과 agent·사람(tabs/*, browser/*)에 연다. 흐름은
// `protocol/lophn-agent/host-queue.ts`. 뒤 task가 쓰는 port는 `ctx.hostQueue`와 `ctx.hostLink`다.
const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

const BROWSER_RESULT = {
  concern: "browser/result",
  revision: "1",
  scope: "browser",
};

// 부른 쪽이 shell이 떨어졌는지 보고 기한이 지났는지 보는 간격이다.
const WATCH_MS = 1000;
// 멀리서 보는 lease 기한(30초)을 이 주기로 본다.
const EXPIRE_MS = 5000;

// 기준 폰(`devices`의 primary)을 찾는 core 안 machine 자격이다. 기동 때 ledger에 기록한다.
const PRINCIPAL = "machine:host-queue";
const CONTEXT: AuthenticatedContext = {
  principal: PRINCIPAL,
  actor: "machine",
  scope: { operations: [devicesList.name], targets: {} },
  conditions: {},
  credential_ref: PRINCIPAL,
};

const PHONE_MISSING =
  "no phone is registered: pair a phone or register a device in Settings > Browser, then pass --device";

const hostWorkspaceOf = (
  workspace: ReturnType<typeof workspaceOf>,
): HostWorkspace => workspace ?? { kind: "home" };

type TabDeps = {
  queue: HostQueueService;
  sessionRow(session: string): AgentSessionRow | undefined;
  // 앱이 있는지. 없으면 null.
  app(app: string): Promise<Result<unknown | null>>;
  // 그 앱에서 지금 돌고 있는 preview와 그 release. 없으면 null.
  preview(app: string): Promise<Result<{ release: string | null } | null>>;
  // 그 release 선언의 화면(`apps/tools`의 읽기). 부른 쪽의 자격으로 읽는다.
  screens(
    who: AuthenticatedContext,
    app: string,
    release: string,
  ): Promise<Result<readonly { key: string; places: readonly string[] }[]>>;
  // 기준 폰에 대응하는 `shell.devices` 항목(`device`가 그 기기 id)의 이름. 기준 폰이나 그 항목이 없으면 null.
  primaryDeviceName(): Promise<Result<string | null>>;
  // 그 workspace에 입구 `index.html`이 일반 file인 artifact가 있는가.
  artifactExists(
    workspace: { kind: "project" | "app"; id: string },
    name: string,
  ): Promise<boolean>;
  // 사람이 등록한 기기 이름들(설정 `shell.devices`).
  deviceNames(): readonly string[];
  harnessHold: Pick<HarnessHold, "open">;
  // 사람이 고른 coding agent 즐겨찾기 harness id와 바꾼 실행 명령어(설정 `shell.coding_agents`).
  codingAgents(): {
    favorites: readonly string[];
    commands: Readonly<Record<string, string>>;
  };
  // 이 컴퓨터에서 감지된 harness id(Settings › Coding agents의 마지막 감지 결과).
  codingDetected(): Promise<readonly string[]>;
  handoffs: HandoffFiles;
  // project에 터미널을 연다(`ctx.terminals.open`). command는 첫 prompt 뒤 치고, resume은 그 harness의 resume 명령을 친다.
  openTerminal(input: {
    project: TerminalProject;
    command?: string;
    resume?: { harness: string; external_session: string };
  }): Promise<Result<string>>;
  // `tui`로 연 터미널이 그 ledger session을 쥔다. 그 harness가 foreground에 보인 뒤 떠나면 푼다.
  holdTui(terminal: string, session: Id<"ses">): void;
  // shell(앱)을 띄운다. 시작이 실패하면 받은 `failed`를 부른다. 없으면 shell이 없을 때 browser 탭 열기는 SHELL_NOT_ATTACHED로
  // 끝난다(시험, 사람이 띄우지 않은 core, 띄울 길을 모르는 core).
  launchShell?: (failed: () => void) => void;
  // fill_login이 가리키는 login의 metadata(값은 없다). 없으면 undefined, 못 읽으면 오류.
  login(id: string): Promise<Result<Login | undefined>>;
  // session의 agent 정의가 고른 browser profile(`wiring/browser-profile.ts`). 없거나 지운 profile이면 null(기본)이고,
  // 정의를 읽지 못하면 오류다.
  browserProfile(session: Id<"ses">): Result<Id<"bpf"> | null>;
  // browser 결과가 caller에 가기 전에 거치는 redaction. 알려진 값을 아직 다 모르면 null이다.
  redact(text: string): string | null;
  // 그 앱의 기기가 연 preview view(`apps/views`). phone 탭이 다룰 화면을 고른다.
  previewViews(app: string): readonly PreviewView[];
  // 폰 link(`ctx.phoneLink.call`).
  phoneCall: PhoneDriveDeps["call"];
  // session의 agent가 보이는 이름. 폰의 "is driving" 줄에 간다. 못 읽으면 null.
  agentName(session: string): string | null;
  // agent가 browser 탭을 폈다(`TabShowRequested`). 그 session을 다른 컴퓨터에서 보는 창이 원격 보기 탭을 연다.
  shown(session: Id<"ses">, tab: Id<"tab">): void;
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

  // preview·phone 탭은 그 앱 workspace의 session과 사람만 연다. 남의 앱은 있는지도 알리지 않는다.
  const ownApp = async (
    caller: TabOwner,
    app: string,
  ): Promise<Result<void>> => {
    if (caller !== "person") {
      const row = sessionRow(caller);
      const here = row === undefined ? null : workspaceOf(row);
      if (here?.kind !== "app" || here.id !== app) {
        return err({ code: "not_found", message: "app not found" });
      }
    }
    const facts = await deps.app(app);
    if (!facts.ok) return facts;
    return facts.value === null
      ? err({ code: "not_found", message: "app not found" })
      : ok(undefined);
  };
  const running = async (
    app: string,
  ): Promise<Result<{ release: string | null }>> => {
    const current = await deps.preview(app);
    if (!current.ok) return current;
    return current.value === null
      ? err({
          code: "conflict",
          message:
            "No preview is running for this app, so there is nothing to open. Run `lophn preview start`, then open the tab again.",
        })
      : ok(current.value);
  };
  const phone = createPhoneDriver({
    previewViews: deps.previewViews,
    call: deps.phoneCall,
    redact: deps.redact,
  });
  const byOf = (caller: TabOwner) =>
    caller === "person"
      ? PHONE_BY_PERSON
      : (deps.agentName(caller) ?? "An agent").slice(0, 80);

  const open: MemoryHandler = async (who, body) => {
    const caller = owner(who);
    if (!caller.ok) return caller;
    const input = tabsOpen.input.parse(body);
    if ("phone" in input.target) {
      const { app, screen } = input.target.phone;
      const own = await ownApp(caller.value, app);
      if (!own.ok) return own;
      const current = await running(app);
      if (!current.ok) return current;
      // 폰이 그 preview를 보이지 않으면 열지 않는다. 탭은 기기·view를 쥐지 않고 부를 때마다 다시 고른다.
      const showing = deps
        .previewViews(app)
        .some((view) => screen === null || view.screen === screen);
      if (!showing) {
        return err({ code: "unavailable", message: PHONE_TAB_TEXT.notShowing });
      }
      const tab = queue.openPhone({
        owner: caller.value,
        app: app as Id<"app">,
        screen,
      });
      return ok({ tab, status: "accepted" as const });
    }
    if ("preview" in input.target) {
      const { app } = input.target.preview;
      const own = await ownApp(caller.value, app);
      if (!own.ok) return own;
      const { screen } = input.target.preview;
      let { device } = input.target.preview;
      if (device !== null && !deps.deviceNames().includes(device)) {
        return err({
          code: "not_found",
          message: `no device named ${device}; register it in Settings > Browser`,
        });
      }
      const current = await running(app);
      if (!current.ok) return current;
      if (screen !== null) {
        const { release } = current.value;
        const screens =
          release === null ? ok([]) : await deps.screens(who, app, release);
        if (!screens.ok) return screens;
        const found = screens.value.find((each) => each.key === screen);
        if (found === undefined) {
          const keys = screens.value.map((each) => each.key);
          return err({
            code: "not_found",
            message: `no screen named ${screen}; this preview has: ${keys.join(", ") || "(none)"}`,
          });
        }
        // 폰 화면을 넓은 틀에 그려 잘못 믿게 하지 않는다. 기기 id는 내보내지 않고 이름만 쓴다.
        if (found.places.includes("phone") && device === null) {
          const primary = await deps.primaryDeviceName();
          if (!primary.ok) return primary;
          if (primary.value === null) {
            return err({ code: "conflict", message: PHONE_MISSING });
          }
          device = primary.value;
        }
      }
      const tab = queue.openTab({
        owner: caller.value,
        workspace: { kind: "app", id: app as Id<"app"> },
        target: { preview: { app, device, screen } },
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
        message:
          "a person token opens --url, --preview, --phone and --artifact tabs",
      });
    }
    const from = person ? undefined : sessionRow(caller.value);
    if (!person && from === undefined) {
      return err({ code: "not_found", message: "session not found" });
    }
    if ("coding" in input.target) {
      const here = hostWorkspaceOf(workspaceOf(from!));
      if (here.kind === "app") {
        return err({
          code: "invalid_input",
          message:
            "coding tabs open in a project or home workspace; apps have no terminal",
        });
      }
      const { harness, handoff } = input.target.coding;
      const agents = deps.codingAgents();
      // 사람이 즐겨찾기했고 이 컴퓨터에 설치된 것만 연다. 없는 CLI를 치면 터미널에 command not found만 남는다.
      const detected = await deps.codingDetected();
      const openable = agents.favorites.filter(
        (id) =>
          detected.includes(id) &&
          HARNESS_ADAPTERS[id as keyof typeof HARNESS_ADAPTERS]?.session.prompt,
      );
      if (openable.length === 0) {
        return err({
          code: "invalid_input",
          message:
            "No coding agent can be opened: none of the person's favorite coding agents is detected on this computer. Tell the person to open Settings > Coding agents, mark an installed coding agent as a favorite, and check that it shows as detected there (Detect again after installing one).",
        });
      }
      if (!openable.includes(harness)) {
        return err({
          code: "invalid_input",
          message: `${harness} cannot open a handoff; use one of: ${openable.join(", ")}. Only coding agents the person marked as a favorite in Settings > Coding agents and that are detected on this computer open.`,
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
      // 터미널에 치는 글은 사람의 실행 명령어와 lophn이 정한 handoff 문장, file 경로뿐이다.
      const command = handoffCommand(
        agents.commands,
        harness as HarnessId,
        file,
      );
      if (command === null) {
        return err({
          code: "unavailable",
          message:
            "The handoff file path cannot be typed into a terminal. Tell the person.",
        });
      }
      const terminal = await deps.openTerminal({
        project:
          here.kind === "home" ? HOME_TERMINAL_PROJECT : (here.id as Id<"prj">),
        command,
      });
      if (!terminal.ok) return terminal;
      queue.openTab({
        owner: caller.value,
        workspace: here,
        target: { terminal: { terminal_ref: terminal.value } },
        relation: input.relation ?? null,
        source: caller.value as Id<"ses">,
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
        const session = input.target.tui as Id<"ses">;
        const held = deps.harnessHold.open(session);
        if (!held.ok) return held;
        // hold가 project의 session만 통과시킨다. core가 터미널을 열고 그 harness의 resume 명령을 친다.
        const terminal = await deps.openTerminal({
          project: there!.id as Id<"prj">,
          resume: held.value,
        });
        if (!terminal.ok) return terminal;
        deps.holdTui(terminal.value, session);
        const tab = queue.openTab({
          owner: caller.value,
          workspace: hostWorkspaceOf(there!),
          target: { terminal: { terminal_ref: terminal.value } },
          relation: input.relation ?? null,
          source: caller.value === "person" ? null : caller.value,
        });
        return ok({ tab, status: "accepted" as const });
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
    };
    if (!("browser" in input.target)) {
      const tab = queue.openTab(opening);
      return ok({ tab, status: "accepted" as const });
    }
    // agent가 여는 browser 탭은 그 agent 정의의 profile을 쓴다. 사람 token은 기본 profile이다. 모르면 열지 않는다.
    const profile = person
      ? ok(null)
      : deps.browserProfile(caller.value as Id<"ses">);
    if (!profile.ok) return profile;
    // browser 탭은 page가 생겼다는 shell의 답을 기다린다. 사람이 그 workspace를 띄우지 않아도 열린다.
    // shell이 없으면 띄우고 붙을 때까지 기다린다. 창이 없는 것은 shell이 창을 열어 푼다.
    const starting = !queue.attached();
    if (starting) {
      if (deps.launchShell === undefined) {
        return err({ code: "unavailable", message: SHELL_NOT_ATTACHED });
      }
      if (!queue.startShell(deps.launchShell)) {
        return err({ code: "unavailable", message: SHELL_START_FAILED });
      }
    }
    const sent = queue.openAndWait(
      profile.value === null ? opening : { ...opening, profile: profile.value },
    );
    const opened = await settled(sent.id, sent.result, starting);
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
    // 볼 수 없는 탭(부모·형제·남의 탭)은 없는 탭과 같은 답이다. 볼 수 있지만 닫지 못하는 탭은 forbidden이다.
    const closed = queue.close(input.tab as Id<"tab">, caller.value, (found) =>
      withinTeam(
        caller.value,
        found,
        (session) => sessionRow(session)?.spawned_by ?? null,
      ),
    );
    return closed.ok
      ? ok({ tab: closed.value, status: "accepted" as const })
      : closed;
  };
  const show: MemoryHandler = (who, body) => {
    const caller = owner(who);
    if (!caller.ok) return caller;
    const input = tabsShow.input.parse(body);
    // 볼 수 없는 탭은 없는 탭과 같은 답이다(close와 같다).
    const shown = queue.show(input.tab as Id<"tab">, caller.value, (found) =>
      withinTeam(
        caller.value,
        found,
        (session) => sessionRow(session)?.spawned_by ?? null,
      ),
    );
    // 원격 보기는 browser 탭만 본다(`page_view/*`). preview·artifact 탭은 그 기계의 창에서만 펴진다.
    if (shown.ok && caller.value !== "person") {
      const found = queue.browserTab(shown.value, caller.value);
      if (found.ok && found.value.view === "browser") {
        deps.shown(caller.value, shown.value);
      }
    }
    return shown.ok
      ? ok({ tab: shown.value, status: "accepted" as const })
      : shown;
  };
  // 자기 탭과 자기 밑 session의 탭이다. 사람 token은 사람 token의 탭만 본다.
  const list: MemoryHandler = (who) => {
    const caller = owner(who);
    if (!caller.ok) return caller;
    // 탭마다 spawn tree를 거슬러 같은 session을 여러 번 읽으므로 이 호출 안에서 한 번만 읽는다.
    const rows = new Map<string, AgentSessionRow | undefined>();
    const row = (session: string) => {
      if (!rows.has(session)) rows.set(session, sessionRow(session));
      return rows.get(session);
    };
    const items = queue.list(
      (found) =>
        withinTeam(
          caller.value,
          found,
          (session) => row(session)?.spawned_by ?? null,
        ),
      (session) => row(session)?.title ?? "",
    );
    const tabs = [];
    for (const item of items) {
      // page가 정한 url·title도 caller에 가기 전에 secret을 지운다.
      const title = deps.redact(item.title);
      const url = item.url === null ? null : deps.redact(item.url);
      if (title === null || (item.url !== null && url === null)) {
        return err({
          code: "unavailable",
          message: "the browser result could not be checked for secrets",
        });
      }
      tabs.push({ ...item, title, url });
    }
    return ok({ tabs });
  };
  const isOpen = (session: string) => sessionRow(session)?.lifecycle === "open";
  // 사람이 창의 browser 탭을 열린 session에 넘긴다(route actor가 사람뿐이다).
  const hand: MemoryHandler = (_who, body) => {
    const input = tabsHand.input.parse(body);
    const handed = queue.hand(
      {
        ...(input.tab === undefined ? {} : { tab: input.tab as Id<"tab"> }),
        owner: input.session as Id<"ses">,
        workspace: input.workspace,
        profile: (input.profile ?? null) as Id<"bpf"> | null,
        url: input.url,
      },
      () => isOpen(input.session),
    );
    return handed.ok ? ok({ tab: handed.value }) : handed;
  };
  // 문장은 model이 그대로 받는다(work.ts).
  const NOT_BELOW =
    "You can give a tab only to a session you opened with `lophn team spawn` or one below it.";
  const NO_TABS =
    "That session is a coding agent chat tab; it cannot drive browser tabs.";
  // 자기가 든 browser 탭을 자기 밑의 열린 lophn session에 주거나(`session`), 준 탭을 되찾는다(`session`이 없거나 자기).
  const give: MemoryHandler = (who, body) => {
    const caller = agentSession(who);
    if (!caller.ok) return caller;
    const input = tabsGive.input.parse(body);
    const to = (input.session ?? caller.value) as Id<"ses">;
    const parentOf = (session: Id<"ses">) =>
      sessionRow(session)?.spawned_by ?? null;
    if (to !== caller.value) {
      const row = sessionRow(to);
      if (row === undefined || row.lifecycle !== "open") {
        return err({ code: "not_found", message: "session not found" });
      }
      if (!withinTeam(caller.value, to, parentOf)) {
        return err({ code: "forbidden", message: NOT_BELOW });
      }
      // GUI 탭 팀원의 turn은 그 터미널 탭의 coding agent가 돌려 lophn browser를 쓰지 않는다.
      if (row.harness_gui) return err({ code: "conflict", message: NO_TABS });
    }
    const given = queue.give(
      input.tab as Id<"tab">,
      caller.value,
      to,
      (owner) => withinTeam(caller.value, owner, parentOf),
    );
    return given.ok ? ok({ tab: input.tab, owner: given.value }) : given;
  };
  // session이 끝나면(보관, 지움, `team end`) 그 session이 받은 탭과 넘겨받은 탭을 돌려준다.
  const ended = (session: string) =>
    queue.ended(session as Id<"ses">, (giver) => isOpen(giver));
  const read: MemoryHandler = (who, body) => {
    const caller = owner(who);
    if (!caller.ok) return caller;
    const input = browserRead.input.parse(body);
    const found = queue.browserTab(input.tab as Id<"tab">, caller.value);
    if (found.ok && found.value.view === "phone") {
      return phone.read(found.value.phone);
    }
    const state = queue.read(input.tab as Id<"tab">, caller.value);
    if (!state.ok) return state;
    // page가 정한 url·title도 caller에 가기 전에 secret을 지운다.
    const url = deps.redact(state.value.url);
    const title = deps.redact(state.value.title);
    return url === null || title === null
      ? err({
          code: "unavailable",
          message: "the browser result could not be checked for secrets",
        })
      : ok({ ...state.value, url, title });
  };

  // 기다리는 browser 호출과 browser 탭 열기. core가 멈추기 전에 끝낸다.
  const inflight = new Set<() => void>();
  // 요청의 결과를 기다리며 기한과 shell이 떨어짐을 1초마다 본다. shell을 띄우며 기다리는 열기는 아직 붙지 않았어도(창을 만드는 동안)
  // 떨어짐으로 보지 않고 30초 기한에 맡긴다.
  const settled = async (
    id: Id<"hrq">,
    result: Promise<Result<HostToolContent[]>>,
    starting = false,
  ) => {
    const abandon = () => queue.abandon(id);
    inflight.add(abandon);
    const watch = setInterval(() => {
      if (!starting && !queue.attached()) abandon();
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
        caller: TabOwner,
      ) => Result<BrowserAction> | Promise<Result<BrowserAction>>,
      shape: (content: HostToolContent[], input: never) => Result<unknown>,
      route: { input: { parse(body: unknown): { tab: string } } },
      // phone 탭이면 shell queue 대신 이것이 폰 link로 답한다.
      onPhone: (
        driver: PhoneDriver,
        tab: PhoneTab,
        by: string,
        input: never,
      ) => Result<unknown> | Promise<Result<unknown>>,
    ): MemoryHandler =>
    async (who, body) => {
      const caller = owner(who);
      if (!caller.ok) return caller;
      const input = route.input.parse(body);
      const found = queue.browserTab(input.tab as Id<"tab">, caller.value);
      if (!found.ok) return found;
      if (found.value.view === "phone") {
        return onPhone(
          phone,
          found.value.phone,
          byOf(caller.value),
          input as never,
        );
      }
      const action = await build(
        input as never,
        found.value.view,
        caller.value,
      );
      if (!action.ok) return action;
      if (!queue.attached()) {
        return err({ code: "unavailable", message: SHELL_LOST });
      }
      const sent = queue.callBrowser({
        tab: input.tab as Id<"tab">,
        view: found.value.view,
        action: action.value,
      });
      const result = await settled(sent.id, sent.result);
      if (!result.ok) return result;
      // page와 agent가 쓴 글이 caller에 가기 전에 알려진 secret을 지운다. 못 끝내면 내보내지 않는다.
      const safe: HostToolContent[] = [];
      for (const block of result.value) {
        if (block.type !== "text") {
          safe.push(block);
          continue;
        }
        const text = deps.redact(block.text);
        if (text === null) {
          return err({
            code: "unavailable",
            message: "the browser result could not be checked for secrets",
          });
        }
        safe.push({ ...block, text });
      }
      return shape(safe, input as never);
    };

  const textOf = (content: HostToolContent[]): Result<string> => {
    const first = content[0];
    return first?.type === "text"
      ? ok(first.text)
      : err({ code: "internal", message: "the browser result has no text" });
  };
  // shell이 JSON 글로 답하는 결과(url·title, evaluate)를 편다.
  const jsonOf = (content: HostToolContent[]): Result<unknown> => {
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
    (driver, tab, by) => driver.snapshot(tab, by),
  );
  const act = call(
    async (input: Record<string, unknown>, _view, caller) => {
      const { tab, ...fields } = input;
      const parsed = browserActSchema.safeParse(fields);
      if (!parsed.success) {
        return invalid(`invalid act: ${parsed.error.issues[0]?.message ?? ""}`);
      }
      const act = parsed.data;
      if (act.type !== "fill_login") return ok({ kind: "act", act });
      const login = await deps.login(act.login);
      if (!login.ok) return login;
      // 다른 profile의 login은 이 탭에서 없는 login이다(list에도 나오지 않는다). browser 탭이 아닌 탭은 기본 profile의
      // login이고 자기 profile이 기본인 쪽만 친다.
      const on = queue.tabProfile(tab as Id<"tab">, caller);
      if (!on.ok) return on;
      const profile = loginProfileOn(on.value, () =>
        caller === "person" ? ok(null) : deps.browserProfile(caller),
      );
      if (!profile.ok) return profile;
      if (login.value === undefined || login.value.profile !== profile.value) {
        return err({ code: "not_found", message: "no login with that id" });
      }
      // username은 비밀이 아니라 metadata의 글을 지금 `fill`과 같이 친다. 값(password·TOTP)은 shell main이 받는다.
      return ok({
        kind: "act",
        act:
          act.field === "username"
            ? { type: "fill", ref: act.ref, text: login.value.username }
            : act,
      });
    },
    (content, input: { type: string }) => {
      const page = jsonOf(content);
      return page.ok && input.type === "fill_login"
        ? ok({ ...(page.value as object), filled: true })
        : page;
    },
    browserAct,
    (driver, tab, by, input: Record<string, unknown>) =>
      driver.act(tab, by, input),
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
    (driver) => driver.unsupported("navigate"),
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
    (driver, tab, by) => driver.screenshot(tab, by),
  );
  const evaluate = call(
    (input: { expression: string }) =>
      ok({ kind: "evaluate", expression: input.expression }),
    jsonOf,
    browserEvaluate,
    (driver) => driver.unsupported("evaluate"),
  );
  const logs = call(
    () => ok({ kind: "logs" }),
    (content) => {
      const text = textOf(content);
      return text.ok ? ok({ logs: text.value }) : text;
    },
    browserLogs,
    (driver) => driver.unsupported("logs"),
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
    (
      driver,
      tab,
      by,
      input: { text?: string; url?: string; timeout_ms?: number },
    ) => driver.wait(tab, by, input),
  );

  return {
    open,
    close,
    show,
    list,
    hand,
    give,
    ended,
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
  let tabs: ReturnType<typeof createTabHandlers> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    name: "host-queue",
    records: () => [CONTEXT],
    build(ctx) {
      // 멀리서 보기(page view)는 browser 탭 표가 바뀌면 빠진 탭을 지우고 목록이 바뀌었다고 알린다.
      let pages: PageView | undefined;
      const made = createHostQueue({
        clock: ctx.clock,
        ids: createIdSource({ clock: ctx.clock, random: ctx.random }),
        changed() {
          pages?.pruned();
          publishStateChanged(ctx.bus, ctx.clock.now(), [
            { name: "browser_pages", id: null },
          ]);
        },
      });
      ctx.provide("hostQueue", made);
      const hostLink = createHostLink({
        queue: made,
        logger: ctx.telemetry.logger,
      });
      ctx.provide("hostLink", hostLink);
      const { launchShell } = ctx.options;

      const sessionRow = (session: string) => {
        const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
          loadSession(lookup, session),
        );
        return found.ok ? found.value : undefined;
      };
      const loginStore = createLoginStore({ root: ctx.root.path });
      const redactor = createProductRedactor(ctx.knownSecrets);
      const redact = (text: string) =>
        redactor(BROWSER_RESULT, "text/plain", text);
      const agentName = (session: string) => {
        const found = ledgerSnapshot(ctx.ledgerPath, (lookup) => {
          const row = loadSession(lookup, session);
          return row === undefined
            ? null
            : workspaceDepsOf(lookup.sql).names.describe(row.agent).name;
        });
        return found.ok ? found.value : null;
      };
      const handlers = createTabHandlers({
        queue: made,
        sessionRow,
        app: (app) => ctx.appsControl.facts.app(app),
        preview: async (app) => {
          const current = await ctx.appsControl.previews.current(app);
          if (!current.ok) return current;
          if (current.value === null) return ok(null);
          // preview service는 release를 쥐지 않는다. release는 그 process의 관측이 싣는다.
          const observed = await ctx.appsControl.client.previewObserve(
            app,
            current.value.process_nonce,
          );
          if (!observed.ok) return observed;
          return ok({ release: observed.value?.release ?? null });
        },
        screens: async (who, app, release) => {
          const read = await ctx.runtime.readers.read(appTools, who, {
            app,
            release,
          });
          if (!read.ok) return read;
          return ok(
            (read.value as { screens: { key: string; places: string[] }[] })
              .screens,
          );
        },
        primaryDeviceName: async () => {
          const read = await ctx.runtime.readers.read(devicesList, CONTEXT, {});
          if (!read.ok) return read;
          const primary = (
            read.value as { devices: { id: string; primary: boolean }[] }
          ).devices.find((each) => each.primary);
          if (primary === undefined) return ok(null);
          const entry = (ctx.settings.get(devicesSetting) ?? []).find(
            (each) => each.device === primary.id,
          );
          return ok(entry?.name ?? null);
        },
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
        codingAgents: () =>
          ctx.settings.get(codingAgentsSetting) ?? {
            favorites: [],
            commands: {},
          },
        codingDetected: async () =>
          ((await ctx.peek.codingDetection?.read()) ?? [])
            .filter((one) => one.discovery === "detected")
            .map((one) => one.harness_id),
        handoffs: fileHandoffs(ctx.root.path),
        async openTerminal(input) {
          const opened = await ctx.terminals.open(input);
          return opened.ok ? ok(opened.value.terminal_ref) : opened;
        },
        holdTui: (terminal, session) =>
          ctx.terminalAgents.holds.hold(terminal, session, "tui"),
        ...(launchShell === undefined
          ? {}
          : {
              launchShell: (failed) =>
                launchShell(ctx.root.path, (thrown) => {
                  ctx.telemetry.logger.warn({
                    component: "host-queue",
                    event: "shell_launch_failed",
                    fields: describeThrown(thrown),
                  });
                  failed();
                }),
            }),
        // 같은 파일을 읽기만 하는 store다. 쓰기는 secrets wiring의 store가 한다.
        login: async (id) => {
          const logins = await loginStore.list();
          return logins.ok ? ok(logins.value.find((l) => l.id === id)) : logins;
        },
        browserProfile: (session) => agentBrowserProfile(ctx, session),
        redact,
        // view 표와 폰 link는 다른 wiring이 낸다. 부를 때 읽는다.
        previewViews: (app) => ctx.appViews.previewViews(app),
        phoneCall: (request) => ctx.phoneLink.call(request),
        agentName,
        shown: (session, tab) =>
          ctx.bus.publish({
            type: "TabShowRequested",
            subject: session,
            at: ctx.clock.now(),
            payload: { tab },
          }),
      });
      tabs = handlers;
      ctx.bus.subscribe([{ types: ["SessionEnded"] }], {
        send(event) {
          if ("session" in event) handlers.ended(event.session);
        },
        close() {},
      });

      const view = createPageView({
        clock: ctx.clock,
        publish: (event) => ctx.bus.publish(event),
        call: (request) => made.callLink(request),
        pages: () => made.pages(),
        agentName,
        // 입력 허락은 remote wiring이 늦게 채운다. 채워지지 않았으면 아무도 다루지 못한다.
        mayControl: (principal) =>
          ctx.peek.terminalInputGrant?.(principal) ?? false,
        deviceKind: (principal) => ctx.peek.deviceKind?.(principal) ?? null,
        // 사람 token이 연 것처럼 연다: 주인 "person", home workspace, shell이나 page host가 없으면 띄운다.
        async open(who, url) {
          const opened = await handlers.open(who, {
            target: { browser: { url } },
          });
          return opened.ok
            ? ok({ tab: (opened.value as { tab: Id<"tab"> }).tab })
            : opened;
        },
        redact,
      });
      pages = view;
      hostLink.onFrame("page_frame", (frame) => view.frame(frame));
      hostLink.onFrame("page_state", (frame) => view.state(frame));
      hostLink.onOpen(() => view.opened());
      hostLink.onClose(() => view.closed());
      timer = setInterval(() => view.expire(), EXPIRE_MS);
      timer.unref?.();

      return ok({
        memory: [
          [key(tabsOpen), handlers.open],
          [key(tabsClose), handlers.close],
          [key(tabsShow), handlers.show],
          [key(tabsList), handlers.list],
          [key(tabsHand), handlers.hand],
          [key(tabsGive), handlers.give],
          [key(browserRead), handlers.read],
          [key(browserSnapshot), handlers.snapshot],
          [key(browserAct), handlers.act],
          [key(browserNavigate), handlers.navigate],
          [key(browserScreenshot), handlers.screenshot],
          [key(browserEvaluate), handlers.evaluate],
          [key(browserLogs), handlers.logs],
          [key(browserWait), handlers.wait],
          [
            key(pageViewWatch),
            (who, input) =>
              view.watch(who, input as { tab: Id<"tab">; on: boolean }),
          ],
          [
            key(pageViewInput),
            (who, input) =>
              view.input(who, input as Parameters<PageView["input"]>[1]),
          ],
          [
            key(pageViewControl),
            (who, input) =>
              view.control(who, input as { tab: Id<"tab">; held: boolean }),
          ],
          [
            key(pageViewOpen),
            (who, input) =>
              view.open(who, input as { url: string; key: string }),
          ],
        ],
        reads: (reads) => {
          reads.set(key(pageViewList), (who) => view.list(who));
          reads.set(key(pageViewSnapshot), (who, input) =>
            view.snapshot(who, (input as { tab: Id<"tab"> }).tab),
          );
        },
      });
    },
    // 기다리는 browser 호출은 서버가 멈추기 전에 끝낸다.
    closeIntake() {
      tabs?.abandonCalls();
    },
    closeWork() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
};
