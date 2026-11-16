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
import { createTabHandlers } from "./host-queue.ts";

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
};
const KNOWN = "hunter2";

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
) {
  const clock = manualClock(1_700_000_000_000);
  const queue = createHostQueue({
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const handlers = createTabHandlers({
    queue,
    sessionRow: (session) => rows[session] as AgentSessionRow | undefined,
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
    // pi는 즐겨찾기지만 TUI 첫 prompt 인자가 없다. cursor는 있어도 즐겨찾기가 아니다.
    codingFavorites: () => ["claude", "pi"],
    handoffs: fileHandoffs(root),
    ...(launchShell === undefined ? {} : { launchShell }),
    login: (login) =>
      Promise.resolve(ok(login === LOGIN ? LOGIN_ENTRY : undefined)),
    redact: (text) => text.replaceAll(KNOWN, "[REDACTED]"),
    previewViews: (app) => phone.previewViews(app),
    phoneCall: (call) => {
      phone.calls.push(call);
      return Promise.resolve(phone.answer(call));
    },
    agentName: (session) => (session === id("ses", 1) ? "Builder" : null),
  });
  return { clock, queue, ...handlers };
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

test("탭은 연 쪽만 닫고, 같은 앱의 preview 탭은 하나이며 주인은 나중에 연 쪽이다", async () => {
  const { open, close } = setup(true);
  const first = await open(agent(1), target);
  assert.ok(first.ok);
  const tab = (first.value as { tab: string }).tab;
  assert.equal(code(await close(person, { tab })), "forbidden");

  const second = await open(person, target);
  assert.ok(second.ok);
  assert.equal((second.value as { tab: string }).tab, tab);
  assert.equal(code(await close(agent(1), { tab })), "forbidden");
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
test("coding handoff는 사람 token, project가 아닌 session, 즐겨찾기에 없는 harness면 invalid_input이고 file도 요청도 남지 않는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-handoff-"));
  try {
    const { queue, open } = setup(true, root);
    const host = connect(queue, [PROJECT_1]);
    const coding = (harness: string) => ({
      target: { coding: { harness, handoff: "text" } },
    });
    assert.equal(code(await open(person, coding("claude"))), "invalid_input");
    // 앱 session과 home session.
    assert.equal(code(await open(agent(1), coding("claude"))), "invalid_input");
    assert.equal(code(await open(agent(4), coding("claude"))), "invalid_input");
    // 즐겨찾기에 없는 harness, 즐겨찾기지만 첫 prompt 인자가 없는 harness.
    const unknown = await open(agent(3), coding("codex"));
    assert.equal(code(unknown), "invalid_input");
    assert.match(JSON.stringify(unknown), /claude/);
    assert.equal(code(await open(agent(3), coding("pi"))), "invalid_input");
    assert.deepEqual(await readdir(root), []);
    assert.equal(host.next(), null);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("받은 handoff는 data root handoffs/에 0600으로 쓰이고 tab_open payload에는 글이 아니라 file path만 있다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-handoff-"));
  try {
    const { queue, open } = setup(true, root);
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
    const request = host.next();
    assert.equal(request?.kind, "tab_open");
    assert.ok(!JSON.stringify(request).includes("login"));
    assert.deepEqual(
      (request as { payload: { handoff: unknown } }).payload.handoff,
      { harness: "claude", file },
    );
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
  assert.equal(code(await close(agent(2), { tab })), "forbidden");
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
