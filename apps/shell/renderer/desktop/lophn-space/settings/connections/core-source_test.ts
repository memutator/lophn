// coding agent 연결 통로(shell#T50, shell/desktop#R19). 연결은 고정 intent로만 만들고 token·create command가 이
// 통로에 없다는 것, 목록 read 입력이 route schema를 통과한다는 것, 회수는 확인 창을 여는 일뿐이라는 것을 가짜
// core·main 위에서 본다.
import { assert, assertEquals } from "@std/assert";

import {
  connectionList,
  connectionRevoke,
  connectionScopeSchema,
} from "../../../../../../../packages/contracts/coding-agent/mod.ts";
import {
  type CodingApi,
  type CodingReply,
  connectRequestSchema,
} from "../../../../../ipc/coding.ts";
import { confirmationOpenSchema } from "../../../../../ipc/confirmation.ts";
import type { CoreCall } from "../../../../../ipc/core.ts";
import type { CoreReply } from "../../../../../ipc/core-api.ts";
import type { CoreSource } from "../../../connection/connection.ts";
import { coreCodingConnectionsSource } from "./core-source.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fd01";
const APP = "app_01h455vb4pex5v6nkc6gd5fd01";

function fakeCore(answers: Record<string, (body: unknown) => CoreReply>) {
  const calls: CoreCall[] = [];
  const core: CoreSource = {
    subscribe: () => () => {},
    call(input) {
      calls.push(input);
      const key = `${input.kind}:${input.resource}/${input.method}`;
      const answer = answers[key];
      return Promise.resolve(
        answer === undefined
          ? { ok: false, error: { code: "not_found", message: key } }
          : answer(input.body),
      );
    },
  };
  return { core, calls };
}

const ok = (value: unknown): CoreReply => ({ ok: true, value });

function bridge(
  over: Partial<CodingApi> = {},
  connects: unknown[] = [],
): CodingApi {
  const fail = (name: string) => () => Promise.reject(new Error(`no ${name}`));
  return {
    detect: fail("detect"),
    refresh: fail("refresh"),
    connect: (request) => {
      connects.push(request);
      return Promise.resolve<CodingReply<never>>({
        ok: true,
        value: {
          connection: CAC,
          install: { status: "complete", resources: [] },
          checks: [],
        } as never,
      });
    },
    folders: fail("folders"),
    start: fail("start"),
    sessions: fail("sessions"),
    ...over,
  };
}

Deno.test("shell/desktop#R19: 연결 생성은 고정 intent 하나로만 가고 그 모양이 main이 받는 schema를 통과하며 token·hash·create command가 없다", async () => {
  const connects: unknown[] = [];
  const { core, calls } = fakeCore({});
  const source = coreCodingConnectionsSource(core, {
    coding: bridge({}, connects),
    openWindow: undefined,
  });
  const result = await source.connect({
    harness: "claude",
    label: "Desk Claude",
    scope: { kind: "all" },
  });
  assert(result.ok);
  const app = await source.connect({
    harness: "codex",
    label: "Budget only",
    scope: { kind: "app", app: APP },
  });
  assert(app.ok);
  assertEquals(connects, [
    {
      intent: "connect_with_harness",
      harness_id: "claude",
      label: "Desk Claude",
      scope: { kind: "all", app: null },
    },
    {
      intent: "connect_with_harness",
      harness_id: "codex",
      label: "Budget only",
      scope: { kind: "app", app: APP },
    },
  ]);
  for (const sent of connects) {
    assert(connectRequestSchema.safeParse(sent).success);
    // 같은 범위 값은 contracts의 연결 범위 규칙도 통과한다.
    assert(
      connectionScopeSchema.safeParse((sent as { scope: unknown }).scope)
        .success,
    );
    const text = JSON.stringify(sent);
    assert(!/token|digest|secret/i.test(text));
  }
  // core에는 아무것도 보내지 않았다: 연결 생성 command는 renderer가 부르지 않는다.
  assertEquals(calls, []);
  // 통로가 없는 창에서는 unavailable이다.
  const none = coreCodingConnectionsSource(core, {
    coding: undefined,
    openWindow: undefined,
  });
  assertEquals(
    await none.connect({
      harness: "claude",
      label: "x",
      scope: { kind: "all" },
    }),
    { ok: false, code: "unavailable" },
  );
});

Deno.test("shell/desktop#R19: main이 연결을 거절한 이유(code)는 그대로 올라간다", async () => {
  const source = coreCodingConnectionsSource(fakeCore({}).core, {
    coding: bridge({
      connect: () =>
        Promise.resolve({
          ok: false,
          error: { code: "not_detected", message: "x" },
        }),
    }),
    openWindow: undefined,
  });
  assertEquals(
    await source.connect({
      harness: "claude",
      label: "x",
      scope: { kind: "all" },
    }),
    { ok: false, code: "not_detected" },
  );
});

Deno.test("coding-agent/connection#R2: 연결 목록은 ListCodingAgentConnections를 route schema대로 끝까지 읽어 이름·범위·상태만 옮긴다", async () => {
  const { core, calls } = fakeCore({
    "read:coding_agent_connections/list": (body) =>
      (body as { cursor?: string }).cursor === undefined
        ? ok({
          connections: [{
            id: CAC,
            label: "Desk Claude",
            scope: { kind: "all", app: null },
            principal: `coding_agent:${CAC}`,
            state: "active",
            revision: "7",
          }],
          as_of_seq: "5",
          next_cursor: "c1",
        })
        : ok({
          connections: [{
            id: "cac_01h455vb4pex5v6nkc6gd5fd02",
            label: "Budget only",
            scope: { kind: "app", app: APP },
            principal: "coding_agent:cac_01h455vb4pex5v6nkc6gd5fd02",
            state: "revoked",
            revision: "9",
          }],
          as_of_seq: "5",
          next_cursor: null,
        }),
  });
  const source = coreCodingConnectionsSource(core, {
    coding: undefined,
    openWindow: undefined,
  });
  const listed = await source.connections();
  assert(listed.ok);
  assertEquals(listed.value, [
    {
      id: CAC,
      label: "Desk Claude",
      scope: { kind: "all" },
      state: "active",
      revision: "7",
    },
    {
      id: "cac_01h455vb4pex5v6nkc6gd5fd02",
      label: "Budget only",
      scope: { kind: "app", app: APP },
      state: "revoked",
      revision: "9",
    },
  ]);
  for (const call of calls) {
    assert(connectionList.input.safeParse(call.body).success);
  }
  // principal·token 같은 값은 화면 값에 없다.
  assert(!JSON.stringify(listed.value).includes("principal"));
});

Deno.test("flow manage-coding-access 2: 회수는 정확한 연결의 결정 창만 열고 그 요청이 보호 창 schema를 통과하며 command를 직접 부르지 않는다", async () => {
  const { core, calls } = fakeCore({});
  const opened: unknown[] = [];
  const source = coreCodingConnectionsSource(core, {
    coding: undefined,
    openWindow: (intent) => {
      opened.push(intent);
      return Promise.resolve({ windowId: "w1" });
    },
  });
  assertEquals(await source.revoke(CAC), { ok: true, value: null });
  assertEquals(opened, [{
    request: {
      kind: "owner_decision",
      concern: "coding-agent/connection",
      decision: "coding_agent_connection_revoke",
      targets: [CAC],
    },
    parentWindow: "requesting-window",
  }]);
  assert(confirmationOpenSchema.safeParse(opened[0]).success);
  // 결정 이름은 contract의 회수 route가 선언한 것과 같다.
  assertEquals(connectionRevoke.confirmation, "required");
  assertEquals(connectionRevoke.binding, ["connection", "base_revision"]);
  // renderer는 RevokeCodingAgentConnection을 부르지 않는다. 결정은 창에서만 받는다.
  assertEquals(calls, []);
  // 창을 못 열면 실패다.
  const closed = coreCodingConnectionsSource(core, {
    coding: undefined,
    openWindow: () => Promise.resolve({ code: "forbidden" }),
  });
  assertEquals(await closed.revoke(CAC), { ok: false, code: "forbidden" });
  const none = coreCodingConnectionsSource(core, {
    coding: undefined,
    openWindow: undefined,
  });
  assertEquals(await none.revoke(CAC), { ok: false, code: "unavailable" });
});

Deno.test("coding-agent/harnesses#R2: 감지와 다시 감지는 서로 다른 main 호출이고 보호 결과를 그대로 옮긴다", async () => {
  const seen: string[] = [];
  const detected = {
    ok: true as const,
    value: { source: "cached" as const, harnesses: [] },
  };
  const source = coreCodingConnectionsSource(fakeCore({}).core, {
    coding: bridge({
      detect: () => {
        seen.push("detect");
        return Promise.resolve(detected);
      },
      refresh: () => {
        seen.push("refresh");
        return Promise.resolve({
          ok: true as const,
          value: { source: "refreshed" as const, harnesses: [] },
        });
      },
    }),
    openWindow: undefined,
  });
  assertEquals((await source.detect()).ok, true);
  const again = await source.refresh();
  assert(again.ok && again.value.source === "refreshed");
  assertEquals(seen, ["detect", "refresh"]);
  const broken = coreCodingConnectionsSource(fakeCore({}).core, {
    coding: bridge({
      detect: () =>
        Promise.resolve({
          ok: false,
          error: { code: "unavailable", message: "x" },
        }),
    }),
    openWindow: undefined,
  });
  assertEquals(await broken.detect(), { ok: false, code: "unavailable" });
});

Deno.test("coding-agent/connection#R2: 앱 선택지는 보관하지 않은 앱의 이름만 모은다", async () => {
  const { core } = fakeCore({
    "read:apps/list": () =>
      ok({
        apps: [
          {
            id: APP,
            name: "Grocery budget",
            status: "active",
            active_release: null,
            revision: "1",
          },
          {
            id: "app_01h455vb4pex5v6nkc6gd5fd02",
            name: "Old",
            status: "archived",
            active_release: null,
            revision: "1",
          },
        ],
        next_cursor: null,
      }),
  });
  const source = coreCodingConnectionsSource(core, {
    coding: undefined,
    openWindow: undefined,
  });
  assertEquals(await source.apps(), {
    ok: true,
    value: [{ id: APP, name: "Grocery budget" }],
  });
});
