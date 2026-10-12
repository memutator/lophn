import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { ObservationWire, PreviewLaunch } from "../runtime/mod.ts";
import {
  createFsPreviewArea,
  createPreviewReads,
  createPreviewService,
  type PreviewBundle,
  previewFlagsViolation,
  type PreviewService,
  type PreviewSupervisor,
  unattachedPreviewService,
} from "./mod.ts";
import { FIXTURE_APP, FIXTURE_RELEASE } from "./world_test.ts";

const APP = FIXTURE_APP;
const OTHER_APP = "app_01arz3ndektsv4rrffq69g5faw";
const HASH = "ab".repeat(32);
const FIXTURE_BYTES = new TextEncoder().encode("fixture database bytes");

const sha = sha256Hex;

function ctxOf(
  actor: string,
  apps: readonly string[] = [APP],
): AuthenticatedContext {
  return {
    principal: `${actor}-1`,
    actor,
    scope: { operations: ["previews.start"], targets: { apps } },
    conditions: {},
    credential_ref: "cred-1",
  } as unknown as AuthenticatedContext;
}

type World = {
  root: string;
  service: PreviewService;
  calls: string[];
  launches: PreviewLaunch[];
  observations: Map<string, ObservationWire | null>;
  stopResults: Result<boolean>[];
  liveReads: { count: number };
  fixtureHash: string;
  close(): Promise<void>;
};

async function open(
  options: {
    bundles?: boolean;
    releases?: Record<string, string>;
    nonces?: string[];
  } = {},
): Promise<World> {
  const root = await Deno.makeTempDir({ prefix: "lop-pvs-" });
  // 운영 data는 preview가 닿으면 안 되는 값이다.
  await Deno.mkdir(`${root}/apps/${APP}/data`, { recursive: true });
  await Deno.writeTextFile(`${root}/apps/${APP}/data/app.sqlite`, "LIVE");
  await Deno.mkdir(`${root}/apps/${APP}/backups`, { recursive: true });
  await Deno.writeTextFile(`${root}/apps/${APP}/backups/one.bak`, "BACKUP");
  const calls: string[] = [];
  const launches: PreviewLaunch[] = [];
  const observations = new Map<string, ObservationWire | null>();
  const stopResults: Result<boolean>[] = [];
  const liveReads = { count: 0 };
  const supervisor: PreviewSupervisor = {
    start(launch) {
      calls.push(`start:${launch.nonce}`);
      launches.push(launch);
      return Promise.resolve(ok(undefined));
    },
    observe(app, nonce) {
      calls.push(`observe:${nonce}`);
      return Promise.resolve(
        ok(
          observations.has(nonce)
            ? observations.get(nonce)!
            : wireOf(app, nonce, { ready: false }),
        ),
      );
    },
    stop(_app, nonce) {
      calls.push(`stop:${nonce}`);
      return Promise.resolve(stopResults.shift() ?? ok(true));
    },
  };
  const bundle: PreviewBundle = {
    entry: `${root}/apps/${APP}/bundles/${HASH}/main.ts`,
    importMap: `${root}/apps/${APP}/bundles/${HASH}/import-map.json`,
    commands: ["usage.read"],
    screens: { usage: ["full"] },
    dataSchema: 2,
    async fixture(hash) {
      return hash === await sha(FIXTURE_BYTES) ? FIXTURE_BYTES : undefined;
    },
    flags(dataPath) {
      return ok({
        args: [
          "--no-prompt",
          `--allow-read=${root}/apps/${APP}/bundles/${HASH},${dataPath}`,
          `--allow-write=${dataPath}`,
        ],
        limits: [],
      });
    },
  };
  let counter = 0;
  const nonces = options.nonces ?? [];
  const service = createPreviewService({
    clock: manualClock(Date.parse("2026-10-04T00:00:00.000Z")),
    nonce: () => nonces.shift() ?? `nonce-${(counter += 1)}-aaaaaaaa`,
    supervisor,
    area: createFsPreviewArea(root),
    apps: {
      exists(app) {
        liveReads.count += 1;
        return Promise.resolve(ok(app === APP));
      },
    },
    // APP만 이 credential의 범위 안이다. 그 밖은 forbidden이고 service가 없는 앱처럼 답한다.
    authorize(ctx, operation, target) {
      void operation;
      const apps = (ctx.scope.targets as { apps?: string[] }).apps ?? [];
      return apps.includes(target.app) ? ok(undefined) : {
        ok: false,
        error: { code: "forbidden", message: "outside scope" },
      };
    },
    ...(options.bundles === false ? {} : {
      bundles: {
        open(app, hash) {
          return Promise.resolve(
            ok(app === APP && hash === HASH ? bundle : undefined),
          );
        },
      },
    }),
    ...(options.releases
      ? {
        releases: {
          bundleOf(app, release) {
            return Promise.resolve(
              ok(app === APP ? options.releases![release] : undefined),
            );
          },
        },
      }
      : {}),
  });
  return {
    root,
    service,
    calls,
    launches,
    observations,
    stopResults,
    liveReads,
    fixtureHash: await sha(FIXTURE_BYTES),
    close: () => Deno.remove(root, { recursive: true }),
  };
}

function wireOf(
  app: string,
  nonce: string,
  overrides: Partial<ObservationWire> = {},
): ObservationWire {
  return {
    app,
    release: null,
    mode: "preview",
    bundle_hash: HASH,
    process_nonce: nonce,
    endpoint: "/run/p.sock",
    commands: ["usage.read"],
    screens: { usage: ["full"] },
    ready: true,
    accepting: true,
    ...overrides,
  };
}

const input = (overrides: Record<string, unknown> = {}) => ({
  input: {
    app: APP,
    bundle_hash: HASH,
    release: null,
    fixture_hash: null,
    ...overrides,
  },
});

async function entries(path: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(path)) names.push(entry.name);
  return names.sort();
}

Deno.test("apps/preview#R1: release 없는 bundle도 열리고 supervisor에는 preview 호출만 간다", async () => {
  const world = await open();
  try {
    const started = await world.service.start(ctxOf("user"), input());
    assert(started.ok);
    assertEquals(started.value.ready, false);
    const launch = world.launches[0];
    assertEquals(launch.release, null);
    assertEquals(launch.bundleHash, HASH);
    assertEquals(launch.nonce, started.value.process_nonce);
    assertEquals(launch.commands, ["usage.read"]);
    assertEquals(launch.dataSchema, 2);
    // reconcile·restart 같은 운영 자식 호출은 이 통로에 없다. 시작 하나만 갔다.
    assertEquals(world.calls, [`start:${launch.nonce}`]);
    // coding agent도 연다.
    const again = await world.service.start(ctxOf("coding_agent"), input());
    assert(again.ok);
    assertEquals(world.calls.at(-2), `stop:${launch.nonce}`);
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R1: 범위 밖 앱과 없는 앱은 같은 not_found이고 사람·coding agent 밖의 자격은 쓰지 못한다", async () => {
  const world = await open();
  try {
    const outside = ctxOf("user", []);
    const results = [
      await world.service.start(outside, input()),
      await world.service.start(
        ctxOf("user", [OTHER_APP]),
        input({
          app: OTHER_APP,
        }),
      ),
      await world.service.get(outside, { app: APP }),
      await world.service.stop(outside, { app: APP, process_nonce: "nonce-1" }),
    ];
    for (const result of results) {
      assert(!result.ok);
      assertEquals(result.error.code, "not_found");
    }
    // 범위 안이지만 없는 앱도 같은 응답이다.
    const missing = await world.service.start(
      ctxOf("user", [OTHER_APP]),
      input({ app: OTHER_APP }),
    );
    assert(!missing.ok);
    assertEquals(missing.error, results[0].ok ? undefined : results[0].error);
    for (const actor of ["machine", "agent", "app:" + APP]) {
      const refused = await world.service.start(ctxOf(actor), input());
      assert(!refused.ok, actor);
      assertEquals(refused.error.code, "forbidden", actor);
    }
    // 어느 것도 supervisor에 닿지 않았고 영역도 만들지 않았다.
    assertEquals(world.calls, []);
    assertEquals(await entries(`${world.root}/apps/${APP}`), [
      "backups",
      "data",
    ]);
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R2: preview 영역은 fixture만 담은 새 폴더이고 운영 DB·backup은 복사하지 않으며 종료 뒤 폐기한다", async () => {
  const world = await open();
  try {
    const started = await world.service.start(
      ctxOf("user"),
      input({ fixture_hash: world.fixtureHash }),
    );
    assert(started.ok);
    const nonce = started.value.process_nonce;
    const directory = `${world.root}/apps/${APP}/preview/${nonce}`;
    assertEquals(world.launches[0].dataPath, directory);
    // 영역에는 fixture byte와 빈 files 자리뿐이다.
    assertEquals(await entries(directory), ["app.sqlite", "files"]);
    assertEquals(await Deno.readFile(`${directory}/app.sqlite`), FIXTURE_BYTES);
    assertEquals(await entries(`${directory}/files`), []);
    // 운영 data와 backup은 그대로다.
    assertEquals(
      await Deno.readTextFile(`${world.root}/apps/${APP}/data/app.sqlite`),
      "LIVE",
    );
    assertEquals(
      await Deno.readTextFile(`${world.root}/apps/${APP}/backups/one.bak`),
      "BACKUP",
    );
    // 운영 앱과 같은 flag 계산에 이 영역을 data로 준 결과가 preview 규칙을 지킨다.
    assertEquals(previewFlagsViolation(world.launches[0]), undefined);
    // preview에서 바꾼 파일은 영역 안에서만 바뀐다. 종료하면 영역이 사라진다.
    await Deno.writeTextFile(`${directory}/files/note.txt`, "edited");
    const stopped = await world.service.stop(ctxOf("user"), {
      app: APP,
      process_nonce: nonce,
    });
    assert(stopped.ok);
    assertEquals(
      await Deno.stat(directory).then(() => true, () => false),
      false,
    );
    assertEquals(
      await Deno.readTextFile(`${world.root}/apps/${APP}/data/app.sqlite`),
      "LIVE",
    );
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R2: bundle에 없는 fixture는 invalid_input이고 영역도 프로세스도 만들지 않는다", async () => {
  const world = await open();
  try {
    const started = await world.service.start(
      ctxOf("user"),
      input({ fixture_hash: "cd".repeat(32) }),
    );
    assert(!started.ok);
    assertEquals(started.error.code, "invalid_input");
    assertEquals(world.calls, []);
    assertEquals(
      await Deno.stat(`${world.root}/apps/${APP}/preview`).then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R2: 시작 입력이 supervisor에서 거절되면 만든 영역을 지운다", async () => {
  const world = await open();
  try {
    // supervisor가 시작을 받지 못하는 service다.
    const failing = createPreviewService({
      clock: manualClock(0),
      nonce: () => "nonce-reject-002",
      supervisor: {
        start: () =>
          Promise.resolve({
            ok: false as const,
            error: { code: "unavailable" as const, message: "down" },
          }),
        observe: () => Promise.resolve(ok(null)),
        stop: () => Promise.resolve(ok(true)),
      },
      area: createFsPreviewArea(world.root),
      apps: { exists: () => Promise.resolve(ok(true)) },
      authorize: () => ok(undefined),
      bundles: {
        open: () =>
          Promise.resolve(ok({
            entry: "/x/main.ts",
            importMap: "/x/map.json",
            commands: [],
            screens: {},
            dataSchema: 0,
            fixture: () => Promise.resolve(undefined),
            flags: () => ok({ args: [], limits: [] }),
          })),
      },
    });
    const started = await failing.start(ctxOf("user"), input());
    assert(!started.ok);
    assertEquals(started.error.code, "unavailable");
    assertEquals(
      await Deno.stat(`${world.root}/apps/${APP}/preview/nonce-reject-002`)
        .then(() => true, () => false),
      false,
    );
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R3: 종료한 preview의 관측은 없고 다시 정지하면 not_found이며 종료 미확인이면 영역을 남긴다", async () => {
  const world = await open();
  try {
    const started = await world.service.start(ctxOf("user"), input());
    assert(started.ok);
    const nonce = started.value.process_nonce;
    const directory = `${world.root}/apps/${APP}/preview/${nonce}`;
    // 종료를 확인하지 못하면 영역을 지우지 않고 preview도 그대로 남는다.
    world.stopResults.push({
      ok: false,
      error: { code: "unavailable", message: "not confirmed" },
    });
    const unconfirmed = await world.service.stop(ctxOf("user"), {
      app: APP,
      process_nonce: nonce,
    });
    assert(!unconfirmed.ok);
    assertEquals(unconfirmed.error.code, "unavailable");
    assertEquals(await entries(directory), ["files"]);
    const stopped = await world.service.stop(ctxOf("user"), {
      app: APP,
      process_nonce: nonce,
    });
    assert(stopped.ok);
    assertEquals(stopped.value, { stopped: true });
    const seen = await world.service.get(ctxOf("user"), {
      app: APP,
      process_nonce: nonce,
    });
    assert(seen.ok);
    assertEquals(seen.value, { observation: null, observed_at: null });
    const twice = await world.service.stop(ctxOf("user"), {
      app: APP,
      process_nonce: nonce,
    });
    assert(!twice.ok);
    assertEquals(twice.error.code, "not_found");
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R7: 관측은 mode=preview이고 연결 주소·accepting을 내지 않으며 준비 전 이유를 붙인다", async () => {
  const world = await open();
  try {
    const started = await world.service.start(ctxOf("user"), input());
    assert(started.ok);
    const nonce = started.value.process_nonce;
    world.observations.set(
      nonce,
      wireOf(APP, nonce, { ready: false, accepting: false, reason: undefined }),
    );
    const starting = await world.service.get(ctxOf("user"), { app: APP });
    assert(starting.ok && starting.value.observation !== null);
    assertEquals(starting.value.observation.mode, "preview");
    assertEquals(starting.value.observation.endpoint, null);
    assertEquals(starting.value.observation.accepting, false);
    assertEquals(starting.value.observation.ready, false);
    assertEquals(starting.value.observation.reason?.code, "starting");
    assertEquals(starting.value.observed_at, "2026-10-04T00:00:00.000Z");
    world.observations.set(nonce, wireOf(APP, nonce));
    const ready = await world.service.get(ctxOf("user"), {
      app: APP,
      process_nonce: nonce,
    });
    assert(ready.ok && ready.value.observation !== null);
    assertEquals(ready.value.observation.ready, true);
    assertEquals(ready.value.observation.release, null);
    assertEquals(ready.value.observation.process_nonce, nonce);
    // 다른 nonce는 이 service가 모르는 preview다.
    const other = await world.service.get(ctxOf("user"), {
      app: APP,
      process_nonce: "nonce-other-1",
    });
    assert(other.ok);
    assertEquals(other.value.observation, null);
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R3: supervisor가 모르는 preview(재시작)는 관측 없음이고 영역을 정리한다", async () => {
  const world = await open();
  try {
    const started = await world.service.start(ctxOf("user"), input());
    assert(started.ok);
    const nonce = started.value.process_nonce;
    world.observations.set(nonce, null);
    const seen = await world.service.get(ctxOf("user"), { app: APP });
    assert(seen.ok);
    assertEquals(seen.value.observation, null);
    assertEquals(
      await Deno.stat(`${world.root}/apps/${APP}/preview/${nonce}`).then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R9: release를 주면 같은 앱·같은 bundle의 release만 받고 남의 release는 없는 것과 같다", async () => {
  const world = await open({
    releases: {
      [FIXTURE_RELEASE]: HASH,
      rel_01arz3ndektsv4rrffq69g5faw: "cd".repeat(32),
    },
  });
  try {
    const ok1 = await world.service.start(
      ctxOf("user"),
      input({ release: FIXTURE_RELEASE }),
    );
    assert(ok1.ok);
    assertEquals(world.launches[0].release, FIXTURE_RELEASE);
    const mismatch = await world.service.start(
      ctxOf("user"),
      input({ release: "rel_01arz3ndektsv4rrffq69g5faw" }),
    );
    assert(!mismatch.ok);
    assertEquals(mismatch.error.code, "conflict");
    const unknown = await world.service.start(
      ctxOf("user"),
      input({ release: "rel_01arz3ndektsv4rrffq69g5fax" }),
    );
    assert(!unknown.ok);
    assertEquals(unknown.error.code, "not_found");
    // 거절된 요청은 이미 뜬 preview를 건드리지 않는다.
    assertEquals(world.calls.filter((call) => call.startsWith("stop:")), []);
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R9: release를 확인할 자리가 없으면 release가 있는 시작은 unavailable이고 release 없는 시작은 열린다", async () => {
  const world = await open();
  try {
    const withRelease = await world.service.start(
      ctxOf("user"),
      input({ release: FIXTURE_RELEASE }),
    );
    assert(!withRelease.ok);
    assertEquals(withRelease.error.code, "unavailable");
    assertEquals(world.calls, []);
    const bare = await world.service.start(ctxOf("user"), input());
    assert(bare.ok);
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R1: bundle을 여는 자리가 없으면 시작은 unavailable이고 조회·종료는 그대로 된다", async () => {
  const world = await open({ bundles: false });
  try {
    const started = await world.service.start(ctxOf("user"), input());
    assert(!started.ok);
    assertEquals(started.error.code, "unavailable");
    const seen = await world.service.get(ctxOf("user"), { app: APP });
    assert(seen.ok);
    assertEquals(seen.value.observation, null);
    // 연결하지 않은 core의 기본 service는 모두 unavailable이다.
    const down = unattachedPreviewService();
    for (
      const result of [
        await down.start(ctxOf("user"), input()),
        await down.get(ctxOf("user"), { app: APP }),
        await down.stop(ctxOf("user"), { app: APP, process_nonce: "n" }),
      ]
    ) {
      assert(!result.ok);
      assertEquals(result.error.code, "unavailable");
    }
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R10: preview 시작·종료는 운영 앱의 사실을 읽기 외에 바꾸지 않는다", async () => {
  const world = await open();
  try {
    const before = await Deno.readTextFile(
      `${world.root}/apps/${APP}/data/app.sqlite`,
    );
    const started = await world.service.start(ctxOf("user"), input());
    assert(started.ok);
    await world.service.stop(ctxOf("user"), {
      app: APP,
      process_nonce: started.value.process_nonce,
    });
    // service의 의존에는 활성 참조·run_enabled·grant를 쓰는 자리가 없다(읽기 exists뿐). supervisor에는
    // preview 시작·정지만 갔고 운영 data는 같다.
    assertEquals(world.calls.map((call) => call.split(":")[0]), [
      "start",
      "stop",
    ]);
    assertEquals(
      await Deno.readTextFile(`${world.root}/apps/${APP}/data/app.sqlite`),
      before,
    );
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R2: core 시작은 지난 실행의 preview 영역을 모두 지우고 운영 data는 건드리지 않는다", async () => {
  const world = await open();
  try {
    await Deno.mkdir(`${world.root}/apps/${APP}/preview/old-nonce-0001/files`, {
      recursive: true,
    });
    await Deno.mkdir(`${world.root}/apps/${OTHER_APP}/preview/old-nonce-0002`, {
      recursive: true,
    });
    await world.service.discardStale();
    for (const app of [APP, OTHER_APP]) {
      assertEquals(
        await Deno.stat(`${world.root}/apps/${app}/preview`).then(
          () => true,
          () => false,
        ),
        false,
      );
    }
    assertEquals(await entries(`${world.root}/apps/${APP}`), [
      "backups",
      "data",
    ]);
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R1: /v1/previews 읽기는 입력을 route schema로 검사하고 service 결과를 그대로 낸다", async () => {
  const world = await open();
  try {
    const [start, get, stop] = createPreviewReads(() => world.service);
    assertEquals(
      [start.route.name, get.route.name, stop.route.name],
      ["previews.start", "previews.get", "previews.stop"],
    );
    const invalid = await start.handle(
      ctxOf("user"),
      { input: { app: 1 } } as never,
    );
    assert(!invalid.ok);
    assertEquals(invalid.error.code, "invalid_input");
    const extra = await get.handle(ctxOf("user"), {
      app: APP,
      unknown: true,
    } as never);
    assert(!extra.ok);
    assertEquals(extra.error.code, "invalid_input");
    const started = await start.handle(ctxOf("user"), input() as never);
    assert(started.ok);
    const nonce = (started.value as { process_nonce: string }).process_nonce;
    const seen = await get.handle(ctxOf("user"), { app: APP } as never);
    assert(seen.ok);
    const stopped = await stop.handle(
      ctxOf("user"),
      { app: APP, process_nonce: nonce } as never,
    );
    assert(stopped.ok);
    assertEquals(stopped.value, { stopped: true });
  } finally {
    await world.close();
  }
});
