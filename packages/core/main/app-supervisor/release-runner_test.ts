// release 준비를 권한 좁은 별도 Deno 자식으로 돌리는 runner(apps/releases#R1, R19). 실제 git source,
// 실제 설치 SDK 사본, 실제 자식 프로세스를 쓴다. 사람 데이터 root는 열지 않고 temp lophn home만 쓴다.
import { assert, assertEquals } from "@std/assert";
import { createPreparationService } from "../../apps/releases/preparation.ts";
import {
  installedHome,
  removeTree,
  scaffoldInto,
} from "../../apps/packages/testing/mod.ts";
import { createChildPreparationRunner } from "./release-runner.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";

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

async function world() {
  const installed = await installedHome();
  const source = await Deno.makeTempDir({ prefix: "lophn-runner-source-" });
  const dir = `${source}/app`;
  await scaffoldInto(installed, dir);
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "dev@lophn.local"]);
  await git(dir, ["config", "user.name", "dev"]);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "init"]);
  const commit = await git(dir, ["rev-parse", "HEAD"]);
  const denoDir = Deno.env.get("DENO_DIR") ??
    `${Deno.env.get("HOME") ?? "/tmp"}/.cache/deno`;
  const service = createPreparationService(createChildPreparationRunner({
    dataRoot: installed.home,
    deno: () => Deno.execPath(),
    denoDir,
  }));
  return {
    installed,
    dir,
    commit,
    service,
    async dispose() {
      await removeTree(source);
      await installed.dispose();
    },
  };
}

async function settled(
  service: ReturnType<typeof createPreparationService>,
  key: string,
) {
  for (let i = 0; i < 600; i += 1) {
    const now = service.get(APP, key);
    if (now.status !== "preparing") return now;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("preparation did not settle");
}

Deno.test("apps/releases#R1, apps/releases#R19: 준비는 좁은 권한의 자식에서 돌아 봉인 bundle과 manifest를 낸다", async () => {
  const w = await world();
  try {
    const started = w.service.start({
      app: APP,
      commit: w.commit,
      request_key: "prep-1",
      source_path: w.dir,
    });
    assert(started.ok);
    assertEquals(started.value.status, "preparing");
    const done = await settled(w.service, "prep-1");
    assertEquals(done.status, "completed", JSON.stringify(done));
    assert(done.bundle_hash !== null && done.manifest !== null);
    assert(done.manifest.files.some((file) => file.path === "import-map.json"));
    const sealed = await Deno.stat(
      `${w.installed.home}/apps/${APP}/bundles/${done.bundle_hash}/manifest.json`,
    );
    assert(sealed.isFile);
  } finally {
    await w.dispose();
  }
});

Deno.test("apps/releases#R19: 취소는 자식을 끝내고 확정하지 않으며 staging을 남기지 않는다", async () => {
  const w = await world();
  try {
    const started = w.service.start({
      app: APP,
      commit: w.commit,
      request_key: "prep-2",
      source_path: w.dir,
    });
    assert(started.ok);
    const cancelled = await w.service.cancel(APP, "prep-2");
    assert(cancelled.ok);
    const state = w.service.get(APP, "prep-2");
    assertEquals(state.status, "cancelled");
    assertEquals(state.bundle_hash, null);
    const staging = await Deno.stat(
      `${w.installed.home}/apps/${APP}/staging`,
    ).then(() => true, () => false);
    assertEquals(staging, false);
  } finally {
    await w.dispose();
  }
});
