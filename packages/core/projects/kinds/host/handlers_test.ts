import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { KindsDispatcher } from "./dispatcher.ts";
import { kindHandlers } from "./handlers.ts";

const MINE = "dom_01hzzzzzzzzzzzzzzzzzzzzzza";
const ALSO = "dom_01hzzzzzzzzzzzzzzzzzzzzzzb";
const OTHER = "dom_01hzzzzzzzzzzzzzzzzzzzzzzc";
const ses = (name: string) => `agent:ses_01hzzzzzzzzzzzzzzzzzzzzzz${name}`;

// agent가 맡지 않은 domain은 dispatcher까지 가지 못한다. 하나뿐이면 생략할 수 있고, 둘 이상인데 생략하면 거절이다.
test("kind 읽기: agent는 자기 session이 맡은 domain만 읽는다", async () => {
  let asked = 0;
  const dispatcher = {
    ask: () => {
      asked += 1;
      return Promise.resolve(ok({}));
    },
  } as unknown as KindsDispatcher;
  const sessions: Record<string, string[]> = {
    [ses("a").slice(6)]: [MINE],
    [ses("b").slice(6)]: [MINE, ALSO],
    [ses("c").slice(6)]: [],
  };
  const handlers = kindHandlers({
    dispatcher: () => dispatcher,
    domainsOfSession: (session) => sessions[session] ?? [],
    rootsOf: () => ["/work"],
  });
  const call = async (
    route: "kinds/list" | "kinds/check",
    actor: string,
    domain: string | undefined,
    conditions: Record<string, string> = { project: "prj_a" },
  ) => {
    const query = route === "kinds/list" ? { kind: "receipt" } : {};
    const done = await handlers.get(route)!(
      { actor, conditions } as unknown as AuthenticatedContext,
      domain === undefined ? { query } : { domain, query },
    );
    return done.ok ? "ok" : done.error.code;
  };

  for (const route of ["kinds/list", "kinds/check"] as const) {
    asked = 0;
    assert.deepStrictEqual(await call(route, ses("a"), undefined), "ok");
    assert.deepStrictEqual(await call(route, ses("a"), MINE), "ok");
    assert.deepStrictEqual(await call(route, ses("b"), ALSO), "ok");
    assert.deepStrictEqual(asked, 3);
    for (const [actor, domain] of [
      [ses("a"), OTHER],
      [ses("b"), OTHER],
      [ses("b"), undefined],
      [ses("c"), undefined],
      [ses("c"), MINE],
    ] as const) {
      assert.deepStrictEqual(
        await call(route, actor, domain),
        "invalid_input",
        `${actor} ${domain}`,
      );
    }
    assert.deepStrictEqual(await call(route, ses("a"), MINE, {}), "forbidden");
    assert.deepStrictEqual(await call(route, "user", OTHER, {}), "ok");
    assert.deepStrictEqual(
      await call(route, "user", undefined, {}),
      "invalid_input",
    );
    assert.deepStrictEqual(asked, 4);
  }
});
