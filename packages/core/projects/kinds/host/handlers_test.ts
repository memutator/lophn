import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../../base/mod.ts";
import type { DomainOwner } from "../../../../protocol/domains/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { KindsDispatcher } from "./dispatcher.ts";
import { kindHandlers } from "./handlers.ts";

const AGENT = "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza";
const OWNERS: Record<string, DomainOwner> = {
  dom_01hzzzzzzzzzzzzzzzzzzzzzza: {
    kind: "project",
    id: "prj_a",
  } as DomainOwner,
  dom_01hzzzzzzzzzzzzzzzzzzzzzzb: {
    kind: "project",
    id: "prj_b",
  } as DomainOwner,
  dom_01hzzzzzzzzzzzzzzzzzzzzzzc: { kind: "app", id: "app_a" } as DomainOwner,
};

// 자격 그릇이 owner가 아닌 domain은 읽을 수 없다. dispatcher까지 가지도 않는다.
test("kind 읽기: agent는 자격 그릇이 owner인 domain만 읽는다", async () => {
  let asked = 0;
  const dispatcher = {
    ask: () => {
      asked += 1;
      return Promise.resolve(ok({}));
    },
  } as unknown as KindsDispatcher;
  const handler = kindHandlers({
    dispatcher: () => dispatcher,
    ownerOf: (domain) => OWNERS[domain] ?? null,
    rootsOf: () => ["/work"],
  }).get("kinds/get")!;
  const call = (
    actor: string,
    conditions: Record<string, string>,
    domain: string,
  ) =>
    handler(
      { actor, conditions } as unknown as AuthenticatedContext,
      { domain },
    );
  const code = async (result: ReturnType<typeof call>) => {
    const done = await result;
    return done.ok ? "ok" : done.error.code;
  };

  assert.deepStrictEqual(
    await code(
      call(AGENT, { project: "prj_a" }, "dom_01hzzzzzzzzzzzzzzzzzzzzzza"),
    ),
    "ok",
  );
  assert.deepStrictEqual(asked, 1);
  assert.deepStrictEqual(
    await code(
      call(AGENT, { project: "prj_a" }, "dom_01hzzzzzzzzzzzzzzzzzzzzzzb"),
    ),
    "not_found",
  );
  assert.deepStrictEqual(
    await code(
      call(AGENT, { project: "prj_a" }, "dom_01hzzzzzzzzzzzzzzzzzzzzzzc"),
    ),
    "not_found",
  );
  assert.deepStrictEqual(
    await code(
      call(AGENT, { app: "app_a" }, "dom_01hzzzzzzzzzzzzzzzzzzzzzzc"),
    ),
    "ok",
  );
  assert.deepStrictEqual(
    await code(call(AGENT, {}, "dom_01hzzzzzzzzzzzzzzzzzzzzzza")),
    "forbidden",
  );
  assert.deepStrictEqual(asked, 2);
  assert.deepStrictEqual(
    await code(call("user", {}, "dom_01hzzzzzzzzzzzzzzzzzzzzzzb")),
    "ok",
  );
});
