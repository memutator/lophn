// release 준비 접수·진행·취소(`releases/{prepare_bundle,preparation,cancel_preparation}`)를 실제
// core(임시 LOPHN_HOME)와 실제 apps supervisor, 실제 준비 자식으로 본다(apps/releases#R1, R19). 앱 source는
// 템플릿으로 만든 실제 git repository이고 설치 SDK 사본은 temp home에서 core의 data root로 옮긴다.
// 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  openWorld,
  type World,
} from "../../packages/core/apps/runtime/world_test.ts";
import {
  installedHome,
  removeTree,
  scaffoldInto,
} from "../../packages/core/apps/packages/testing/mod.ts";
import { call, command } from "./testing/approvals-fixture.ts";

async function git(cwd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}

type Prepared = {
  world: World;
  commit: string;
  coding: string;
  machine: string;
  dispose(): Promise<void>;
};

async function withPreparation(): Promise<Prepared> {
  const world = await openWorld({ supervisor: true });
  const installed = await installedHome();
  const source = await Deno.makeTempDir({ prefix: "lophn-prep-source-" });
  const dir = `${source}/app`;
  await scaffoldInto(installed, dir);
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "dev@lophn.local"]);
  await git(dir, ["config", "user.name", "dev"]);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "init"]);
  const commit = await git(dir, ["rev-parse", "HEAD"]);
  // 설치 SDK 사본을 core의 data root로 옮긴다(쓸 수 있게 풀어 지울 수 있게 한다).
  const copied = await new Deno.Command("cp", {
    args: [
      "-r",
      `${installed.home}/sdk`,
      `${world.harness.dataRoot}/sdk`,
    ],
  }).output();
  assert(copied.success);
  await new Deno.Command("chmod", {
    args: ["-R", "u+rwX", `${world.harness.dataRoot}/sdk`],
  }).output();
  const user = await world.login("user", ["app.get", "app.connect_source"]);
  const got = await call(world.harness, "apps/get", user.token, {
    app: world.app,
  });
  assertEquals(got.status, 200, JSON.stringify(got.body));
  const connected = await call(
    world.harness,
    "apps/connect_source",
    user.token,
    command(
      { app: world.app, source_path: dir },
      {
        compare: {
          base_revision: (got.body["app"] as { revision: string }).revision,
        },
      },
    ),
  );
  assertEquals(connected.status, 200, JSON.stringify(connected.body));
  const coding = (await world.login(
    "coding_agent",
    [
      "release.prepare_bundle",
      "release.preparation",
      "release.cancel_preparation",
    ],
    { conditions: { app: world.app } },
  )).token;
  const machine = (await world.login("machine", [
    "release.prepare_bundle",
    "release.preparation",
    "release.cancel_preparation",
  ])).token;
  return {
    world,
    commit,
    coding,
    machine,
    async dispose() {
      // 봉인한 bundle(0444·0555)이 core 폴더 정리를 막지 않게 먼저 쓸 수 있게 푼다.
      await new Deno.Command("chmod", {
        args: ["-R", "u+rwX", world.harness.dataRoot],
      }).output();
      await world.close();
      await removeTree(source);
      await installed.dispose();
    },
  };
}

async function settled(p: Prepared, key: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const read = await call(
      p.world.harness,
      "releases/preparation",
      p.coding,
      command({ app: p.world.app, request_key: key }),
    );
    assertEquals(read.status, 200, JSON.stringify(read.body));
    if (read.body["status"] !== "preparing") return read.body;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("preparation did not settle");
}

Deno.test("apps/releases#R1, apps/releases#R19: 접수한 준비는 supervisor의 자식에서 끝나 고정 bundle hash·blueprint hash·manifest를 읽을 수 있다", async () => {
  const p = await withPreparation();
  try {
    const accepted = await call(
      p.world.harness,
      "releases/prepare_bundle",
      p.coding,
      command({ app: p.world.app, commit: p.commit, request_key: "prep-1" }),
    );
    assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
    assertEquals(accepted.body["status"], "preparing");
    assertEquals(accepted.body["bundle_hash"], null);
    // 같은 request_key의 같은 요청은 같은 진행이다.
    const again = await call(
      p.world.harness,
      "releases/prepare_bundle",
      p.coding,
      command({ app: p.world.app, commit: p.commit, request_key: "prep-1" }),
    );
    assertEquals(again.status, 200, JSON.stringify(again.body));
    const done = await settled(p, "prep-1");
    assertEquals(done["status"], "completed", JSON.stringify(done));
    const manifest = done["manifest"] as { files: { path: string }[] };
    assert(manifest.files.some((file) => file.path === "import-map.json"));
    const sealed = await Deno.stat(
      `${p.world.harness.dataRoot}/apps/${p.world.app}/bundles/${
        done["bundle_hash"]
      }/manifest.json`,
    );
    assert(sealed.isFile);
    // 이 요청은 release를 확정하지 않는다.
    const listed = await call(
      p.world.harness,
      "apps/get",
      (await p.world.login("user", ["app.get"])).token,
      {
        app: p.world.app,
      },
    );
    assertEquals(
      (listed.body["app"] as { active_release: unknown }).active_release,
      null,
    );
  } finally {
    await p.dispose();
  }
});

Deno.test("apps/releases#R19: 모르는 request_key는 unknown이고 취소는 machine만 하며 취소한 준비는 확정하지 않는다", async () => {
  const p = await withPreparation();
  try {
    const unknown = await call(
      p.world.harness,
      "releases/preparation",
      p.coding,
      command({ app: p.world.app, request_key: "never-sent" }),
    );
    assertEquals(unknown.status, 200, JSON.stringify(unknown.body));
    assertEquals(unknown.body["status"], "unknown");
    assertEquals(unknown.body["bundle_hash"], null);

    const started = await call(
      p.world.harness,
      "releases/prepare_bundle",
      p.machine,
      command({ app: p.world.app, commit: p.commit, request_key: "prep-2" }),
    );
    assertEquals(started.status, 200, JSON.stringify(started.body));
    const byAgent = await call(
      p.world.harness,
      "releases/cancel_preparation",
      p.coding,
      command({ app: p.world.app, request_key: "prep-2" }),
    );
    assert(byAgent.status === 401 || byAgent.status === 403);
    const cancelled = await call(
      p.world.harness,
      "releases/cancel_preparation",
      p.machine,
      command({ app: p.world.app, request_key: "prep-2" }),
    );
    assertEquals(cancelled.status, 200, JSON.stringify(cancelled.body));
    const state = await call(
      p.world.harness,
      "releases/preparation",
      p.machine,
      command({ app: p.world.app, request_key: "prep-2" }),
    );
    assertEquals(state.body["status"], "cancelled");
    assertEquals(state.body["bundle_hash"], null);
  } finally {
    await p.dispose();
  }
});

Deno.test("apps/releases#R1: 범위 밖 앱과 없는 앱과 source가 없는 앱의 준비 요청은 같은 거절이다", async () => {
  const p = await withPreparation();
  try {
    const other = (await p.world.login(
      "coding_agent",
      ["release.prepare_bundle", "release.preparation"],
      { conditions: { app: "app_01arz3ndektsv4rrffq69g5faw" } },
    )).token;
    const body = (app: string) =>
      command({ app, commit: p.commit, request_key: "prep-3" });
    const outside = await call(
      p.world.harness,
      "releases/prepare_bundle",
      other,
      body(p.world.app),
    );
    const missing = await call(
      p.world.harness,
      "releases/prepare_bundle",
      other,
      body("app_01arz3ndektsv4rrffq69g5fax"),
    );
    assertEquals(outside.status, 403, JSON.stringify(outside.body));
    assertEquals(outside, missing);
    for (const target of [p.world.app, "app_01arz3ndektsv4rrffq69g5fax"]) {
      const read = await call(
        p.world.harness,
        "releases/preparation",
        other,
        command({ app: target, request_key: "prep-3" }),
      );
      assertEquals(read.status, 404, JSON.stringify(read.body));
    }
  } finally {
    await p.dispose();
  }
});
