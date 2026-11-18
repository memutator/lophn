import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import type { IncomingMessage } from "node:http";
import { Duplex } from "node:stream";
import { test } from "node:test";
import {
  createIdSource,
  cryptoRandom,
  manualClock,
  seededRandom,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  type CoreFrame,
  HOST_LINK_PATH,
  HOST_LINK_SUBPROTOCOL,
} from "../../protocol/host-link/mod.ts";
import { createHostQueue } from "../host-queue/mod.ts";
import { createAdmission } from "../supervision/responsiveness/mod.ts";
import { createHostLink, createHostLinkUpgrade } from "./host-link.ts";
import { CredentialRegistry } from "./identity/mod.ts";
import { acceptUpgrade } from "./server.ts";
import { createGatewayUpgrade } from "./socket.ts";

const PORT = 7431;
const SESSION = `ses_0${"1".repeat(25)}` as Id<"ses">;
const TURN = `trn_0${"1".repeat(25)}`;
const HOME = { kind: "home" } as const;

// upgrade를 받은 raw socket이다. 쓴 byte를 모은다(거절이면 HTTP 응답, 받으면 101).
function rawSocket() {
  const written: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, done) {
      written.push(Buffer.from(chunk));
      done();
    },
  });
  return { socket, text: () => Buffer.concat(written).toString() };
}

function upgradeRequest(headers: Record<string, string>): IncomingMessage {
  return {
    method: "GET",
    url: HOST_LINK_PATH,
    headers: {
      host: `127.0.0.1:${PORT}`,
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
      "sec-websocket-protocol": HOST_LINK_SUBPROTOCOL,
      ...headers,
    },
    rawHeaders: [],
  } as unknown as IncomingMessage;
}

// 다른 process의 agent나 web page가 host 자리를 차지하면 core가 시키는 일(탭, extension tool, coding 입력)을 가로챈다.
test("자격이 없거나 사람 자격이 아니거나 Origin이 다른 upgrade는 /host-link에서 거절된다", async (t) => {
  const credentials = new CredentialRegistry({
    epoch: "epoch",
    random: cryptoRandom,
    clock: manualClock(Date.parse("2026-11-15T00:00:00Z")),
    operations: [{ name: "file.read", actors: ["agent"], kind: "read" }],
  });
  const user = credentials.issue({
    actor: "user",
    principal: "user",
    scope: { operations: [], targets: {} },
    conditions: { process: "shell" },
  });
  const agent = credentials.issue({
    actor: `agent:${SESSION}`,
    principal: `agent:${SESSION}`,
    scope: {
      operations: ["file.read"],
      targets: { session: SESSION, turn: TURN },
    },
    conditions: { session: SESSION, turn: TURN, process: "agent-runtime" },
  });
  assert.ok(user.ok && agent.ok);

  const clock = manualClock(1_700_000_000_000);
  const queue = createHostQueue({
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const link = createHostLink({ queue });
  const admission = createAdmission();
  const hostLink = createHostLinkUpgrade({ link });
  t.after(() => hostLink.shutdown());
  const upgrade = async (headers: Record<string, string>) => {
    const raw = rawSocket();
    await acceptUpgrade(
      {
        credentials,
        port: PORT,
        admission,
        gateway: createGatewayUpgrade(),
        hostLink,
      },
      upgradeRequest(headers),
      raw.socket,
      Buffer.alloc(0),
    );
    return raw.text().split("\r\n")[0];
  };

  assert.equal(await upgrade({}), "HTTP/1.1 401 Unauthorized");
  assert.equal(
    await upgrade({ authorization: `Bearer ${agent.value.token}` }),
    "HTTP/1.1 403 Forbidden",
  );
  assert.equal(
    await upgrade({
      authorization: `Bearer ${user.value.token}`,
      origin: "https://example.com",
    }),
    "HTTP/1.1 403 Forbidden",
  );
  assert.equal(hostLink.activity().arrivals, 0);

  // 사람 자격은 붙는다(같은 요청에서 자격만 다르다).
  assert.equal(
    await upgrade({ authorization: `Bearer ${user.value.token}` }),
    "HTTP/1.1 101 Switching Protocols",
  );
  assert.equal(hostLink.activity().arrivals, 1);
});

// 끊긴 연결로 보낸 호출을 다시 내주면 extension handler가 두 번 실행되고, 거두지 않으면 부른 쪽이 기한까지 멈춘다.
// 탭 요청은 다시 대기해야 다음 host가 연다.
test("연결이 닫히면 진행 중인 tool_call·browser_call 요청이 unavailable로 끝나고, 빌려 간 탭 요청은 다시 대기한다", async () => {
  const clock = manualClock(1_700_000_000_000);
  const queue = createHostQueue({
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const link = createHostLink({ queue });
  let closes = 0;
  link.onClose(() => closes++);

  const sent: CoreFrame[] = [];
  const peer = link.attach({
    send: (text) => sent.push(JSON.parse(text)),
    close: () => {},
    bufferedAmount: () => 0,
  });
  peer.receive(
    JSON.stringify({ type: "hello", version: 1, workspaces: [HOME], tui: [] }),
  );
  assert.equal(link.attached(), true);
  assert.equal(queue.attached(), true);

  const tool = queue.callTool({
    extension: "web",
    tool: "a",
    input: {},
    session: SESSION,
    workspace: HOME,
    credential: "token",
  });
  const browser = queue.callBrowser({
    tab: "tab_x" as Id<"tab">,
    view: "browser",
    action: { kind: "snapshot" },
  });
  const tab = queue.openTab({
    owner: SESSION,
    workspace: HOME,
    target: { session: SESSION },
    relation: null,
    source: SESSION,
  });
  assert.deepStrictEqual(
    sent.map((frame) => [frame.type, frame.kind]),
    [
      ["request", "tool_call"],
      ["request", "browser_call"],
      ["request", "tab_open"],
    ],
  );
  const opened = sent[2]!;

  peer.closed();
  assert.equal(link.attached(), false);
  assert.equal(closes, 1);
  for (const result of await Promise.all([tool.result, browser.result])) {
    assert.equal(!result.ok && result.error.code, "unavailable");
  }
  // 빌린 기한(10초)을 기다리지 않고 다음 host가 바로 가져간다. 거둔 호출은 다시 나가지 않는다.
  const again: CoreFrame[] = [];
  link
    .attach({
      send: (text) => again.push(JSON.parse(text)),
      close: () => {},
      bufferedAmount: () => 0,
    })
    .receive(
      JSON.stringify({
        type: "hello",
        version: 1,
        workspaces: [HOME],
        tui: [],
      }),
    );
  assert.deepStrictEqual(
    again.map((frame) => [frame.type, frame.id]),
    [["request", opened.id]],
  );
  assert.equal(
    again[0]?.type === "request" &&
      again[0].kind === "tab_open" &&
      again[0].payload.tab,
    tab,
  );
});
