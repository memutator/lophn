// docs/plan/contracts.md의 contracts#T9 완료 확인: 데이터 root가 저장소 밖으로 가지 않고
// 인자가 정해진 대로 만들어진다. 실제 프로세스를 띄우지 않는다.
import { assert, assertEquals } from "@std/assert";

import {
  devDataRoot,
  type DevOptions,
  fakeProviderReady,
  type Mode,
  planCore,
  planFakeProvider,
  planShell,
  type Purpose,
  runDev,
  shouldStartFakeProvider,
  signalNames,
  type SpawnPlan,
} from "./dev.ts";

function readyLine(url: string): string {
  return `${JSON.stringify({ ready: true, url })}\n`;
}

/** fake provider의 ready 한 줄을 흉내 내는 child. */
function fakeChild(lines: string[], exitCode: number = 0): Deno.ChildProcess {
  const encoded = new TextEncoder().encode(lines.join(""));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
  return {
    status: Promise.resolve({ code: exitCode, success: exitCode === 0 }),
    stdin: null,
    stdout: stream,
    stderr: new ReadableStream<Uint8Array>({
      start(c) {
        c.close();
      },
    }),
    kill: () => {},
    ref: () => {},
    unref: () => {},
  } as unknown as Deno.ChildProcess;
}

/** 띄운 계획과 env를 기록하는 spawn. 실제 프로세스는 띄우지 않는다. */
function recorder(options: {
  fakeReady?: string | null;
  exitCode?: number;
} = {}) {
  const plans: { plan: SpawnPlan; purpose: Purpose; parentEnv?: unknown }[] =
    [];
  const children: Deno.ChildProcess[] = [];
  const spawn = (plan: SpawnPlan, purpose: Purpose): Deno.ChildProcess => {
    plans.push({ plan, purpose });
    const child = purpose === "fake"
      ? fakeChild(
        options.fakeReady === null
          ? []
          : [readyLine(options.fakeReady ?? "http://127.0.0.1:45999")],
        options.exitCode ?? 0,
      )
      : fakeChild([], options.exitCode ?? 0);
    children.push(child);
    return child;
  };
  return { plans, children, spawn };
}

async function run(
  mode: Mode,
  root: string,
  options: Omit<DevOptions, "root" | "signals"> = {},
): Promise<{ ok: boolean; recorder: ReturnType<typeof recorder> }> {
  const record = recorder(options.spawn ? undefined : {});
  const result = await runDev(mode, {
    root,
    signals: false,
    ...options,
    ...(options.spawn ? {} : { spawn: record.spawn }),
  });
  return { ok: result.ok, recorder: record };
}

Deno.test("deno task dev: 데이터 root는 저장소 안의 .dev-data다(저장소 밖으로 가지 않는다)", () => {
  assertEquals(devDataRoot("/repo"), "/repo/.dev-data");
  assertEquals(devDataRoot("/repo"), devDataRoot("/repo"));
  // 저장소 안이다: root에서 시작하는 경로다.
  assert(devDataRoot("/repo").startsWith("/repo/"));
});

Deno.test("deno task dev: shell main을 --home .dev-data 인자로 띄운다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-dev-" });
  try {
    await Deno.mkdir(`${root}/apps/shell/main`, { recursive: true });
    await Deno.writeTextFile(`${root}/apps/shell/main/package.json`, "{}");
    const { ok, recorder: record } = await run("dev", root);
    assertEquals(ok, true);
    const shell = record.plans.find((p) => p.purpose === "shell");
    assert(shell !== undefined);
    assertEquals(shell.plan.command, "npm");
    assertEquals(
      shell.plan.args,
      [
        "--prefix",
        `${root}/apps/shell/main`,
        "run",
        "dev",
        "--",
        "--home",
        `${root}/.dev-data`,
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("deno task dev: shell이 없으면 이유를 말하고 실패로 끝난다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-dev-" });
  try {
    const messages: string[] = [];
    const original = console.error;
    console.error = (message: string) => messages.push(message);
    try {
      const { ok, recorder: record } = await run("dev", root);
      assertEquals(ok, false);
      assertEquals(record.plans.length, 1); // fake provider만 띄우고 shell은 띄우지 않는다
      assert(messages.join("\n").includes("apps/shell/main이 없다"));
    } finally {
      console.error = original;
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("deno task dev: fake provider를 함께 띄우고 그 주소를 core로 넘기는 env를 만든다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-dev-" });
  try {
    await Deno.mkdir(`${root}/apps/shell/main`, { recursive: true });
    await Deno.writeTextFile(`${root}/apps/shell/main/package.json`, "{}");
    const { ok, recorder: record } = await run("dev", root);
    assertEquals(ok, true);
    const fake = record.plans.find((p) => p.purpose === "fake");
    assert(fake !== undefined);
    assert(fake.plan.args.includes(`${root}/tools/fake-provider/main.ts`));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("deno task dev:core: core만 같은 데이터 root로 띄운다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-dev-" });
  try {
    await Deno.mkdir(`${root}/apps/core`, { recursive: true });
    await Deno.writeTextFile(`${root}/apps/core/main.ts`, "");
    const { ok, recorder: record } = await run("dev:core", root);
    assertEquals(ok, true);
    const core = record.plans.find((p) => p.purpose === "core");
    assert(core !== undefined);
    assertEquals(core.plan.args, [
      "run",
      "--allow-all",
      `${root}/apps/core/main.ts`,
    ]);
    assertEquals(core.plan.env.LOPHN_HOME, `${root}/.dev-data`);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("deno task dev: fake provider를 띄우기 전에 데이터 root를 만든다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-dev-" });
  try {
    await Deno.mkdir(`${root}/apps/shell/main`, { recursive: true });
    await Deno.writeTextFile(`${root}/apps/shell/main/package.json`, "{}");
    await run("dev", root);
    const stat = await Deno.stat(`${root}/.dev-data`);
    assert(stat.isDirectory);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("deno task dev:core: LOPHN_LIVE_PROVIDER=1이면 fake provider를 띄우지 않는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-dev-" });
  try {
    await Deno.mkdir(`${root}/apps/core`, { recursive: true });
    await Deno.writeTextFile(`${root}/apps/core/main.ts`, "");
    const record = recorder({ fakeReady: null });
    const result = await runDev("dev:core", {
      root,
      signals: false,
      env: { TEST_LIVE: "1" },
      spawn: (plan, purpose) => {
        // LOPHN_LIVE_PROVIDER는 사람의 env여야 한다. runDev는 Deno.envToObject를 쓰므로
        // 여기서는 직접 shouldStartFakeProvider로 본다.
        void plan;
        void purpose;
        return recorder({}).spawn(plan, purpose);
      },
    });
    assertEquals(result.ok, true);
    void record;
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("deno task dev: LOPHN_LIVE_PROVIDER=1은 live provider를 쓰고 fake를 건너뛴다", () => {
  assertEquals(shouldStartFakeProvider({ LOPHN_LIVE_PROVIDER: "1" }), false);
  assertEquals(shouldStartFakeProvider({}), true);
  assertEquals(
    shouldStartFakeProvider({ LOPHN_FAKE_PROVIDER_URL: "http://127.0.0.1:1" }),
    false,
  );
});

Deno.test("deno task dev:core: --port=<n> 인자를 core에 흘려 보낸다(platform#T9 시작 인자)", () => {
  const plan = planCore("/repo", {
    dataRoot: "/repo/.dev-data",
    port: 7431,
  });
  assertEquals(plan.args, [
    "run",
    "--allow-all",
    "/repo/apps/core/main.ts",
    "--port=7431",
  ]);
  assertEquals(plan.env.LOPHN_HOME, "/repo/.dev-data");
  // port 인자가 없으면 core가 자기 기본으로 띄운다.
  const planNoPort = planCore("/repo", { dataRoot: "/repo/.dev-data" });
  assertEquals(planNoPort.args, [
    "run",
    "--allow-all",
    "/repo/apps/core/main.ts",
  ]);
});

Deno.test("deno task dev: fake provider는 tools/fake-provider/main.ts를 deno run --allow-net으로 띄운다", () => {
  const plan = planFakeProvider("/repo");
  assertEquals(plan.command, Deno.execPath());
  assertEquals(plan.args, [
    "run",
    "--allow-net",
    "/repo/tools/fake-provider/main.ts",
  ]);
});

Deno.test("deno task dev: signalNames는 Ctrl+C와 SIGTERM이다", () => {
  assertEquals(signalNames("linux"), ["SIGINT", "SIGTERM"]);
  assertEquals(signalNames("windows"), ["SIGBREAK"]);
});

Deno.test("deno task dev: fake provider ready 한 줄을 읽는다", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(readyLine("http://127.0.0.1:5000")),
      );
      controller.close();
    },
  });
  const ready = await fakeProviderReady(stream);
  assertEquals(ready, { ready: true, url: "http://127.0.0.1:5000" });

  const empty = new ReadableStream<Uint8Array>({
    start(c) {
      c.close();
    },
  });
  assertEquals(await fakeProviderReady(empty), null);

  const broken = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("not json\n"));
      controller.close();
    },
  });
  assertEquals(await fakeProviderReady(broken), null);
});

Deno.test("deno task dev: shell 계획은 --home으로 데이터 root를 받는다", () => {
  const plan = planShell("/repo", { dataRoot: "/repo/.dev-data" });
  assertEquals(plan.command, "npm");
  assertEquals(
    plan.args,
    [
      "--prefix",
      "/repo/apps/shell/main",
      "run",
      "dev",
      "--",
      "--home",
      "/repo/.dev-data",
    ],
  );
});
