import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../../../base/mod.ts";
import { PHONE_TAB_TEXT } from "../../../../protocol/phone/drive.ts";
import { createAppViews } from "../../../apps/views/mod.ts";
import type { PreviewView } from "../../../host-queue/phone.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type {
  HostRequest,
  HostWorkspace,
} from "../../../../protocol/lophn-agent/host-queue.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  createHostQueue,
  fileHandoffs,
  type HostQueueService,
} from "../../../host-queue/mod.ts";
import type { AgentSessionRow } from "../../../lophn-agent/session/model.ts";
import { routePath } from "../../../../protocol/base/mod.ts";
import {
  PAGE_VIEW_ROUTES,
  pageViewControl,
  pageViewInput,
  pageViewOpen,
} from "../../../../protocol/lophn-agent/page-view.ts";
import { dispatchHttp } from "../../../server/dispatch.ts";
import type { MemoryHandler, ReadHandler } from "../../../server/mod.ts";
import { liveBrowserProfile } from "./browser-profile.ts";
import { createTabHandlers, hostQueueWiring } from "./host-queue.ts";

// preview 탭은 그 앱 workspace의 session과 사람만 열고, 주인만 닫는다. 깨지면 다른 앱·project의 agent가 남의 앱 화면을
// 사람 화면에 띄우거나 남의 탭을 닫는다.
const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const APP = id("app", 1);
const OTHER_APP = id("app", 2);
const rows: Record<string, Partial<AgentSessionRow>> = {
  [id("ses", 1)]: { workspace_kind: "app", workspace_id: APP },
  [id("ses", 2)]: { workspace_kind: "app", workspace_id: OTHER_APP },
  [id("ses", 3)]: { workspace_kind: "project", workspace_id: id("prj", 1) },
  [id("ses", 4)]: { workspace_kind: null, workspace_id: null },
  // 5가 `team spawn`으로 6을 열었다.
  [id("ses", 5)]: { spawned_by: null, title: "Lead", lifecycle: "open" },
  [id("ses", 6)]: {
    spawned_by: id("ses", 5),
    title: "Child",
    lifecycle: "open",
  },
  // 탭 주기: 7은 6의 자식, 8은 6의 형제, 9는 5가 연 coding agent 채팅 탭 팀원, 10은 보관한 5의 자식, 11은 팀 밖이다.
  [id("ses", 7)]: { spawned_by: id("ses", 6), lifecycle: "open" },
  [id("ses", 8)]: { spawned_by: id("ses", 5), lifecycle: "open" },
  [id("ses", 9)]: {
    spawned_by: id("ses", 5),
    lifecycle: "open",
    harness_gui: true,
  },
  [id("ses", 10)]: { spawned_by: id("ses", 5), lifecycle: "archived" },
  [id("ses", 11)]: { spawned_by: null, lifecycle: "open" },
  // 21은 5가 다른 컴퓨터에 연 팀원의 자리다.
  [id("ses", 21)]: {
    spawned_by: id("ses", 5),
    lifecycle: "open",
    runs_on: id("mch", 2),
  },
};
const agent = (n: number) =>
  ({
    actor: `agent:${id("ses", n)}`,
    conditions: { session: id("ses", n) },
  }) as never;
const person = {
  actor: "user",
  conditions: {},
} as unknown as AuthenticatedContext;

const LOGIN = `lgn_${"0".repeat(26)}`;
const LOGIN_ENTRY = {
  id: LOGIN,
  label: "x",
  origin: "https://example.com",
  username: "alice@example.com",
  note: "",
  profile: null,
};
const KNOWN = "hunter2";
// browser profile: 설정에는 WORK만 있다. session 5의 agent 정의는 WORK, session 6의 정의는 지운 profile GONE을 가리킨다.
const WORK = `bpf_${"1".repeat(26)}`;
const GONE = `bpf_${"2".repeat(26)}`;
// session 4의 정의는 읽지 못한다(undefined).
const DEFINED: Record<string, string | undefined> = {
  [id("ses", 5)]: WORK,
  [id("ses", 6)]: GONE,
  [id("ses", 4)]: undefined,
};
const WORK_LOGIN = `lgn_${"2".repeat(26)}`;
const WORK_LOGIN_ENTRY = { ...LOGIN_ENTRY, id: WORK_LOGIN, profile: WORK };

// 폰 쪽 가짜. previewViews는 view 표, calls는 폰 link에 간 요청, answer는 폰의 답이다.
type FakePhone = {
  previewViews: (app: string) => readonly PreviewView[];
  calls: PhoneCall[];
  answer: (call: PhoneCall) => Result<unknown>;
};
type PhoneCall = {
  device: string;
  kind: string;
  input: unknown;
  deadline_ms: number;
};
function fakePhone(
  previewViews: FakePhone["previewViews"] = () => [],
): FakePhone {
  return { previewViews, calls: [], answer: () => ok({}) };
}

function setup(
  running: boolean,
  root = "/nonexistent",
  launchShell?: (failed: () => void) => void,
  primary: string | null = null,
  phone: FakePhone = fakePhone(),
  favorites?: string[],
) {
  const clock = manualClock(1_700_000_000_000);
  const terminals: { project: string; command?: string }[] = [];
  const queue = createHostQueue({
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const handlers = createTabHandlers({
    queue,
    sessionRow: (session) =>
      rows[session] === undefined
        ? undefined
        : ({ runs_on: null, ...rows[session] } as AgentSessionRow),
    app: (app) => Promise.resolve(ok(app === APP ? {} : null)),
    preview: () =>
      Promise.resolve(ok(running ? { release: id("rel", 1) } : null)),
    screens: () =>
      Promise.resolve(
        ok([
          { key: "home", places: ["tab"] },
          { key: "pocket", places: ["phone"] },
        ]),
      ),
    primaryDeviceName: () => Promise.resolve(ok(primary)),
    // project 1에만 `report`가 있다.
    artifactExists: (workspace, name) =>
      Promise.resolve(workspace.id === id("prj", 1) && name === "report"),
    deviceNames: () => ["Pixel"],
    harnessHold: { open: () => ok({ harness: "x", external_session: "y" }) },
    // pi는 즐겨찾기지만 TUI 첫 prompt 인자가 없다. codex는 즐겨찾기지만 이 컴퓨터에서 감지되지 않았다. cursor는 감지됐지만 즐겨찾기가 아니다.
    codingAgents: () => ({
      favorites: favorites ?? ["claude", "pi", "codex"],
      commands: {},
    }),
    codingDetected: () => Promise.resolve(["claude", "pi", "cursor"]),
    handoffs: fileHandoffs(root),
    openTerminal: (input) => {
      terminals.push(input);
      return Promise.resolve(ok(`trm_${terminals.length}`));
    },
    holdTui: () => {},
    ...(launchShell === undefined ? {} : { launchShell }),
    login: (login) =>
      Promise.resolve(
        ok(
          login === LOGIN
            ? LOGIN_ENTRY
            : login === WORK_LOGIN
              ? WORK_LOGIN_ENTRY
              : undefined,
        ),
      ),
    browserProfile: (session) =>
      liveBrowserProfile(
        Object.hasOwn(DEFINED, session) ? DEFINED[session] : null,
        [{ id: WORK }],
      ),
    redact: (text) => text.replaceAll(KNOWN, "[REDACTED]"),
    previewViews: (app) => phone.previewViews(app),
    phoneCall: (call) => {
      phone.calls.push(call);
      return Promise.resolve(phone.answer(call));
    },
    agentName: (session) => (session === id("ses", 1) ? "Builder" : null),
    shown: () => {},
  });
  return { clock, queue, terminals, ...handlers };
}
const target = { target: { preview: { app: APP } } };

// `/host-link` 연결 하나를 붙이고 queue가 밀어 준 요청을 받은 차례로 꺼낸다. `arrive`는 handler가 비동기로 넣는 요청을 기다린다.
function connect(
  queue: HostQueueService,
  workspaces: readonly HostWorkspace[] = [],
) {
  const sent: HostRequest[] = [];
  const link = queue.connect((request) => sent.push(request));
  link.visible(workspaces);
  return {
    link,
    next: () => sent.shift() ?? null,
    async arrive(): Promise<HostRequest> {
      while (sent.length === 0) await new Promise(setImmediate);
      return sent.shift()!;
    },
  };
}
const PROJECT_1 = { kind: "project", id: id("prj", 1) } as HostWorkspace;
const code = (reply: { ok: boolean }) =>
  reply.ok
    ? "ok"
    : (reply as unknown as { error: { code: string } }).error.code;

test("preview 탭은 그 앱 workspace의 session과 사람만 연다", async () => {
  const { queue, open } = setup(true);
  const host = connect(queue, [{ kind: "app", id: APP as never }]);
  for (const n of [2, 3, 4]) {
    assert.equal(code(await open(agent(n), target)), "not_found");
  }
  assert.equal(host.next(), null);
  assert.equal(code(await open(agent(1), target)), "ok");
  assert.equal(code(await open(person, target)), "ok");
  // 사람 token은 session 탭을 열지 못한다.
  const session = { target: { session: id("ses", 1) } };
  assert.equal(code(await open(person, session)), "invalid_input");
});

// 폰 화면을 넓은 desktop 틀에 그리면 agent가 폰에서도 그렇게 보인다고 잘못 믿는다. 남의 앱 화면은 --screen으로도 열리면 안 된다.
test("--screen은 자기 앱 preview만 열고, 폰 화면은 기준 폰도 --device도 없으면 conflict이며 있으면 그 기기로 연다", async () => {
  const screen = (key: string, device: string | null = null) => ({
    target: { preview: { app: APP, device, screen: key } },
  });
  const bare = setup(true);
  assert.equal(code(await bare.open(agent(2), screen("pocket"))), "not_found");
  assert.equal(code(await bare.open(agent(1), screen("nope"))), "not_found");
  assert.equal(code(await bare.open(agent(1), screen("pocket"))), "conflict");
  assert.equal(code(await bare.open(agent(1), screen("home"))), "ok");
  assert.equal(code(await bare.open(person, screen("pocket", "Pixel"))), "ok");

  const paired = setup(true, "/nonexistent", undefined, "Pixel");
  const host = connect(paired.queue, [{ kind: "app", id: APP as never }]);
  assert.equal(code(await paired.open(agent(1), screen("pocket"))), "ok");
  const sent = host.next();
  assert.deepStrictEqual(
    sent?.kind === "tab_open" ? sent.payload.target : null,
    { preview: { app: APP, device: "Pixel", screen: "pocket" } },
  );
});

test("돌고 있는 preview가 없으면 conflict다", async () => {
  const { open } = setup(false);
  assert.equal(code(await open(person, target)), "conflict");
});

test("탭은 연 쪽만 닫고(볼 수 없는 탭은 없는 탭과 같은 답), 같은 앱의 preview 탭은 하나이며 주인은 나중에 연 쪽이다", async () => {
  const { open, close } = setup(true);
  const first = await open(agent(1), target);
  assert.ok(first.ok);
  const tab = (first.value as { tab: string }).tab;
  assert.equal(code(await close(person, { tab })), "not_found");

  const second = await open(person, target);
  assert.ok(second.ok);
  assert.equal((second.value as { tab: string }).tab, tab);
  assert.equal(code(await close(agent(1), { tab })), "not_found");
  assert.equal(code(await close(person, { tab })), "ok");
  assert.equal(code(await close(person, { tab })), "not_found");
});

const browser = { target: { browser: { url: "https://example.com" } } };
const message = (reply: unknown) =>
  (reply as { error: { message: string } }).error.message;

// browser 탭은 사람이 그 workspace를 띄우지 않아도(연결이 알린 workspaces가 비어도) 열려야 하고, page를 못 만들면 표에 탭이 남으면 안 된다.
// 남으면 agent가 없는 page에 호출을 되풀이한다.
test("browser tab open은 workspace를 띄운 창 없이도 shell에 가고, 기한 안에 답이 없으면 unavailable이며 탭이 남지 않는다", async () => {
  const { clock, queue, open } = setup(true);
  const host = connect(queue);
  const slow = open(agent(1), browser);
  const lent = await host.arrive();
  assert.equal(lent.kind, "tab_open");
  const tab = (lent as { payload: { tab: string } }).payload.tab;
  clock.advance(10_001);
  queue.expire();
  const reply = await slow;
  assert.equal(code(reply), "unavailable");
  assert.equal(queue.read(tab as never, id("ses", 1) as never).ok, false);
  // 늦게 만들어졌을지 모르는 page를 닫으라는 요청이 나가고, 늦게 온 done은 무시된다.
  assert.equal(host.next()?.kind, "tab_close");
  queue.done(lent.id as never, "done");

  const quick = open(agent(1), browser);
  const next = await host.arrive();
  queue.done(next.id as never, "done", {
    content: [{ type: "text", text: "bound" }],
  });
  assert.equal(code(await quick), "ok");
});

// shell이 없을 때 browser 탭 열기가 shell을 띄운다. 깨지면 job이 browser를 못 쓰거나, 열기마다 앱이 여러 개 뜨거나, 띄울 이유가 없는
// 호출(tool, preview)이 사람 장치에서 앱을 띄운다.
test("shell이 없으면 browser tab open이 shell을 한 번만 띄우고 붙어 page가 bind되면 성공한다", async () => {
  let launches = 0;
  const { queue, open } = setup(true, "/nonexistent", () => launches++);
  const first = open(agent(1), browser);
  const second = open(agent(1), browser);
  assert.equal(launches, 1);
  const bound = { content: [{ type: "text" as const, text: "bound" }] };
  const host = connect(queue);
  for (let n = 0; n < 2; n++) {
    queue.done((await host.arrive()).id as never, "done", bound);
  }
  assert.equal(code(await first), "ok");
  assert.equal(code(await second), "ok");
  assert.equal(launches, 1);
  // preview·artifact 탭은 shell이 없어도 띄우지 않는다.
  const none = setup(true, "/nonexistent", () => launches++);
  assert.equal(code(await none.open(person, target)), "ok");
  assert.equal(launches, 1);
});

test("shell이 30초 안에 붙지 않거나 띄우다 실패하면 열기가 unavailable이고, 5분은 다시 띄우지 않고 바로 실패하며, 붙으면 풀린다", async () => {
  let launches = 0;
  let fail: (() => void) | undefined;
  const { clock, queue, open } = setup(true, "/nonexistent", (failed) => {
    launches++;
    fail = failed;
  });
  const waiting = open(agent(1), browser);
  const late = open(agent(1), browser);
  clock.advance(29_000);
  // 29초에 온 열기도 같은 시도와 같이 30초에 끝난다(자기 기한을 따로 기다리지 않는다).
  const alsoWaiting = open(agent(1), browser);
  clock.advance(1_001);
  queue.expire();
  for (const reply of await Promise.all([waiting, late, alsoWaiting])) {
    assert.equal(code(reply), "unavailable");
    assert.match(message(reply), /could not be started/);
  }
  // 실패한 뒤 5분은 띄우지 않고 바로 실패한다.
  clock.advance(60_000);
  assert.match(message(await open(agent(1), browser)), /could not be started/);
  assert.equal(launches, 1);
  // 띄우자마자 실패(spawn 오류)해도 기다리지 않고 끝난다.
  clock.advance(5 * 60_000);
  const spawning = open(agent(1), browser);
  assert.equal(launches, 2);
  fail!();
  assert.match(message(await spawning), /could not be started/);
  // 사람이 앱을 열어 shell이 붙으면 풀리고 열린다. 받는 shell이 없었던 실패한 열기들의 닫기 요청은 쌓이지 않았다.
  clock.advance(1_000);
  const host = connect(queue);
  assert.equal(host.next(), null);
  const again = open(agent(1), browser);
  queue.done((await host.arrive()).id as never, "done", {
    content: [{ type: "text", text: "bound" }],
  });
  assert.equal(code(await again), "ok");
  assert.equal(launches, 2);
  assert.equal(host.next(), null);

  const without = setup(true);
  const refused = await without.open(agent(1), browser);
  assert.equal(code(refused), "unavailable");
  assert.match(message(refused), /not connected/);
});

// 남의 탭을 보거나 조작하면 다른 session의 로그인 page를 읽는다. 주인 대조가 shell 가용 판정보다 앞서야 not_found가 먼저 나간다.
// 없는 탭과 남의 탭은 같은 문장이어야 남의 탭이 있는지 새지 않는다.
test("browser 호출은 연 쪽만 하고, 남이나 사람이 연 탭은 없는 탭과 같은 not_found 문장이다", async () => {
  const { queue, open, snapshot, act } = setup(true);
  const host = connect(queue);
  const openedBy = async (who: AuthenticatedContext) => {
    const pending = open(who, browser);
    queue.done((await host.arrive()).id as never, "done", {
      content: [{ type: "text", text: "bound" }],
    });
    return pending;
  };
  const mine = await openedBy(agent(1));
  const theirs = await openedBy(person);
  assert.ok(mine.ok && theirs.ok);
  const agentTab = (mine.value as { tab: string }).tab;
  const personTab = (theirs.value as { tab: string }).tab;

  assert.equal(code(await snapshot(agent(2), { tab: agentTab })), "not_found");
  const gone = await snapshot(agent(1), { tab: id("tab", 9) });
  assert.equal(code(gone), "not_found");
  assert.equal(
    message(await snapshot(agent(2), { tab: agentTab })),
    message(gone),
  );
  assert.equal(code(await snapshot(person, { tab: agentTab })), "not_found");
  assert.equal(code(await snapshot(agent(1), { tab: personTab })), "not_found");
  assert.equal(
    code(await act(agent(2), { tab: agentTab, type: "click", ref: "e1" })),
    "not_found",
  );
  // 앱이 끝나 shell이 없으면 browser 탭의 page는 사라진 것이라 탭을 표에서 빼고 같은 not_found 문장을 준다.
  host.link.close();
  assert.equal(
    message(await snapshot(agent(1), { tab: agentTab })),
    message(gone),
  );
  assert.equal(code(await snapshot(person, { tab: personTab })), "not_found");
  assert.equal(queue.read(agentTab as never, id("ses", 1) as never).ok, false);
});

// artifact는 그 그릇 workspace의 것만 연다. 깨지면 다른 project·앱의 agent가 남의 artifact를 사람 화면에 띄우고 읽는다.
test("artifact 탭은 자기 workspace의 있는 artifact만 열고, artifact마다 하나다", async () => {
  const { queue, open } = setup(true);
  const host = connect(queue, [PROJECT_1]);
  const report = { target: { artifact: { name: "report" } } };
  // 앱 workspace의 session에게는 그 이름의 artifact가 없다. home은 artifact가 없다.
  assert.equal(code(await open(agent(1), report)), "not_found");
  assert.equal(code(await open(agent(4), report)), "invalid_input");
  assert.equal(code(await open(person, report)), "invalid_input");
  const missing = { target: { artifact: { name: "nope" } } };
  assert.equal(code(await open(agent(3), missing)), "not_found");

  const first = await open(agent(3), report);
  assert.ok(first.ok);
  const tab = (first.value as { tab: string }).tab;
  assert.equal(host.next()?.kind, "tab_open");
  const again = await open(person, {
    ...report,
    workspace: { kind: "project", id: id("prj", 1) },
  });
  assert.ok(again.ok);
  assert.equal((again.value as { tab: string }).tab, tab);
});

// handoff 글은 agent가 쓴 것이다. 깨지면 열 수 없는 자리의 요청이 data root에 file을 남기거나, 글이 터미널 쪽으로 새거나, file이 남에게 읽힌다.
test("coding handoff는 사람 token, 앱 session, 즐겨찾기가 아니거나 감지되지 않은 harness면 invalid_input이고 file도 요청도 남지 않는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-handoff-"));
  try {
    const { queue, open, terminals } = setup(true, root);
    const host = connect(queue, [PROJECT_1]);
    const coding = (harness: string) => ({
      target: { coding: { harness, handoff: "text" } },
    });
    assert.equal(code(await open(person, coding("claude"))), "invalid_input");
    // 앱 session. 앱에는 터미널이 없다.
    assert.equal(code(await open(agent(1), coding("claude"))), "invalid_input");
    // 감지되지 않은 즐겨찾기, 즐겨찾기가 아닌 감지된 harness, 즐겨찾기지만 첫 prompt 인자가 없는 harness.
    const absent = await open(agent(3), coding("codex"));
    assert.equal(code(absent), "invalid_input");
    assert.match(JSON.stringify(absent), /use one of: claude\./);
    assert.equal(code(await open(agent(3), coding("cursor"))), "invalid_input");
    assert.equal(code(await open(agent(3), coding("pi"))), "invalid_input");
    // 열 수 있는 것이 하나도 없으면 사람에게 Settings › Coding agents를 보라고 전하게 한다.
    const none = setup(true, root, undefined, null, fakePhone(), ["codex"]);
    connect(none.queue, [PROJECT_1]);
    const empty = await none.open(agent(3), coding("codex"));
    assert.equal(code(empty), "invalid_input");
    assert.match(JSON.stringify(empty), /Settings > Coding agents/);
    assert.deepEqual(await readdir(root), []);
    assert.equal(host.next(), null);
    assert.deepEqual(terminals, []);
    assert.deepEqual(none.terminals, []);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("받은 handoff는 data root handoffs/에 0600으로 쓰이고 터미널에 치는 명령과 tab_open에는 글이 아니라 file path만 있다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-handoff-"));
  try {
    const { queue, open, terminals } = setup(true, root);
    const host = connect(queue, [PROJECT_1]);
    const text = "goal: fix the login\nnext: run it";
    const opened = await open(agent(3), {
      target: { coding: { harness: "claude", handoff: text } },
    });
    assert.ok(opened.ok);
    const tab = (opened.value as { tab: string }).tab;
    const file = join(root, "handoffs", `${tab}.md`);
    assert.equal(await readFile(file, "utf8"), text);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(join(root, "handoffs"))).mode & 0o777, 0o700);
    assert.equal(terminals.length, 1);
    assert.ok(terminals[0]!.command!.includes(file));
    assert.ok(!JSON.stringify(terminals).includes("login"));
    const request = host.next();
    assert.equal(request?.kind, "tab_open");
    assert.ok(!JSON.stringify(request).includes("login"));
    assert.deepEqual(
      (request as { payload: { target: unknown } }).payload.target,
      { terminal: { terminal_ref: "trm_1" } },
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

// Home의 터미널은 `home` project로 열리고 탭은 Home을 보이는 창에 간다. 깨지면 home agent의 handoff가 project 터미널로 새거나 열리지 않는다.
test("home session의 coding handoff는 home 터미널을 열고 그 탭은 Home workspace로 간다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-handoff-"));
  try {
    const { queue, open, terminals } = setup(true, root);
    const host = connect(queue, [{ kind: "home" }]);
    const opened = await open(agent(4), {
      target: { coding: { harness: "claude", handoff: "text" } },
    });
    assert.ok(opened.ok);
    assert.equal(terminals[0]?.project, "home");
    const request = host.next();
    assert.equal(request?.kind, "tab_open");
    assert.deepEqual(request?.workspace, { kind: "home" });
  } finally {
    await rm(root, { recursive: true });
  }
});

// 값이 queue 항목이나 결과에 실리면 ledger·log·agent에 비밀번호가 남는다. username만 metadata의 글로 `fill`이 된다.
test("fill_login의 queue 항목에는 login id만 있고, 결과와 page 글에서 알려진 값은 지워진다", async () => {
  const { queue, open, act, snapshot } = setup(true);
  const host = connect(queue);
  const opening = open(agent(1), browser);
  queue.done((await host.arrive()).id as never, "done", {
    content: [{ type: "text", text: "bound" }],
  });
  const opened = await opening;
  assert.ok(opened.ok);
  const tab = (opened.value as { tab: string }).tab;
  const fill = { tab, type: "fill_login", ref: "e2", login: LOGIN };

  assert.equal(
    code(
      await act(agent(1), {
        ...fill,
        login: `lgn_${"1".repeat(26)}`,
        field: "password",
      }),
    ),
    "not_found",
  );

  const calls: unknown[] = [];
  const answer = async (reply: ReturnType<typeof act>, text: string) => {
    const request = await host.arrive();
    assert.equal(request.kind, "browser_call");
    calls.push(request.payload);
    queue.done(request.id as Id<"hrq">, "done", {
      content: [{ type: "text", text }],
    });
    return (await reply) as { ok: boolean; value: unknown };
  };
  const password = await answer(
    act(agent(1), { ...fill, field: "password" }),
    JSON.stringify({ url: "https://example.com/", title: `hi ${KNOWN}` }),
  );
  const username = await answer(
    act(agent(1), { ...fill, field: "username" }),
    JSON.stringify({ url: "https://example.com/", title: "t" }),
  );
  assert.deepEqual(
    calls.map((c) => (c as { action: unknown }).action),
    [
      {
        kind: "act",
        act: { type: "fill_login", ref: "e2", login: LOGIN, field: "password" },
      },
      {
        kind: "act",
        act: { type: "fill", ref: "e2", text: "alice@example.com" },
      },
    ],
  );
  assert.deepEqual(password.value, {
    url: "https://example.com/",
    title: "hi [REDACTED]",
    filled: true,
  });
  assert.equal((username.value as { filled?: boolean }).filled, true);

  const shot = await answer(
    snapshot(agent(1), { tab }),
    `- textbox "x" value="${KNOWN}" [ref=e1]`,
  );
  assert.ok(!JSON.stringify(shot.value).includes(KNOWN));
});

// phone 탭은 사람의 폰 화면을 누르고 친다. 깨지면 다른 앱·project의 agent가 남의 앱 화면을 다루거나 남의 session이 연 탭을 부른다.
test("agent는 자기 앱 workspace가 아닌 앱의 phone 탭을 열지 못하고(not_found), 남의 session이 연 phone 탭을 부르지 못한다(not_found)", async () => {
  const views = [
    { owner: "device:dev_1", view: "view-0001", screen: "home", used: 1 },
  ];
  const phone = fakePhone((app) => (app === APP ? views : []));
  const { queue, open, snapshot, act, screenshot, read, close } = setup(
    true,
    "/nonexistent",
    undefined,
    null,
    phone,
  );
  const host = connect(queue, [{ kind: "app", id: APP as never }]);
  const phoneTarget = (app: string) => ({ target: { phone: { app } } });
  for (const n of [2, 3, 4]) {
    assert.equal(code(await open(agent(n), phoneTarget(APP))), "not_found");
  }
  assert.equal(code(await open(agent(1), phoneTarget(OTHER_APP))), "not_found");
  const opened = await open(agent(1), phoneTarget(APP));
  assert.ok(opened.ok);
  const tab = (opened.value as { tab: string }).tab;
  // 남의 session과 사람은 그 탭을 없는 탭과 같은 문장으로 받는다. 폰에는 아무것도 가지 않는다.
  const gone = await snapshot(agent(1), { tab: id("tab", 9) });
  for (const who of [agent(2), person]) {
    assert.equal(message(await snapshot(who, { tab })), message(gone));
    assert.equal(
      code(await act(who, { tab, type: "click", ref: "e1" })),
      "not_found",
    );
    assert.equal(code(await screenshot(who, { tab })), "not_found");
    assert.equal(code(await read(who, { tab })), "not_found");
  }
  assert.equal(code(await close(agent(2), { tab })), "not_found");
  assert.deepEqual(phone.calls, []);
  // phone 탭은 shell queue에 들어가지 않는다.
  assert.equal(host.next(), null);
});

test("phone 탭 열기: 도는 preview가 없으면 conflict, 폰이 그 preview를 보이지 않으면 unavailable이고 탭이 생기지 않는다", async () => {
  const stopped = setup(false);
  const target = { target: { phone: { app: APP } } };
  assert.equal(code(await stopped.open(agent(1), target)), "conflict");
  const blank = setup(true);
  const refused = await blank.open(agent(1), target);
  assert.equal(code(refused), "unavailable");
  assert.equal(message(refused), PHONE_TAB_TEXT.notShowing);
  const views = [
    { owner: "device:dev_1", view: "view-0001", screen: "home", used: 1 },
  ];
  const shown = setup(
    true,
    "/nonexistent",
    undefined,
    null,
    fakePhone(() => views),
  );
  const other = await shown.open(person, {
    target: { phone: { app: APP, screen: "pocket" } },
  });
  assert.equal(code(other), "unavailable");
});

// 폰은 사람의 진짜 기기다. live view는 사람의 진짜 data에 operation을 부르고, 기기가 아닌 owner(shell)의 view는 폰 화면이 아니다.
// 고르는 것이 틀리면 agent의 누르기가 엉뚱한 화면이나 진짜 data에 닿는다.
test("요청은 그 앱의 preview view를 연 기기에만 가고, live view나 기기가 아닌 owner의 view는 고르지 않으며, preview view가 없으면 폰에 묻지 않고 unavailable이다", async () => {
  const REL = id("rel", 1);
  const views = createAppViews({
    appStatus: () => ok("active" as const),
    deviceKind: (owner) => (owner.startsWith("device:") ? "phone" : null),
    log: () => {},
    live: () => Promise.resolve(ok({ release: REL, process_nonce: "live" })),
    preview: () =>
      Promise.resolve(
        ok({
          release: null,
          bundle_hash: "3".repeat(64),
          process_nonce: "pre",
        }),
      ),
    release: () =>
      ok({
        bundle_hash: "1".repeat(64),
        screens: [{ key: "home", places: ["phone", "tab"] }],
        subscriptions: [],
      }),
    phoneCapabilities: () => Promise.resolve(ok([])),
    lookup: {} as never,
    path: {} as never,
    publish: () => {},
  });
  const view = (mode: "live" | "preview", app: string, n: number) => ({
    view: `view-${n}`.padEnd(8, "0"),
    mode,
    app,
    release: null,
    screen: "home",
    place: "phone",
  });
  // 기기 A의 preview(고를 것), 그 뒤에 연 기기 B의 live, shell의 preview, 기기 C의 다른 앱 preview.
  assert.ok((await views.open("device:dev_a", view("preview", APP, 1))).ok);
  assert.ok((await views.open("device:dev_b", view("live", APP, 2))).ok);
  assert.ok((await views.open("user:person", view("preview", APP, 3))).ok);
  assert.ok(
    (await views.open("device:dev_c", view("preview", OTHER_APP, 4))).ok,
  );

  const phone = fakePhone((app) => views.previewViews(app));
  phone.answer = () =>
    ok({ media_type: "image/jpeg", data_base64: "AA==", width: 1, height: 1 });
  const { open, screenshot } = setup(
    true,
    "/nonexistent",
    undefined,
    null,
    phone,
  );
  const opened = await open(agent(1), { target: { phone: { app: APP } } });
  assert.ok(opened.ok);
  const tab = (opened.value as { tab: string }).tab;
  assert.equal(code(await screenshot(agent(1), { tab })), "ok");
  assert.deepEqual(
    phone.calls.map((call) => [
      call.device,
      (call.input as { view: string }).view,
    ]),
    [["dev_a", view("preview", APP, 1).view]],
  );

  views.closeOwner("device:dev_a");
  const none = await screenshot(agent(1), { tab });
  assert.equal(code(none), "unavailable");
  assert.equal(message(none), PHONE_TAB_TEXT.notShowing);
  assert.equal(phone.calls.length, 1);
});

test("phone 탭: open → snapshot → click → screenshot", async () => {
  const VIEW = "view-0001";
  const views = [
    { owner: "device:dev_1", view: VIEW, screen: "home", used: 1 },
  ];
  const phone = fakePhone(() => views);
  phone.answer = (call) =>
    call.kind === "drive.snapshot"
      ? ok({
          snapshot: "s1",
          width_dp: 412,
          height_dp: 915,
          nodes: [
            { node: 1, depth: 0, role: "header", name: "Groceries", flags: [] },
            {
              node: 7,
              depth: 0,
              role: "textbox",
              name: "Item",
              value: KNOWN,
              flags: [],
            },
            {
              node: 9,
              depth: 1,
              role: "button",
              name: "Add",
              flags: ["disabled"],
            },
          ],
        })
      : call.kind === "drive.screenshot"
        ? ok({
            media_type: "image/jpeg",
            data_base64: "AA==",
            width: 1,
            height: 1,
          })
        : ok({});
  const { queue, open, snapshot, act, screenshot, read, show } = setup(
    true,
    "/nonexistent",
    undefined,
    null,
    phone,
  );
  const opened = await open(agent(1), { target: { phone: { app: APP } } });
  assert.ok(opened.ok);
  const tab = (opened.value as { tab: string }).tab;
  // 같은 앱의 phone 탭은 하나다.
  const again = await open(agent(1), { target: { phone: { app: APP } } });
  assert.equal((again as { value: { tab: string } }).value.tab, tab);

  const shot = await snapshot(agent(1), { tab });
  assert.deepEqual((shot as { value: unknown }).value, {
    snapshot: [
      "screen home 412x915dp",
      '- header "Groceries" [ref=e1]',
      '- textbox "Item" value="[REDACTED]" [ref=e2]',
      '  - button "Add" [disabled] [ref=e3]',
    ].join("\n"),
  });
  const clicked = await act(agent(1), { tab, type: "click", ref: "e3" });
  assert.deepEqual((clicked as { value: unknown }).value, {
    url: `phone://${APP}/home`,
    title: "home",
  });
  const image = await screenshot(agent(1), { tab });
  assert.deepEqual((image as { value: unknown }).value, {
    image: { media_type: "image/jpeg", data_base64: "AA==" },
  });
  assert.deepEqual(
    phone.calls.map((call) => [call.kind, call.input]),
    [
      ["drive.snapshot", { view: VIEW, by: "Builder" }],
      [
        "drive.act",
        {
          view: VIEW,
          by: "Builder",
          snapshot: "s1",
          act: { type: "click", node: 9 },
        },
      ],
      ["drive.screenshot", { view: VIEW, by: "Builder", format: "jpeg" }],
    ],
  );
  assert.deepEqual(
    ((await read(agent(1), { tab })) as { value: unknown }).value,
    {
      url: `phone://${APP}/home`,
      title: "home",
      loading: false,
    },
  );
  assert.equal(code(await show(agent(1), { tab })), "invalid_input");
  assert.equal(
    code(await act(agent(1), { tab, type: "hover", ref: "e3" })),
    "invalid_input",
  );
  assert.equal(queue.attached(), false);
});

// 로그인된 browser를 다루는 것은 터미널에 치는 것만큼 센 권한이다. page-view의 test는 허락을 가짜로 주므로, 실제 wiring이 기기의
// 터미널 입력 허락(remote wiring이 채우는 칸)을 읽는지와 route가 agent 자격을 막는지를 여기서 본다.
test("터미널 입력 허락이 없는 기기는 page를 다루지 못하고 agent 자격은 page_view route를 부르지 못한다", async () => {
  const clock = manualClock(1_700_000_000_000);
  const ctx = {
    clock,
    random: seededRandom(1),
    provide() {},
    telemetry: { logger: undefined },
    options: {},
    root: { path: "/nonexistent" },
    bus: { publish() {}, subscribe() {} },
    // 기기 dev_b만 허락받았다.
    peek: {
      terminalInputGrant: (principal: string) => principal === "device:dev_b",
      deviceKind: () => "phone",
    },
  };
  const wiring = hostQueueWiring();
  const built = await wiring.build!(ctx as never);
  assert.ok(built.ok);
  const memory = new Map(
    built.value.memory as Iterable<[string, MemoryHandler]>,
  );
  const reads = new Map<string, ReadHandler>();
  built.value.reads!(reads);
  const tab = id("tab", 9);
  const call = async (
    route: (typeof PAGE_VIEW_ROUTES)[number],
    actor: string,
    principal: string,
  ) => {
    const body =
      route === pageViewInput
        ? { tab, key: "k", input: { type: "text", text: "x" } }
        : route === pageViewControl
          ? { tab, held: true }
          : route === pageViewOpen
            ? { url: "https://a.test", key: "k" }
            : route.name === "PageViewList"
              ? {}
              : route.name === "PageViewWatch"
                ? { tab, on: true }
                : { tab };
    const done = await dispatchHttp(
      new Request(`http://127.0.0.1${routePath(route)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { route, path: routePath(route) },
      {
        principal,
        actor,
        scope: {
          operations: PAGE_VIEW_ROUTES.map((one) => one.name),
          targets: {},
        },
        conditions: actor === "user" ? {} : { session: id("ses", 1) },
        credential_ref: principal,
      } as AuthenticatedContext,
      {
        credentials: undefined as never,
        clock,
        memory,
        reads,
        bodyTimeoutMs: 1000,
        jsonMaxBytes: 65_536,
      },
    );
    return (done as { json: { error?: { code: string } } }).json.error?.code;
  };
  try {
    for (const route of PAGE_VIEW_ROUTES) {
      assert.equal(
        await call(route, `agent:${id("ses", 1)}`, "device:dev_b"),
        "forbidden",
        route.name,
      );
    }
    for (const route of [pageViewInput, pageViewControl, pageViewOpen]) {
      assert.equal(
        await call(route, "user", "device:dev_a"),
        "forbidden",
        route.name,
      );
    }
    // 허락받은 기기는 허락 확인을 지나 탭을 찾는다(없는 탭이다).
    assert.equal(
      await call(pageViewControl, "user", "device:dev_b"),
      "not_found",
    );
  } finally {
    await wiring.closeWork?.();
  }
});

// 목록이 남의 탭을 내면 agent가 부모나 남의 page(사람의 로그인) 제목과 주소를 읽고, redaction이 빠지면 page 주소의 secret이 model에 간다.
test("tabs/list는 자기 탭과 자기 밑 session의 탭만 내고, 사람 token은 사람의 탭만 보며, url·title의 알려진 값은 지워진다", async () => {
  const { queue, list } = setup(true);
  const opened = (owner: Id<"ses"> | "person", url: string) =>
    queue.openTab({
      owner,
      workspace: { kind: "home" },
      target: { browser: { url } },
      relation: null,
      source: null,
    });
  const parent = opened(id("ses", 5) as Id<"ses">, "https://example.com/p");
  const child = opened(
    id("ses", 6) as Id<"ses">,
    `https://example.com/c?token=${KNOWN}`,
  );
  queue.report(child, {
    url: `https://example.com/c?token=${KNOWN}`,
    title: `inbox ${KNOWN}`,
    loading: false,
  });
  opened(id("ses", 1) as Id<"ses">, "https://example.com/s");
  const mine = opened("person", "https://example.com/me");
  const seen = async (who: AuthenticatedContext) => {
    const reply = await list(who, {});
    assert.ok(reply.ok);
    return (
      reply.value as { tabs: { tab: string; url: string; title: string }[] }
    ).tabs;
  };
  const cases: [AuthenticatedContext, string[]][] = [
    [agent(6), [child]],
    [agent(5), [parent, child]],
    [person, [mine]],
  ];
  for (const [who, tabs] of cases) {
    assert.deepStrictEqual(
      (await seen(who)).map((each) => each.tab),
      tabs,
    );
  }
  const [item] = await seen(agent(6));
  assert.equal(item!.url, "https://example.com/c?token=[REDACTED]");
  assert.equal(item!.title, "inbox [REDACTED]");
});

// 깨지면 agent가 다른 profile(다른 cookie로 들어간 site)의 탭에 그 login을 치거나, 그 login이 있다는 것을 안다.
test("fill_login은 탭과 다른 profile의 login을 없는 login과 같은 not_found로 답하고 shell에 아무것도 보내지 않는다", async () => {
  const { queue, act } = setup(true);
  const host = connect(queue);
  const place = (profile?: Id<"bpf">) =>
    queue.openTab({
      owner: id("ses", 1) as Id<"ses">,
      workspace: { kind: "home" },
      target: { browser: { url: "https://example.com" } },
      relation: null,
      source: null,
      ...(profile === undefined ? {} : { profile }),
    });
  const workTab = place(WORK as Id<"bpf">);
  const plainTab = place();
  while (host.next() !== null);
  const fill = (tab: string, login: string) =>
    act(agent(1), {
      tab,
      type: "fill_login",
      ref: "e2",
      login,
      field: "password",
    });
  const missing = await fill(workTab, `lgn_${"7".repeat(26)}`);
  assert.equal(code(missing), "not_found");
  for (const [tab, login] of [
    [workTab, LOGIN],
    [plainTab, WORK_LOGIN],
  ] as const) {
    const reply = fill(tab, login);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 거절은 shell에 가기 전에 끝난다. 새어 나갔으면 답을 주고(기다리는 호출이 남지 않게) 실패한다.
    const leaked = host.next();
    if (leaked !== null) {
      queue.done(leaked.id as Id<"hrq">, "done", {
        content: [{ type: "text", text: "{}" }],
      });
    }
    assert.equal(leaked, null);
    const refused = await reply;
    assert.equal(code(refused), "not_found");
    assert.equal(message(refused), message(missing));
  }
  for (const [tab, login] of [
    [workTab, WORK_LOGIN],
    [plainTab, LOGIN],
  ] as const) {
    const reply = fill(tab, login);
    const request = await host.arrive();
    assert.equal(request.kind, "browser_call");
    queue.done(request.id as Id<"hrq">, "done", {
      content: [
        {
          type: "text",
          text: JSON.stringify({ url: "https://example.com/", title: "t" }),
        },
      ],
    });
    assert.equal(code(await reply), "ok");
  }
});

// 깨지면 agent의 탭이 사람이 정한 profile이 아닌 cookie로 열리거나, agent가 입력으로 다른 profile을 골라 그 로그인을 쓴다.
test("agent가 여는 browser 탭은 정의의 profile이 설정에 있을 때만 그 profile로 열리고, 지운 profile과 사람 token은 기본이며 입력으로 고르지 못한다", async () => {
  const { queue, open } = setup(true);
  const host = connect(queue);
  const opened = async (who: AuthenticatedContext) => {
    const opening = open(who, browser);
    const request = await host.arrive();
    assert.equal(request.kind, "tab_open");
    queue.done(request.id as Id<"hrq">, "done", {
      content: [{ type: "text", text: "bound" }],
    });
    const reply = await opening;
    assert.ok(reply.ok);
    const { tab, target } = (
      request as {
        payload: { tab: string; target: { browser: { profile?: string } } };
      }
    ).payload;
    assert.equal(tab, (reply.value as { tab: string }).tab);
    return { tab, sent: target.browser.profile };
  };
  const work = await opened(agent(5));
  assert.equal(work.sent, WORK);
  const owner = id("ses", 5) as Id<"ses">;
  assert.deepEqual(queue.tabProfile(work.tab as Id<"tab">, owner), ok(WORK));
  for (const [who, owner] of [
    [agent(6), id("ses", 6)],
    [agent(1), id("ses", 1)],
    [person, "person"],
  ] as const) {
    const plain = await opened(who);
    assert.equal(plain.sent, undefined);
    assert.deepEqual(
      queue.tabProfile(plain.tab as Id<"tab">, owner as never),
      ok(null),
    );
  }
  // 정의를 읽지 못하면 기본 profile로 열지 않는다. 새어 나갔으면 답을 주고(기다리는 열기가 남지 않게) 실패한다.
  const unknown = open(agent(4), browser);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const leaked = host.next();
  if (leaked !== null) {
    queue.done(leaked.id as Id<"hrq">, "done", {
      content: [{ type: "text", text: "bound" }],
    });
  }
  assert.equal(leaked, null);
  assert.equal(code(await unknown), "unavailable");
  // 입력에는 profile 칸이 없다. 실어 보내면 열지 않고 shell에도 가지 않는다.
  for (const body of [
    { target: { browser: { url: "https://example.com", profile: WORK } } },
    { ...browser, profile: WORK },
  ]) {
    await assert.rejects(async () => open(agent(6), body));
    assert.equal(host.next(), null);
  }
});

// 깨지면 다른 profile의 agent가 자기 preview·artifact 탭에서 기본 profile의 login을 친다.
test("browser 탭이 아닌 탭의 fill_login은 기본 profile의 login만이고 자기 profile이 기본인 agent만 친다", async () => {
  const { queue, act } = setup(true);
  const host = connect(queue);
  const artifactOf = (session: number, name: string) =>
    queue.openTab({
      owner: id("ses", session) as Id<"ses">,
      workspace: PROJECT_1,
      target: { artifact: { name } },
      relation: null,
      source: null,
    });
  const plainTab = artifactOf(1, "report");
  const workTab = artifactOf(5, "notes");
  while (host.next() !== null);
  const fill = (who: number, tab: string, login: string) =>
    act(agent(who), {
      tab,
      type: "fill_login",
      ref: "e2",
      login,
      field: "password",
    });
  for (const login of [LOGIN, WORK_LOGIN]) {
    const reply = fill(5, workTab, login);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const leaked = host.next();
    if (leaked !== null) {
      queue.done(leaked.id as Id<"hrq">, "done", {
        content: [{ type: "text", text: "{}" }],
      });
    }
    assert.equal(leaked, null);
    const refused = await reply;
    assert.equal(code(refused), "not_found");
    assert.equal(message(refused), "no login with that id");
  }
  const reply = fill(1, plainTab, LOGIN);
  const request = await host.arrive();
  assert.equal(request.kind, "browser_call");
  queue.done(request.id as Id<"hrq">, "done", {
    content: [
      {
        type: "text",
        text: JSON.stringify({ url: "https://example.com/", title: "t" }),
      },
    ],
  });
  assert.equal(code(await reply), "ok");
});

// 탭 주기는 권한 경계다. 깨지면 agent가 부모·형제·남의 탭(사람의 로그인 page)을 가져가거나, 탭을 다룰 수 없는 곳에 주어 잃는다.
test("tabs/give는 든 session이 자기 엄격한 자손의 열린 lophn session에만 주고, 준 사슬의 session만 되찾는다", async () => {
  const { queue, give, open, close, show } = setup(true);
  const tab = queue.openTab({
    owner: id("ses", 5) as Id<"ses">,
    workspace: { kind: "home" },
    target: { browser: { url: "https://example.com/" } },
    relation: null,
    source: null,
  });
  const giving = async (by: number, to: number | null, which = tab) =>
    code(
      (await give(agent(by), {
        tab: which,
        ...(to === null ? {} : { session: id("ses", to) }),
      })) as { ok: boolean },
    );
  const previewTab = (await open(agent(1), target)) as {
    ok: true;
    value: { tab: string };
  };
  const cases: [string, number, number | null, string][] = [
    ["자식이 부모의 탭을 자기에게", 6, null, "not_found"],
    ["자식이 부모의 탭을 자기 자식에게", 6, 7, "not_found"],
    ["형제가 남의 탭을 자기에게", 8, null, "not_found"],
    ["팀 밖 session에게", 5, 11, "forbidden"],
    ["coding agent 채팅 탭 팀원에게", 5, 9, "conflict"],
    ["다른 컴퓨터에서 도는 팀원의 자리에게", 5, 21, "conflict"],
    ["보관한 자식에게", 5, 10, "not_found"],
    ["없는 session에게", 5, 12, "not_found"],
    ["자식에게", 5, 6, "ok"],
    ["준 뒤 형제에게(든 session이 아님)", 5, 8, "forbidden"],
    ["받은 자식이 형제에게", 6, 8, "forbidden"],
    ["형제가 받은 탭을", 8, null, "not_found"],
    ["받은 자식이 자기 자식에게", 6, 7, "ok"],
    ["사슬의 부모가 되찾기", 6, null, "ok"],
    ["사슬의 조부모가 되찾기", 5, null, "ok"],
    ["손자에게 바로", 5, 7, "ok"],
    ["사슬에 없는 중간 조상의 되찾기", 6, null, "forbidden"],
    ["든 session이 아닌 쪽이 지금 주인에게", 6, 7, "forbidden"],
    ["조부모가 되찾기", 5, null, "ok"],
  ];
  for (const [name, by, to, expected] of cases) {
    assert.equal(await giving(by, to), expected, name);
  }
  assert.equal(
    await giving(1, 1, previewTab.value.tab as never),
    "invalid_input",
    "browser 탭이 아니다",
  );
  // 준 동안 준 쪽은 그 page를 다루지 못하고 받은 쪽은 닫지 못한다.
  assert.equal(await giving(5, 6), "ok");
  assert.equal(queue.browserTab(tab, id("ses", 5) as Id<"ses">).ok, false);
  assert.equal(queue.browserTab(tab, id("ses", 6) as Id<"ses">).ok, true);
  const closed = queue.close(tab, id("ses", 6) as Id<"ses">);
  assert.equal(!closed.ok && closed.error.code, "forbidden");
  // 볼 수 없는 탭을 닫으면 없는 탭과 같은 답이고(있는지 새지 않는다), 볼 수 있지만 닫지 못하는 탭은 forbidden이다.
  const closing = async (by: number, which: string) =>
    (await close(agent(by), { tab: which })) as unknown as {
      ok: boolean;
      error: { code: string; message: string };
    };
  const unseen = await closing(8, tab);
  const missing = await closing(8, id("tab", 99));
  assert.deepStrictEqual(unseen.error, missing.error);
  assert.equal(missing.error.code, "not_found");
  // tab show도 같다.
  const shownUnseen = await show(agent(8), { tab });
  const shownMissing = await show(agent(8), { tab: id("tab", 99) });
  assert.deepStrictEqual(
    (shownUnseen as unknown as { error: unknown }).error,
    (shownMissing as unknown as { error: unknown }).error,
  );
  assert.equal(code(shownMissing), "not_found");
  assert.equal((await closing(5, tab)).error.code, "forbidden");
});
