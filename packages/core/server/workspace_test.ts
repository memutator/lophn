import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../base/mod.ts";
import { WORKSPACE_ROUTES } from "../../protocol/shell/mod.ts";
import { type CredentialIssue, CredentialRegistry } from "./identity/mod.ts";
import { createWorkspaceRelay, WORKSPACE_MAX_WINDOWS } from "./workspace.ts";
import { RouteRegistry, startApiServer } from "./mod.ts";

const SES = "ses_01arz3ndektsv4rrffq69g5fav";
const OTHER_SES = "ses_01arz3ndektsv4rrffq69g5faw";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const ASG = "asg_01arz3ndektsv4rrffq69g5fav";
const AT = "2026-10-04T06:48:00.000Z";

type RunSession = NonNullable<
  NonNullable<Parameters<typeof createWorkspaceRelay>[0]>["runSession"]
>;

// shell main의 user credential. publish·bind·unpublish의 actor다.
const USER: CredentialIssue = {
  actor: "user",
  principal: "user",
  scope: {
    operations: [
      "platform/status",
      "platform/health",
      "workspace/publish",
      "workspace/bind",
      "workspace/unpublish",
    ],
    targets: {},
  },
  conditions: { process: "electron-main" },
};

// agent runtime의 agent credential. read의 actor다.
const AGENT: CredentialIssue = {
  actor: `agent:${ASG}`,
  principal: `agent:${ASG}`,
  scope: {
    operations: ["workspace/read", "platform/status"],
    targets: { assignment: ASG, run: RUN },
    agent: {
      role: "lophn",
      assignment: ASG,
      apps: [{
        app: "app_01arz3ndektsv4rrffq69g5fav",
        commands: ["status"],
        effects: ["read"],
        revert_required: false,
        confirm_allowed: false,
      }],
    },
  },
  conditions: { assignment: ASG, run: RUN, process: "agent-runtime" },
};

const TAB_PAGE = [
  {
    key: "notes",
    kind: "document_editor",
    document: "doc_01arz3ndektsv4rrffq69g5fav",
    selected: true,
  },
  {
    key: "shell",
    kind: "terminal",
    project_folder: "/tmp/work",
    selected: false,
  },
];

function publishInput(windowRef = "win-1") {
  return {
    window_ref: windowRef,
    generation: 3,
    observed_at: AT,
    summary: "project board, 2 tabs",
    tab_pages: [TAB_PAGE],
  };
}

// CredentialRegistry + relay를 한 server로 묶는다. publish는 user token,
// read는 agent token으로 부른다. runSession resolver를 테스트가 바꾼다.
async function built(runSession?: RunSession) {
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  const relay = createWorkspaceRelay({ runSession });
  const credentials = new CredentialRegistry({
    epoch: "core-one",
    clock,
    random: seededRandom(5),
    operations: [
      { name: "platform/status", actors: ["user", "agent"], kind: "read" },
      { name: "platform/health", actors: ["user", "agent"], kind: "read" },
      { name: "workspace/publish", actors: ["user"], kind: "command" },
      { name: "workspace/bind", actors: ["user"], kind: "command" },
      { name: "workspace/unpublish", actors: ["user"], kind: "command" },
      { name: "workspace/read", actors: ["agent"], kind: "read" },
    ],
  });
  const issuedUser = await credentials.issue(USER);
  assert(issuedUser.ok);
  const issuedAgent = await credentials.issue(AGENT);
  assert(issuedAgent.ok);
  const server = await startApiServer({
    port: 0,
    clock,
    credentials,
    memory: relay.handlers,
    registry: new RouteRegistry([...WORKSPACE_ROUTES]),
  });
  return {
    clock,
    relay,
    credentials,
    server,
    base: `http://127.0.0.1:${server.port}`,
    user: issuedUser.value.token,
    agent: issuedAgent.value.token,
  };
}

Deno.test("platform/api#R3: agent는 자기 run의 session만 읽고 다른 session은 unavailable이다", async () => {
  const made = await built((_ctx, run) => {
    assertEquals(run, RUN);
    return ok(SES);
  });
  try {
    const published = await post(
      made.base,
      "/v1/workspace/publish",
      publishInput(),
      made.user,
    );
    assertEquals(published.status, 200);
    const bind = await post(
      made.base,
      "/v1/workspace/bind",
      { session: SES, window_ref: "win-1" },
      made.user,
    );
    assertEquals(bind.status, 200);
    const read = await post(
      made.base,
      "/v1/workspace/read",
      { session: SES },
      made.agent,
    );
    assertEquals(read.status, 200);
    const body = await read.json();
    assertEquals(body.availability, "current");
    assertEquals(body.summary, "project board, 2 tabs");
    const other = await post(
      made.base,
      "/v1/workspace/read",
      { session: OTHER_SES },
      made.agent,
    );
    assertEquals(other.status, 200);
    const absent = await other.json();
    assertEquals(absent.availability, "unavailable");
    assert(absent.reason.length > 0);
  } finally {
    await made.server.stop();
  }
});

Deno.test("platform/identity#R3 lophn-agent/harness/prompt-assemble#R28: run→session resolver가 없으면 read는 옛 값을 주지 않고 unavailable이다", async () => {
  const made = await built();
  try {
    const published = await post(
      made.base,
      "/v1/workspace/publish",
      publishInput(),
      made.user,
    );
    assertEquals(published.status, 200);
    const bind = await post(
      made.base,
      "/v1/workspace/bind",
      { session: SES, window_ref: "win-1" },
      made.user,
    );
    assertEquals(bind.status, 200);
    const read = await post(
      made.base,
      "/v1/workspace/read",
      { session: SES },
      made.agent,
    );
    assertEquals(read.status, 200);
    const body = await read.json();
    assertEquals(body.availability, "unavailable");
    assert(!("summary" in body));
    assert(!("tab_page" in body));
  } finally {
    await made.server.stop();
  }
});

Deno.test("platform/identity#R8: resolver가 다른 session을 주면 read는 부재이고 요약을 누출하지 않는다", async () => {
  const made = await built((_ctx, _run) => ok(OTHER_SES));
  try {
    await post(made.base, "/v1/workspace/publish", publishInput(), made.user);
    await post(
      made.base,
      "/v1/workspace/bind",
      { session: SES, window_ref: "win-1" },
      made.user,
    );
    const read = await post(
      made.base,
      "/v1/workspace/read",
      { session: SES },
      made.agent,
    );
    assertEquals(read.status, 200);
    const body = await read.json();
    assertEquals(body.availability, "unavailable");
    assert(!("summary" in body));
  } finally {
    await made.server.stop();
  }
});

Deno.test("platform/identity#R3: user actor는 read를 부를 수 없고 agent는 publish를 부를 수 없다", async () => {
  const made = await built(() => ok(SES));
  try {
    const read = await post(
      made.base,
      "/v1/workspace/read",
      { session: SES },
      made.user,
    );
    assertEquals(read.status, 403);
    const publish = await post(
      made.base,
      "/v1/workspace/publish",
      publishInput(),
      made.agent,
    );
    assertEquals(publish.status, 403);
  } finally {
    await made.server.stop();
  }
});

Deno.test("shell/workspace#R10: disconnect 뒤 read는 disconnected이고 publish는 unavailable이다", async () => {
  const made = await built(() => ok(SES));
  try {
    await post(made.base, "/v1/workspace/publish", publishInput(), made.user);
    await post(
      made.base,
      "/v1/workspace/bind",
      { session: SES, window_ref: "win-1" },
      made.user,
    );
    made.relay.disconnect();
    const read = await post(
      made.base,
      "/v1/workspace/read",
      { session: SES },
      made.agent,
    );
    assertEquals(read.status, 200);
    const body = await read.json();
    assertEquals(body.availability, "disconnected");
    assert(!("summary" in body));
    const again = await post(
      made.base,
      "/v1/workspace/publish",
      publishInput(),
      made.user,
    );
    assertEquals(again.status, 503);
  } finally {
    await made.server.stop();
  }
});

Deno.test("shell/workspace#R10: 창 수는 상한까지고 초과 publish는 conflict이다", async () => {
  const made = await built(() => ok(SES));
  try {
    for (let index = 0; index < WORKSPACE_MAX_WINDOWS; index++) {
      const windowRef = `win-${index}`;
      const sent = await post(
        made.base,
        "/v1/workspace/publish",
        publishInput(windowRef),
        made.user,
      );
      assertEquals(sent.status, 200, windowRef);
    }
    const over = await post(
      made.base,
      "/v1/workspace/publish",
      publishInput("win-over"),
      made.user,
    );
    assertEquals(over.status, 409);
    // 같은 창의 다시 보내기는 상한 안의 대체다.
    const replace = await post(
      made.base,
      "/v1/workspace/publish",
      { ...publishInput("win-0"), generation: 4 },
      made.user,
    );
    assertEquals(replace.status, 200);
  } finally {
    await made.server.stop();
  }
});

Deno.test("platform/redaction#R5: 등록된 secret이 요약에 있으면 read는 값 대신 부재를 준다", async () => {
  const SECRET = "sk-super-secret-value-0123456789";
  const made = await built(() => ok(SES));
  // relay의 engine registry에 등록한다. 값은 이 테스트 안에만 있다.
  made.relay.registry.register([SECRET]);
  try {
    const published = await post(
      made.base,
      "/v1/workspace/publish",
      { ...publishInput(), summary: `token ${SECRET} in summary` },
      made.user,
    );
    assertEquals(published.status, 200);
    await post(
      made.base,
      "/v1/workspace/bind",
      { session: SES, window_ref: "win-1" },
      made.user,
    );
    const read = await post(
      made.base,
      "/v1/workspace/read",
      { session: SES },
      made.agent,
    );
    const text = await read.text();
    assert(!text.includes(SECRET), "secret must not reach the read output");
  } finally {
    await made.server.stop();
  }
});

Deno.test("shell/workspace#R10: publish 본문은 요약·탭 page만이고 초안·터미널 출력·screenshot은 schema가 거절한다", async () => {
  const made = await built(() => ok(SES));
  try {
    // 편집 초안은 field로도 받지 않는다(shell/workspace#R8).
    const draft = await post(
      made.base,
      "/v1/workspace/publish",
      { ...publishInput(), draft: "unwritten body text" },
      made.user,
    );
    assertEquals(draft.status, 400);
    const body = await post(
      made.base,
      "/v1/workspace/publish",
      { ...publishInput(), body: "terminal output text" },
      made.user,
    );
    assertEquals(body.status, 400);
    const screenshot = await post(
      made.base,
      "/v1/workspace/publish",
      { ...publishInput(), screenshot: "aGVsbG8=" },
      made.user,
    );
    assertEquals(screenshot.status, 400);
    // 요약은 2048 bytes 이하다.
    const longSummary = await post(
      made.base,
      "/v1/workspace/publish",
      { ...publishInput(), summary: "a".repeat(2049) },
      made.user,
    );
    assertEquals(longSummary.status, 400);
    // 탭 page는 20개 이하다.
    const manyTabs = await post(
      made.base,
      "/v1/workspace/publish",
      {
        ...publishInput(),
        tab_pages: [Array.from({ length: 21 }, (_, index) => ({
          key: `t${index}`,
          kind: "terminal",
          project_folder: "/t",
          selected: false,
        }))],
      },
      made.user,
    );
    assertEquals(manyTabs.status, 400);
  } finally {
    await made.server.stop();
  }
});

async function post(
  base: string,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}
