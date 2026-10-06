import { assert, assertEquals } from "@std/assert";
import {
  createPreviewLauncher,
  type PreviewLauncher,
  validNonce,
} from "./mod.ts";
import { type PreviewLaunch, previewNonceSchema } from "../runtime/mod.ts";
import {
  type FakeChild,
  fakeChild,
  fakeDeps,
  FIXTURE_APP,
  FIXTURE_RELEASE,
} from "./world_test.ts";

const HASH = "ab".repeat(32);
const ROOT = "/data";

function launchOf(overrides: Partial<PreviewLaunch> = {}): PreviewLaunch {
  const nonce = overrides.nonce ?? "nonce-aaaa1111";
  const app = overrides.app ?? FIXTURE_APP;
  const dataPath = `${ROOT}/apps/${app}/preview/${nonce}`;
  return {
    app,
    nonce,
    release: null,
    bundleHash: HASH,
    commands: ["usage.read", "usage.save"],
    screens: { usage: ["full", "panel"] },
    dataSchema: 0,
    flags: {
      args: [
        "--no-prompt",
        `--allow-read=${ROOT}/apps/${app}/bundles/${HASH},${dataPath}`,
        `--allow-write=${dataPath}`,
      ],
      limits: [],
    },
    entry: `${ROOT}/apps/${app}/bundles/${HASH}/main.ts`,
    importMap: `${ROOT}/apps/${app}/bundles/${HASH}/import-map.json`,
    dataPath,
    ...overrides,
  };
}

async function settle(
  launcher: PreviewLauncher,
  launch: PreviewLaunch,
  until: (seen: ReturnType<PreviewLauncher["observation"]>) => boolean,
) {
  for (let i = 0; i < 200; i++) {
    const seen = launcher.observation(launch.app, launch.nonce);
    if (until(seen)) return seen;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("preview did not settle");
}

const ready = (seen: ReturnType<PreviewLauncher["observation"]>) =>
  seen?.ready === true && seen.accepting;

Deno.test("apps/preview#R1: release 없는 bundle도 preview 자식으로 열리고 시작 입력의 release는 null이다", async () => {
  const { deps, spawns } = fakeDeps();
  const launcher = createPreviewLauncher(deps);
  const launch = launchOf();
  assertEquals(launcher.start(launch).ok, true);
  const seen = await settle(launcher, launch, ready);
  assertEquals(spawns.length, 1);
  const line = JSON.parse(spawns[0].startLine);
  // 운영 자식과 같은 시작 입력 모양이되 mode와 release만 다르다.
  assertEquals(line.mode, "preview");
  assertEquals(line.release, null);
  assertEquals(line.bundle_hash, HASH);
  assertEquals(line.process_nonce, launch.nonce);
  assertEquals(line.data_path, launch.dataPath);
  assertEquals(seen?.mode, "preview");
  assertEquals(seen?.release, null);
  assertEquals(seen?.screens, { usage: ["full", "panel"] });
});

Deno.test("apps/preview#R9: 준비된 release가 있으면 그 release를, 없으면 어떤 release도 꾸며 넣지 않는다", async () => {
  const { deps, spawns } = fakeDeps();
  const launcher = createPreviewLauncher(deps);
  const bare = launchOf({ nonce: "nonce-bare0001" });
  assertEquals(launcher.start(bare).ok, true);
  await settle(launcher, bare, ready);
  assertEquals(JSON.parse(spawns[0].startLine).release, null);
  assertEquals(spawns[0].release, null);
  const released = launchOf({
    nonce: "nonce-rel00001",
    release: FIXTURE_RELEASE,
  });
  assertEquals(launcher.start(released).ok, true);
  await settle(launcher, released, ready);
  assertEquals(JSON.parse(spawns[1].startLine).release, FIXTURE_RELEASE);
});

Deno.test("apps/preview#R2: disposable 영역 밖을 쓰거나 운영 data를 읽거나 net을 여는 flag는 시작하지 않는다", () => {
  const { deps, spawns } = fakeDeps();
  const launcher = createPreviewLauncher(deps);
  const good = launchOf();
  const live = `${ROOT}/apps/${FIXTURE_APP}/data`;
  const cases: Record<string, string[]> = {
    "write outside": [`--allow-write=${good.dataPath},${live}`],
    "read live data": [`--allow-read=${live}`],
    "read inside live data": [`--allow-read=${live}/data.db`],
    "read the app folder above live data": [
      `--allow-read=${ROOT}/apps/${FIXTURE_APP}`,
    ],
    "network": ["--allow-net=example.com:443"],
    "loopback network": ["--allow-net=127.0.0.1:4000"],
    "all permissions": ["--allow-all"],
    "run": ["--allow-run"],
  };
  for (const [name, extra] of Object.entries(cases)) {
    const started = launcher.start({
      ...good,
      nonce: "nonce-bad00001",
      dataPath: `${ROOT}/apps/${FIXTURE_APP}/preview/nonce-bad00001`,
      flags: { args: [...good.flags.args.slice(0, 1), ...extra], limits: [] },
    });
    assert(!started.ok, name);
    assertEquals(started.ok ? "" : started.error.code, "invalid_input", name);
  }
  // 운영 data 자리나 다른 앱의 영역을 가리키는 data path는 preview 영역이 아니다.
  for (
    const dataPath of [
      live,
      `${ROOT}/apps/${FIXTURE_APP}/preview/other-nonce-1`,
      `${ROOT}/apps/${FIXTURE_APP}/preview/../data`,
    ]
  ) {
    const started = launcher.start({ ...good, dataPath });
    assert(!started.ok, dataPath);
  }
  assertEquals(spawns.length, 0);
});

Deno.test("apps/preview#R3: 종료한 preview는 관측이 없고 다시 정지해도 모르는 preview다", async () => {
  const { deps } = fakeDeps();
  const launcher = createPreviewLauncher(deps);
  const launch = launchOf();
  launcher.start(launch);
  await settle(launcher, launch, ready);
  const stopped = await launcher.stop(launch.app, launch.nonce);
  assertEquals(stopped, { ok: true, value: true });
  assertEquals(launcher.observation(launch.app, launch.nonce), null);
  // 같은 nonce를 다시 정지하거나 다른 nonce를 정지해도 아무것도 하지 않는다.
  assertEquals(await launcher.stop(launch.app, launch.nonce), {
    ok: true,
    value: false,
  });
  assertEquals(await launcher.stop(launch.app, "nonce-other001"), {
    ok: true,
    value: false,
  });
});

Deno.test("apps/preview#R3: 종료를 확인하지 못하면 정지는 unavailable이고 자식을 놓지 않는다", async () => {
  const { deps } = fakeDeps({
    spawn: (request) => Promise.resolve(fakeChild(request, { confirm: false })),
  });
  const launcher = createPreviewLauncher(deps);
  const launch = launchOf();
  launcher.start(launch);
  await settle(launcher, launch, ready);
  const stopped = await launcher.stop(launch.app, launch.nonce);
  assert(!stopped.ok);
  assertEquals(stopped.error.code, "unavailable");
  // 종료를 확인하지 못한 자식은 ready가 아니며 다시 정지를 시도할 수 있다.
  assertEquals(launcher.observation(launch.app, launch.nonce)?.ready, false);
});

Deno.test("apps/preview#R7: preview 관측은 mode=preview이고 nonce가 다른 질의에는 답하지 않는다", async () => {
  const { deps } = fakeDeps();
  const launcher = createPreviewLauncher(deps);
  const launch = launchOf();
  launcher.start(launch);
  const seen = await settle(launcher, launch, ready);
  assertEquals(seen?.mode, "preview");
  assertEquals(seen?.process_nonce, launch.nonce);
  assertEquals(launcher.observation(launch.app, "nonce-other001"), null);
  assertEquals(
    launcher.observation("app_01arz3ndektsv4rrffq69g5faw", launch.nonce),
    null,
  );
});

Deno.test("apps/preview#R3: 같은 앱의 새 preview는 이전 preview의 종료를 확인한 뒤에 뜬다", async () => {
  const events: string[] = [];
  const children = new Map<string, FakeChild>();
  const { deps } = fakeDeps({
    spawn(request) {
      events.push(`spawn:${request.nonce}`);
      const child = fakeChild(request);
      const terminate = child.terminate.bind(child);
      child.terminate = () => {
        events.push(`terminate:${request.nonce}`);
        return terminate();
      };
      children.set(request.nonce, child);
      return Promise.resolve(child);
    },
  });
  const launcher = createPreviewLauncher(deps);
  const first = launchOf({ nonce: "nonce-first001" });
  const second = launchOf({ nonce: "nonce-second01" });
  launcher.start(first);
  await settle(launcher, first, ready);
  launcher.start(second);
  await settle(launcher, second, ready);
  assertEquals(events, [
    "spawn:nonce-first001",
    "terminate:nonce-first001",
    "spawn:nonce-second01",
  ]);
  // 이전 nonce는 더 이상 관측되지 않는다. 같은 nonce를 다시 시작할 수도 없다.
  assertEquals(launcher.observation(first.app, first.nonce), null);
  const again = launcher.start(second);
  assert(!again.ok);
  assertEquals(again.error.code, "conflict");
});

Deno.test("apps/preview#R3: 스스로 끝난 preview는 다시 띄우지 않고 사용할 수 없는 이유를 남긴다", async () => {
  const children: FakeChild[] = [];
  const { deps } = fakeDeps({
    spawn(request) {
      const child = fakeChild(request);
      children.push(child);
      return Promise.resolve(child);
    },
  });
  const launcher = createPreviewLauncher(deps);
  const launch = launchOf();
  launcher.start(launch);
  await settle(launcher, launch, ready);
  children[0].exit(1);
  const seen = await settle(launcher, launch, (s) => s?.ready === false);
  assertEquals(seen?.reason?.code, "unexpected_exit");
  assertEquals(seen?.accepting, false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // 운영 앱과 달리 재시작 정책이 없고, 종료를 확인하면 연결할 곳도 없다.
  assertEquals(children.length, 1);
  assertEquals(launcher.observation(launch.app, launch.nonce)?.endpoint, "");
  assertEquals(children[0].killed, true);
});

Deno.test("apps/preview#R1: 준비 검사가 다른 bundle이나 command를 말하면 시작 실패이고 자식을 끝낸다", async () => {
  for (
    const probe of [
      { bundleHash: "cd".repeat(32), commands: ["usage.read", "usage.save"] },
      { bundleHash: HASH, commands: ["usage.read"] },
    ]
  ) {
    const children: FakeChild[] = [];
    const { deps } = fakeDeps({
      spawn(request) {
        const child = fakeChild(request);
        children.push(child);
        return Promise.resolve(child);
      },
      probe: () => ({ ok: true, dataSchema: 0, ...probe }),
    });
    const launcher = createPreviewLauncher(deps);
    const launch = launchOf();
    launcher.start(launch);
    const seen = await settle(
      launcher,
      launch,
      (s) => s?.reason !== undefined && s.reason.code !== "starting",
    );
    assertEquals(seen?.ready, false);
    assertEquals(seen?.reason?.code, "start_failed");
    assertEquals(children[0].killed, true);
  }
});

Deno.test("apps/preview#R4: broker 통로는 자식 하나에 붙고 종료·시작 실패에서 닫힌다", async () => {
  const attached: string[] = [];
  const detached: string[] = [];
  const { deps } = fakeDeps({
    attachBroker(child, _launch, credential) {
      attached.push(`${child.processNonce}:${child.release}:${credential}`);
      return () => detached.push(child.processNonce);
    },
  });
  const launcher = createPreviewLauncher(deps);
  const launch = launchOf();
  launcher.start(launch);
  await settle(launcher, launch, ready);
  assertEquals(attached, [`${launch.nonce}:null:local-credential`]);
  assertEquals(detached, []);
  await launcher.stop(launch.app, launch.nonce);
  assertEquals(detached, [launch.nonce]);
});

Deno.test("apps/preview#R1: supervisor가 멈추면 모든 preview를 끝내고 새 preview를 받지 않는다", async () => {
  const children: FakeChild[] = [];
  const { deps } = fakeDeps({
    spawn(request) {
      const child = fakeChild(request);
      children.push(child);
      return Promise.resolve(child);
    },
  });
  const launcher = createPreviewLauncher(deps);
  const one = launchOf({ nonce: "nonce-one00001" });
  const two = launchOf({
    nonce: "nonce-two00001",
    app: "app_01arz3ndektsv4rrffq69g5faw",
  });
  launcher.start(one);
  launcher.start(two);
  await settle(launcher, one, ready);
  await settle(launcher, two, ready);
  await launcher.stopAll();
  assertEquals(children.map((child) => child.killed), [true, true]);
  const late = launcher.start(launchOf({ nonce: "nonce-late0001" }));
  assert(!late.ok);
  assertEquals(late.error.code, "unavailable");
});

Deno.test("apps/preview#R1: 입력이 PreviewLaunch 모양이 아니면 invalid_input이다", () => {
  const { deps } = fakeDeps();
  const launcher = createPreviewLauncher(deps);
  const bad = launcher.start({ app: "nope" } as unknown as PreviewLaunch);
  assert(!bad.ok);
  assertEquals(bad.error.code, "invalid_input");
});

Deno.test("apps/preview#R2: core 쪽 nonce 검사는 supervisor wire의 nonce 규칙과 같고 경로를 벗어나는 값을 받지 않는다", () => {
  for (
    const value of [
      "nonce-aaaa1111",
      "b090ea4e-68be-42f2-895a-c85c7d40311e",
      "short",
      "../escape-1234",
      "has/slash-1234",
      "has.dot-12345",
      "a".repeat(65),
      "a".repeat(64),
      "",
    ]
  ) {
    assertEquals(
      validNonce(value),
      previewNonceSchema.safeParse(value).success,
      value,
    );
  }
  assertEquals(validNonce("../escape-1234"), false);
});

Deno.test("apps/preview#R3: 띄우는 중에 정지하면 준비 확인 없이 자식을 끝내고 종료 확인 뒤 true를 답한다", async () => {
  const children: FakeChild[] = [];
  let finish: () => void = () => {};
  let probed = 0;
  const { deps } = fakeDeps({
    spawn(request) {
      const child = fakeChild(request);
      children.push(child);
      return new Promise((resolve) => {
        finish = () => resolve(child);
      });
    },
    probe: () => {
      probed += 1;
      return { ok: false, reason: "must not be asked" };
    },
  });
  const launcher = createPreviewLauncher(deps);
  const launch = launchOf();
  launcher.start(launch);
  for (let i = 0; i < 50 && children.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const stopping = launcher.stop(launch.app, launch.nonce);
  finish();
  assertEquals(await stopping, { ok: true, value: true });
  assertEquals(children[0].killed, true);
  assertEquals(probed, 0);
  assertEquals(launcher.observation(launch.app, launch.nonce), null);
});
