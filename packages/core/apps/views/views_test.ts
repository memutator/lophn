import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type {
  AppViewEventPayload,
  AppViewsOpenInput,
} from "../../../protocol/apps/views.ts";
import type { ToolCallInput } from "../../../protocol/apps/calls/mod.ts";
import { type AppViewsPorts, createAppViews, VIEWS_PER_OWNER } from "./mod.ts";

const APP = "app_00000000000000000000000001";
const OTHER_APP = "app_00000000000000000000000002";
const REL_1 = "rel_00000000000000000000000001";
const REL_2 = "rel_00000000000000000000000002";
const HASH_1 = "1".repeat(64);
const HASH_2 = "2".repeat(64);
const HASH_P = "3".repeat(64);

type Release = {
  app: string;
  bundle_hash: string;
  operations: string[];
  commands: string[];
  subscriptions: { source: string; event: string }[];
};

// 앱 하나(live release 둘, preview 하나)와 다른 앱 하나. 호출 경로는 받은 입력을 남기고 성공으로 답한다.
function fakeWorld() {
  const releases = new Map<string, Release>([
    [
      REL_1,
      {
        app: APP,
        bundle_hash: HASH_1,
        operations: ["save"],
        commands: ["export"],
        subscriptions: [{ source: "ops", event: "limit" }],
      },
    ],
    [
      REL_2,
      {
        app: APP,
        bundle_hash: HASH_2,
        operations: ["save"],
        commands: [],
        subscriptions: [{ source: "ops", event: "limit" }],
      },
    ],
    [
      "rel_00000000000000000000000009",
      {
        app: OTHER_APP,
        bundle_hash: "9".repeat(64),
        operations: ["wipe"],
        commands: [],
        subscriptions: [{ source: "ops", event: "limit" }],
      },
    ],
  ]);
  const state = {
    running: REL_1 as string | null,
    preview: {
      release: null as string | null,
      process_nonce: "preview-nonce",
      operations: ["draft"],
    } as {
      release: string | null;
      process_nonce: string;
      operations: string[];
    } | null,
  };
  const calls: ToolCallInput[] = [];
  const published: { app: string; payload: AppViewEventPayload }[] = [];
  const ports: AppViewsPorts = {
    appStatus: (app) =>
      ok(app === APP || app === OTHER_APP ? ("active" as const) : null),
    live: (app) =>
      Promise.resolve(
        ok(
          app === APP && state.running !== null
            ? { release: state.running, process_nonce: `live-${state.running}` }
            : app === OTHER_APP
              ? {
                  release: "rel_00000000000000000000000009",
                  process_nonce: "other",
                }
              : null,
        ),
      ),
    preview: (app) =>
      Promise.resolve(
        ok(
          app === APP && state.preview !== null
            ? {
                release: state.preview.release,
                bundle_hash: HASH_P,
                process_nonce: state.preview.process_nonce,
              }
            : null,
        ),
      ),
    release(app, release) {
      const found = releases.get(release);
      if (found === undefined || found.app !== app) return ok(null);
      return ok({
        bundle_hash: found.bundle_hash,
        screens: [
          { key: "main", places: ["tab", "card"] },
          {
            key: "detail",
            places: ["panel"],
            params: {
              type: "object",
              properties: { status: { type: "string" } },
              required: ["status"],
              additionalProperties: false,
            },
          },
        ],
        subscriptions: found.subscriptions,
      });
    },
    lookup: {
      find(app, release, kind, name) {
        const found = release === null ? undefined : releases.get(release);
        if (found === undefined || found.app !== app) return ok(null);
        const names = kind === "operation" ? found.operations : found.commands;
        return ok(
          names.includes(name)
            ? { release: release as never, effect: "write", public: false }
            : null,
        );
      },
      findPreview(app, nonce, kind, name) {
        const preview = state.preview;
        return Promise.resolve(
          ok(
            app === APP &&
              preview?.process_nonce === nonce &&
              kind === "operation" &&
              preview.operations.includes(name)
              ? { effect: "write" as const }
              : null,
          ),
        );
      },
    },
    path: {
      call(input) {
        calls.push(input);
        return Promise.resolve(
          ok({
            invocation: null,
            outcome: { status: "succeeded" as const, result: { done: true } },
          }),
        );
      },
    },
    publish: (app, payload) => published.push({ app, payload }),
  };
  return { ports, state, calls, published };
}

function liveOpen(view: string, more: Partial<AppViewsOpenInput> = {}) {
  return {
    view,
    mode: "live" as const,
    app: APP,
    release: null,
    screen: "main",
    place: "tab",
    ...more,
  };
}

const NOT_AVAILABLE = {
  outcome: {
    ok: false,
    error: { code: "forbidden", message: "operation is not available" },
  },
};

// 화면 page(AI가 만든 code)가 command·다른 앱의 operation을 부르거나 다른 release·process를 고르면 막기와 기록이 틀린다.
test("view의 operation 호출은 묶인 release가 선언한 operation만 binding의 대상과 caller로 부른다", async () => {
  const world = fakeWorld();
  const views = createAppViews(world.ports);
  assert.equal((await views.open("user", liveOpen("view-live"))).ok, true);

  for (const name of ["export", "wipe", "missing", "on.ops.limit"]) {
    assert.deepStrictEqual(
      await views.call("user", {
        view: "view-live",
        operation: name,
        input: null,
      }),
      ok(NOT_AVAILABLE),
    );
  }
  assert.deepStrictEqual(world.calls, []);

  assert.deepStrictEqual(
    await views.call("user", {
      view: "view-live",
      operation: "save",
      input: { a: 1 },
    }),
    ok({ outcome: { ok: true, value: { done: true } } }),
  );
  // 앱이 다른 release로 바뀌어도 다시 묶기 전까지는 묶인 release로 부른다.
  world.state.running = REL_2;
  await views.call("user", {
    view: "view-live",
    operation: "save",
    input: null,
  });

  // preview(release 없음)도 그 preview process의 선언으로 부른다.
  assert.equal(
    (
      await views.open("user", {
        view: "view-preview",
        mode: "preview",
        app: APP,
        release: null,
        screen: "anything",
        place: "tab",
      })
    ).ok,
    true,
  );
  assert.deepStrictEqual(
    await views.call("user", {
      view: "view-preview",
      operation: "save",
      input: null,
    }),
    ok(NOT_AVAILABLE),
  );
  await views.call("user", {
    view: "view-preview",
    operation: "draft",
    input: null,
  });

  const person = { kind: "person", view_session: "view-live" };
  assert.deepStrictEqual(world.calls, [
    {
      target: { mode: "live", app: APP, release: REL_1 },
      kind: "operation",
      name: "save",
      input: { a: 1 },
      caller: person,
    },
    {
      target: { mode: "live", app: APP, release: REL_1 },
      kind: "operation",
      name: "save",
      input: null,
      caller: person,
    },
    {
      target: { mode: "preview", app: APP, process_nonce: "preview-nonce" },
      kind: "operation",
      name: "draft",
      input: null,
      caller: { kind: "person", view_session: "view-preview" },
    },
  ]);
});

// 폰과 desktop이 같은 view id를 쓰더라도 남의 화면으로 부르거나 닫으면 안 된다.
test("다른 owner가 연 view는 call과 close에서 없는 view와 같다", async () => {
  const world = fakeWorld();
  const views = createAppViews(world.ports);
  await views.open("user", liveOpen("view-live"));
  const call = { view: "view-live", operation: "save", input: null };
  const missing = await views.call("device:phone", call);
  assert.equal(!missing.ok && missing.error.code, "not_found");
  assert.deepStrictEqual(
    views.close("device:phone", "view-live"),
    ok({ closed: false }),
  );
  assert.deepStrictEqual(world.calls, []);
  assert.deepStrictEqual(
    views.close("user", "view-live"),
    ok({ closed: true }),
  );
});

test("앱 event는 구독을 선언했고 audience에 든 live view에만 가고, card는 release를 따르지 않으며, 상한을 넘으면 가장 오래 안 쓴 view가 나간다", async () => {
  const world = fakeWorld();
  const views = createAppViews(world.ports);
  await views.open("user", liveOpen("view-tab"));
  await views.open("user", liveOpen("view-card", { place: "card" }));
  await views.open("user", {
    view: "view-preview",
    mode: "preview",
    app: APP,
    release: null,
    screen: "main",
    place: "tab",
  });
  await views.open("user", liveOpen("view-other", { app: OTHER_APP }));

  views.published({
    source: "ops",
    event: "limit",
    payload: { n: 1 },
    audience: [APP],
  });
  views.published({
    source: "ops",
    event: "other",
    payload: null,
    audience: null,
  });
  assert.deepStrictEqual(
    world.published.map(({ payload }) => [payload.view, payload.kind]),
    [
      ["view-tab", "event"],
      ["view-card", "event"],
    ],
  );

  // 새 release가 돈다. tab은 따라가고 card는 묶음을 잃는다.
  world.published.length = 0;
  world.state.running = REL_2;
  await views.changed(APP);
  const byView = new Map(
    world.published.map(({ payload }) => [payload.view, payload]),
  );
  assert.deepStrictEqual(byView.get("view-tab"), {
    owner: "user",
    view: "view-tab",
    kind: "rebound",
    release: REL_2,
    bundle_hash: HASH_2,
    process_nonce: `live-${REL_2}`,
  });
  assert.deepStrictEqual(byView.get("view-card"), {
    owner: "user",
    view: "view-card",
    kind: "lost",
    reason: "conflict",
  });
  assert.equal(byView.has("view-other"), false);

  // owner마다 상한. view-tab을 마지막에 다시 썼으니 가장 오래 안 쓴 것은 view-card다.
  await views.call("user", {
    view: "view-tab",
    operation: "save",
    input: null,
  });
  await views.call("user", {
    view: "view-other",
    operation: "wipe",
    input: null,
  });
  await views.call("user", {
    view: "view-preview",
    operation: "draft",
    input: null,
  });
  await views.open("user", liveOpen("view-other-2", { app: OTHER_APP }));
  world.published.length = 0;
  const filled = VIEWS_PER_OWNER - 5;
  for (let index = 0; index < filled; index++) {
    await views.open(
      "user",
      liveOpen(`fill-${String(index).padStart(4, "0")}`),
    );
  }
  assert.deepStrictEqual(world.published, []);
  // 다른 owner의 view는 이 owner의 상한에 세지 않는다.
  await views.open("device:phone", liveOpen("view-phone"));
  await views.open("user", liveOpen("view-last"));
  assert.deepStrictEqual(world.published, [
    {
      app: APP,
      payload: {
        owner: "user",
        view: "view-card",
        kind: "lost",
        reason: "evicted",
      },
    },
  ]);
  const gone = await views.call("user", {
    view: "view-card",
    operation: "save",
    input: null,
  });
  assert.equal(!gone.ok && gone.error.code, "not_found");
});

test("params가 그 화면 선언의 schema에 맞지 않거나 자리가 선언에 없으면 열기가 거절된다", async () => {
  const views = createAppViews(fakeWorld().ports);
  const detail = (view: string, params?: Record<string, unknown>) =>
    liveOpen(view, {
      screen: "detail",
      place: "panel",
      ...(params === undefined ? {} : { params: params as never }),
    });
  for (const input of [
    detail("view-0001", {}),
    detail("view-0002", { status: 1 }),
    detail("view-0003", { status: "x", extra: 1 }),
    liveOpen("view-0004", { params: { a: 1 } }),
    liveOpen("view-0005", { place: "phone" }),
    liveOpen("view-0006", { screen: "none" }),
  ]) {
    const opened = await views.open("user", input);
    assert.equal(!opened.ok && opened.error.code, "invalid_input");
  }
  assert.deepStrictEqual(
    await views.open("user", detail("view-0007", { status: "open" })),
    ok({
      view: "view-0007",
      release: REL_1,
      bundle_hash: HASH_1,
      process_nonce: `live-${REL_1}`,
      params: { status: "open" },
    }),
  );
});
