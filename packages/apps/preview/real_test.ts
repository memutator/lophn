// 실제 앱 자식 프로세스를 launcher로 띄워 preview의 격리를 본다. core·keychain·네트워크·사람 데이터
// root는 열지 않는다. 자식은 temp 폴더의 fixture bundle이고 서명 key는 시험이 만든 Ed25519 key다.
import { assert, assertEquals } from "@std/assert";
import {
  FIXTURE_APP,
  fixtureBlueprint,
  LIVE_DATA,
  openPreviewWorld,
  type PreviewWorld,
  untilReady,
} from "./world_test.ts";
import type { PreviewLaunch } from "../runtime/mod.ts";

function blueprint(): Record<string, unknown> {
  const base = fixtureBlueprint();
  return {
    ...base,
    commands: [
      ...(base["commands"] as unknown[]),
      {
        key: "pay",
        label: "pay",
        description: "pay purpose",
        effect: "external",
        confirm: true,
        input: null,
        revert: { supported: false },
      },
    ],
    // 시작 계기가 있는 automation이다. preview에서는 스스로 돌지 않아야 한다.
    automatic_tasks: [{
      key: "boot",
      label: "Boot",
      when: { kind: "on_start" },
      command: "usage.save",
    }],
  };
}

async function withPreview(
  run: (world: PreviewWorld, launch: PreviewLaunch) => Promise<void>,
  options: { release?: string | null } = {},
): Promise<void> {
  const world = await openPreviewWorld();
  try {
    const launch = await world.launch({
      blueprint: blueprint(),
      ...(options.release === undefined ? {} : { release: options.release }),
    });
    assert(world.launcher.start(launch).ok);
    await untilReady(world, launch);
    await run(world, launch);
  } finally {
    await world.close();
  }
}

Deno.test("apps/preview#R1: release 없는 preview 자식이 뜨고 화면·명령 요청을 받으며 응답에는 mode=preview만 있고 invocation은 꾸미지 않는다", async () => {
  await withPreview(async (world, launch) => {
    const read = await world.call(
      launch,
      "POST",
      "/_lophn/commands/invoke",
      await world.connection(launch),
      { request_key: "r1", command: "usage.read" },
    );
    assertEquals(read.status, 200, JSON.stringify(read.body));
    assertEquals((read.body as { mode: string }).mode, "preview");
    const write = await world.call(
      launch,
      "POST",
      "/_lophn/commands/invoke",
      await world.connection(launch),
      { request_key: "w1", command: "usage.save" },
    );
    assertEquals(write.status, 200, JSON.stringify(write.body));
    const body = write.body as Record<string, unknown>;
    assertEquals(body["mode"], "preview");
    // release가 없는 preview에는 가짜 invocation이 없다(R9).
    assertEquals("invocation" in body, false);
    const seen = world.launcher.observation(launch.app, launch.nonce);
    assertEquals(seen?.release, null);
    assertEquals(seen?.mode, "preview");
    assertEquals(seen?.accepting, true);
    assertEquals(world.output(launch.nonce).includes("ran usage.save"), true);
  });
});

Deno.test("apps/preview#R9: 준비된 release가 있는 preview는 그 release를 신원으로 쓰고 write 호출의 invocation을 돌려준다", async () => {
  await withPreview(async (world, launch) => {
    const write = await world.call(
      launch,
      "POST",
      "/_lophn/commands/invoke",
      await world.connection(launch),
      { request_key: "w1", command: "usage.save" },
    );
    assertEquals(write.status, 200, JSON.stringify(write.body));
    const body = write.body as Record<string, unknown>;
    assertEquals(body["mode"], "preview");
    assertEquals(typeof body["invocation"], "string");
  }, { release: "rel_01arz3ndektsv4rrffq69g5fav" });
});

Deno.test("apps/preview#R5: preview에서 confirm 명령은 proof가 있어도 실제 handler를 돌리지 않고 forbidden이다", async () => {
  await withPreview(async (world, launch) => {
    const refused = await world.call(
      launch,
      "POST",
      "/_lophn/commands/invoke",
      await world.connection(launch),
      { request_key: "c1", command: "pay" },
    );
    assertEquals(refused.status, 403, JSON.stringify(refused.body));
    // 같은 nonce·command·입력의 서명된 proof가 와도 preview의 handler는 돌지 않는다.
    const proof = await world.signer.signConfirmProof({
      invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
      app: launch.app,
      release: "rel_01arz3ndektsv4rrffq69g5fav",
      command: "pay",
      input_hash: "00".repeat(32),
      process_nonce: launch.nonce,
      caller: { kind: "direct" },
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    } as never);
    const withProof = await world.call(
      launch,
      "POST",
      "/_lophn/commands/invoke",
      await world.connection(launch),
      { request_key: "c2", command: "pay", proof },
    );
    assertEquals(withProof.status, 403, JSON.stringify(withProof.body));
    // 서명·nonce 검사까지 가지 않고 preview라서 거절한다.
    assert(JSON.stringify(withProof.body).includes("not run in preview"));
    // handler가 돌았다면 자식 log에 남는다. 돌지 않았다.
    assertEquals(world.output(launch.nonce).includes("ran pay"), false);
  });
});

Deno.test("apps/preview#R6: 시작 계기가 있는 automation도 preview에서는 스스로 돌지 않고 수동 호출에서만 handler가 돈다", async () => {
  await withPreview(async (world, launch) => {
    // 시작 계기(on_start)가 있는 blueprint를 열어 두고 충분히 기다려도 handler가 돌지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assertEquals(world.output(launch.nonce).includes("ran usage.save"), false);
    const manual = await world.call(
      launch,
      "POST",
      "/_lophn/commands/invoke",
      await world.connection(launch),
      { request_key: "m1", command: "usage.save" },
    );
    assertEquals(manual.status, 200, JSON.stringify(manual.body));
    const ran = world.output(launch.nonce).split("ran usage.save").length - 1;
    assertEquals(ran, 1);
  });
});

Deno.test("apps/preview#R7: preview 자식은 운영 mode·다른 nonce·다른 bundle의 connection을 받지 않는다", async () => {
  await withPreview(async (world, launch) => {
    const call = async (authorization: string) =>
      await world.call(
        launch,
        "POST",
        "/_lophn/commands/invoke",
        authorization,
        { request_key: crypto.randomUUID(), command: "usage.read" },
      );
    // 운영 connection(mode=live, release 있음)은 preview 자식에게 mode 불일치다.
    const live = await call(
      await world.connection(launch, {
        mode: "live",
        release: "rel_01arz3ndektsv4rrffq69g5fav",
      }),
    );
    assertEquals(live.status, 409);
    const otherNonce = await call(
      await world.connection(launch, { process_nonce: "nonce-someone-else" }),
    );
    assertEquals(otherNonce.status, 401);
    const otherBundle = await call(
      await world.connection(launch, { bundle_hash: "cd".repeat(32) }),
    );
    assertEquals(otherBundle.status, 409);
    const unsigned = await call("{}");
    assert(unsigned.status === 401 || unsigned.status === 400);
    const good = await call(await world.connection(launch));
    assertEquals(good.status, 200);
    assertEquals((good.body as { mode: string }).mode, "preview");
  });
});

Deno.test("apps/preview#R2, R4: preview 자식의 Deno 권한은 disposable 영역 밖을 쓰지 못하고 운영 data를 읽지 못하며 net을 열지 못한다", async () => {
  const world = await openPreviewWorld();
  try {
    const launch = await world.launch({ blueprint: blueprint() });
    assert(world.launcher.start(launch).ok);
    await untilReady(world, launch);
    // launcher가 실제 자식에게 준 flag(supervisor가 더하는 socket flag 포함)를 그대로 쓴다.
    const request = world.spawns[0];
    const script = `${world.root}/probe.ts`;
    await Deno.writeTextFile(
      script,
      `
      const out: Record<string, string> = {};
      async function attempt(name: string, run: () => Promise<unknown> | unknown) {
        try { await run(); out[name] = "allowed"; }
        catch (error) { out[name] = (error as Error).name; }
      }
      await attempt("write_live", () => Deno.writeTextFile(${
        JSON.stringify(world.liveData)
      }, "changed"));
      await attempt("read_live", () => Deno.readTextFile(${
        JSON.stringify(world.liveData)
      }));
      await attempt("write_preview", () => Deno.writeTextFile(${
        JSON.stringify(launch.dataPath + "/data.db")
      }, "edited"));
      await attempt("read_preview", () => Deno.readTextFile(${
        JSON.stringify(launch.dataPath + "/data.db")
      }));
      await attempt("listen_loopback", () => { const l = Deno.listen({ hostname: "127.0.0.1", port: 0 }); l.close(); });
      await attempt("fetch_loopback", () => fetch("http://127.0.0.1:65000/"));
      await attempt("fetch_external", () => fetch("https://example.com/"));
      await attempt("env", () => Deno.env.get("HOME"));
      await attempt("run", () => new Deno.Command("true").output());
      console.log(JSON.stringify(out));
      `,
    );
    const args = request.flags.args.filter((flag) =>
      !flag.startsWith("--allow-net")
    );
    const ran = await new Deno.Command(Deno.execPath(), {
      args: ["run", ...args, script],
      clearEnv: true,
      env: {
        HOME: Deno.env.get("HOME") ?? "/",
        PATH: Deno.env.get("PATH") ?? "",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(ran.stdout);

    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    assertEquals(result["write_live"], "NotCapable");
    assertEquals(result["read_live"], "NotCapable");
    assertEquals(result["write_preview"], "allowed");
    assertEquals(result["read_preview"], "allowed");
    assertEquals(result["listen_loopback"], "NotCapable");
    assertEquals(result["fetch_loopback"], "NotCapable");
    assertEquals(result["fetch_external"], "NotCapable");
    assertEquals(result["env"], "NotCapable");
    assertEquals(result["run"], "NotCapable");
    // 운영 data는 그대로다.
    assertEquals(await Deno.readTextFile(world.liveData), LIVE_DATA);
  } finally {
    await world.close();
  }
});

Deno.test("apps/preview#R3, R10: 종료한 preview는 연결이 거절되고 같은 앱의 새 preview가 같은 자리에서 다시 뜬다", async () => {
  const world = await openPreviewWorld();
  try {
    const first = await world.launch({ blueprint: blueprint() });
    assert(world.launcher.start(first).ok);
    await untilReady(world, first);
    const stopped = await world.launcher.stop(first.app, first.nonce);
    assertEquals(stopped, { ok: true, value: true });
    assertEquals(world.launcher.observation(first.app, first.nonce), null);
    // 종료한 preview로 보낸 호출은 어디에도 닿지 않는다(운영 앱으로 대신 가지 않는다).
    let failed = false;
    try {
      await world.call(
        first,
        "POST",
        "/_lophn/commands/invoke",
        await world.connection(first),
        { request_key: "late", command: "usage.read" },
      );
    } catch {
      failed = true;
    }
    assertEquals(failed, true);
    const second = await world.launch({ blueprint: blueprint() });
    assertEquals(second.app, FIXTURE_APP);
    assert(world.launcher.start(second).ok);
    await untilReady(world, second);
    const good = await world.call(
      second,
      "POST",
      "/_lophn/commands/invoke",
      await world.connection(second),
      { request_key: "again", command: "usage.read" },
    );
    assertEquals(good.status, 200);
    // 운영 data는 어느 preview에서도 그대로다.
    assertEquals(await Deno.readTextFile(world.liveData), LIVE_DATA);
  } finally {
    await world.close();
  }
});
