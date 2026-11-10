import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  ok,
  seededRandom,
} from "../../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { createHostQueue, fileHandoffs } from "../../../host-queue/mod.ts";
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

function setup(
  running: boolean,
  root = "/nonexistent",
  launchShell?: () => void,
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
    preview: () => Promise.resolve(ok(running ? {} : null)),
    // project 1에만 `report`가 있다.
    artifactExists: (workspace, name) =>
      Promise.resolve(workspace.id === id("prj", 1) && name === "report"),
    deviceNames: () => [],
    harnessHold: { open: () => ok({ harness: "x", external_session: "y" }) },
    // pi는 즐겨찾기지만 TUI 첫 prompt 인자가 없다. cursor는 있어도 즐겨찾기가 아니다.
    codingFavorites: () => ["claude", "pi"],
    handoffs: fileHandoffs(root),
    ...(launchShell === undefined ? {} : { launchShell }),
  });
  return { clock, queue, ...handlers };
}
const target = { target: { preview: { app: APP } } };
const code = (reply: { ok: boolean }) =>
  reply.ok
    ? "ok"
    : (reply as unknown as { error: { code: string } }).error.code;

test("preview 탭은 그 앱 workspace의 session과 사람만 연다", async () => {
  const { queue, open } = setup(true);
  for (const n of [2, 3, 4]) {
    assert.equal(code(await open(agent(n), target)), "not_found");
  }
  assert.equal(queue.take([{ kind: "app", id: APP as never }]), null);
  assert.equal(code(await open(agent(1), target)), "ok");
  assert.equal(code(await open(person, target)), "ok");
  // 사람 token은 session 탭을 열지 못한다.
  const session = { target: { session: id("ses", 1) } };
  assert.equal(code(await open(person, session)), "invalid_input");
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

// browser 탭은 사람이 그 workspace를 띄우지 않아도(take의 workspaces가 비어도) 열려야 하고, page를 못 만들면 표에 탭이 남으면 안 된다.
// 남으면 agent가 없는 page에 호출을 되풀이한다.
test("browser tab open은 workspace를 띄운 창 없이도 shell에 가고, 기한 안에 답이 없으면 unavailable이며 탭이 남지 않는다", async () => {
  const { clock, queue, open } = setup(true);
  queue.take([]);
  const slow = open(agent(1), browser);
  const lent = queue.take([]);
  assert.equal(lent?.kind, "tab_open");
  const tab = (lent as { payload: { tab: string } }).payload.tab;
  clock.advance(10_001);
  queue.expire();
  const reply = await slow;
  assert.equal(code(reply), "unavailable");
  assert.equal(queue.read(tab as never, id("ses", 1) as never).ok, false);
  // 늦게 온 done은 무시되고, 늦게 만들어졌을지 모르는 page를 닫으라는 요청이 나간다.
  queue.done(lent!.id as never, "done");
  assert.equal(queue.take([])?.kind, "tab_close");

  const quick = open(agent(1), browser);
  const next = queue.take([]);
  queue.done(next!.id as never, "done", {
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
  for (let n = 0; n < 2; n++) {
    queue.done(queue.take([])!.id as never, "done", bound);
  }
  assert.equal(code(await first), "ok");
  assert.equal(code(await second), "ok");
  assert.equal(launches, 1);
  // preview·artifact 탭은 shell이 없어도 띄우지 않는다.
  const none = setup(true, "/nonexistent", () => launches++);
  assert.equal(code(await none.open(person, target)), "ok");
  assert.equal(launches, 1);
});

test("shell이 30초 안에 붙지 않으면 unavailable이고 탭이 남지 않으며, 띄울 길이 없으면 바로 unavailable이다", async () => {
  let launches = 0;
  const { clock, queue, open } = setup(true, "/nonexistent", () => launches++);
  const waiting = open(agent(1), browser);
  clock.advance(30_001);
  queue.expire();
  const reply = await waiting;
  assert.equal(code(reply), "unavailable");
  assert.match(message(reply), /could not be started/);
  // 열던 탭은 닫기만 남고 열기 요청은 거둬졌다.
  assert.equal(queue.take([])?.kind, "tab_close");
  assert.equal(queue.take([]), null);
  // 앞선 시도가 끝났으니 다음 열기는 다시 띄운다.
  clock.advance(10_000);
  const again = open(agent(1), browser);
  assert.equal(launches, 2);
  queue.done(queue.take([])!.id as never, "done", {
    content: [{ type: "text", text: "bound" }],
  });
  assert.equal(code(await again), "ok");

  const without = setup(true);
  const refused = await without.open(agent(1), browser);
  assert.equal(code(refused), "unavailable");
  assert.match(message(refused), /not connected/);
});

// 남의 탭을 보거나 조작하면 다른 session의 로그인 page를 읽는다. 주인 대조가 shell 가용 판정보다 앞서야 not_found가 먼저 나간다.
// 없는 탭과 남의 탭은 같은 문장이어야 남의 탭이 있는지 새지 않는다.
test("browser 호출은 연 쪽만 하고, 남이나 사람이 연 탭은 없는 탭과 같은 not_found 문장이다", async () => {
  const { clock, queue, open, snapshot, act } = setup(true);
  queue.take([]);
  const openedBy = async (who: AuthenticatedContext) => {
    const pending = open(who, browser);
    queue.done(queue.take([])!.id as never, "done", {
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
  // 주인은 주인 대조를 지나 shell이 붙어 있는지로 간다.
  clock.advance(3_001);
  assert.equal(
    code(await snapshot(agent(1), { tab: agentTab })),
    "unavailable",
  );
  assert.equal(code(await snapshot(person, { tab: personTab })), "unavailable");
});

// artifact는 그 그릇 workspace의 것만 연다. 깨지면 다른 project·앱의 agent가 남의 artifact를 사람 화면에 띄우고 읽는다.
test("artifact 탭은 자기 workspace의 있는 artifact만 열고, artifact마다 하나다", async () => {
  const { queue, open } = setup(true);
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
  const request = queue.take([{ kind: "project", id: id("prj", 1) as never }]);
  assert.equal(request?.kind, "tab_open");
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
    assert.equal(
      queue.take([{ kind: "project", id: id("prj", 1) as never }]),
      null,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("받은 handoff는 data root handoffs/에 0600으로 쓰이고 tab_open payload에는 글이 아니라 file path만 있다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-handoff-"));
  try {
    const { queue, open } = setup(true, root);
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
    const request = queue.take([
      { kind: "project", id: id("prj", 1) as never },
    ]);
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
