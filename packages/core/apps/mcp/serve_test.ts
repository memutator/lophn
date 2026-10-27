import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok } from "../../../base/mod.ts";
import type { ToolCallInput } from "../../../protocol/apps/calls/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { ToolDeclaration } from "../declaration/mod.ts";
import type { CurrentPreview } from "../preview/mod.ts";
import { type CodingMcpDeps, createCodingMcpTools } from "./serve.ts";

const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const [APP_A, APP_B] = [id("app", 1), id("app", 2)];
const [S1, S2] = [id("ses", 1), id("ses", 2)];

const tool = (name: string, inputSchema?: null): ToolDeclaration => ({
  name,
  inputSchema,
  title: name,
  description: name,
  effect: "read",
  public: false,
  domain: "items",
} as unknown as ToolDeclaration);

const context = (actor: string, app: string): AuthenticatedContext => ({
  principal: actor,
  actor,
  scope: { operations: ["coding.mcp"], targets: { app } },
  conditions: { app },
  credential_ref: "ref",
});

function setup(preview: Partial<CurrentPreview> | null) {
  const calls: ToolCallInput[] = [];
  const authsSeen: unknown[] = [];
  const deps: CodingMcpDeps = {
    // token의 앱만 본다(다른 앱 target은 registry가 not_found로 막는다).
    authorize: (ctx) =>
      ctx.conditions.app === undefined
        ? err({ code: "forbidden", message: "x" })
        : ok({ app: ctx.conditions.app }),
    previews: {
      current: (app) =>
        Promise.resolve(ok(
          preview === null || app !== APP_A ? null : {
            process_nonce: "nonce1",
            ready: true,
            bundle_hash: "h",
            tools: [tool("a_preview"), tool("a_none", null)],
            ...preview,
          },
        )),
    },
    activeTools: (app) => ok(app === APP_A ? [tool("a_live")] : [tool("b")]),
    calls: {
      call(input, auth) {
        calls.push(input);
        authsSeen.push(auth);
        return Promise.resolve(ok({
          invocation: null,
          outcome: { status: "succeeded", result: { n: 1 } },
        }));
      },
    },
  };
  return { tools: createCodingMcpTools(deps), calls, authsSeen };
}

test("MCP tools/list shows only the token's app and only to a coding agent", async () => {
  const { tools } = setup(null);
  const a = await tools.list(context(`coding_agent:${S1}`, APP_A));
  assert.ok(a.ok);
  assert.deepStrictEqual(a.value.map((t) => t.name), ["a_live"]);
  const b = await tools.list(context(`coding_agent:${S2}`, APP_B));
  assert.ok(b.ok);
  assert.deepStrictEqual(b.value.map((t) => t.name), ["b"]);
  const user = await tools.list(context("user", APP_A));
  assert.ok(!user.ok && user.error.code === "forbidden");
});

test("MCP tools/call goes to the preview only and never to the live app", async () => {
  // preview 없음: isError이고 호출 길은 불리지 않는다.
  const none = setup(null);
  const unavailable = await none.tools.call(
    context(`coding_agent:${S1}`, APP_A),
    "a_live",
    {},
  );
  assert.ok(unavailable.ok && unavailable.value?.isError === true);
  assert.ok(unavailable.value.content[0].text.startsWith("unavailable:"));
  assert.deepStrictEqual(none.calls.length, 0);

  // preview 있음: preview target과 previewOnly로 부른다. 목록에 없는 이름은 부르지 않는다.
  const running = setup({});
  const ctx = context(`coding_agent:${S1}`, APP_A);
  const unknown = await running.tools.call(ctx, "a_live", {});
  assert.ok(unknown.ok && unknown.value === null);
  assert.deepStrictEqual(running.calls.length, 0);
  const done = await running.tools.call(ctx, "a_preview", { x: 1 });
  assert.ok(done.ok && done.value?.isError !== true);
  assert.deepStrictEqual(done.value?.structuredContent, { n: 1 });
  assert.deepStrictEqual(running.calls.length, 1);
  assert.deepStrictEqual(running.calls[0].target, {
    mode: "preview",
    app: APP_A,
    process_nonce: "nonce1",
  });
  assert.deepStrictEqual(running.authsSeen[0], {
    actor: "user",
    previewOnly: true,
  });

  // 인자 없는 tool(inputSchema null)은 arguments 없이도 {}로도 input 없이 부르고, 값이 있으면 앱에 보내지 않는다.
  for (const args of [undefined, {}]) {
    const before: number = running.calls.length;
    const none = await running.tools.call(ctx, "a_none", args as never);
    assert.ok(none.ok && none.value?.isError !== true);
    assert.deepStrictEqual("input" in running.calls[before], false);
  }
  const extra = await running.tools.call(ctx, "a_none", { x: 1 });
  assert.ok(extra.ok && extra.value?.isError === true);
  assert.deepStrictEqual(running.calls.length, 3);

  // 아직 ready가 아닌 preview도 부르지 않는다.
  const starting = setup({ ready: false });
  const notReady = await starting.tools.call(ctx, "a_preview", {});
  assert.ok(notReady.ok && notReady.value?.isError === true);
  assert.deepStrictEqual(starting.calls.length, 0);
});
