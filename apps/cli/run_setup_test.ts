// CLI 설치·감지·daemon 실행 조립 시험이다(cli#R6, R8, R9, R40, harnesses#R2, R3, R6, R9). home·data root는
// temp dir이고 감지 파일 눈·probe·daemon 판정·launcher는 fake다. 사람의 실제 home·data root·harness 설정은
// 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok } from "../../packages/base/mod.ts";
import { createHelperCredentialProvider } from "../../packages/coding-agent/connection/credential/helper.ts";
import type { ExecPort } from "../../packages/coding-agent/harnesses/mod.ts";
import { cliMain, type CliOptions } from "./main.ts";
import type { CliPorts } from "./dispatch.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const TOKEN = "setup-cli-token-5e1f09";

type Captured = { exit: number; stdout: string; stderr: string };

async function run(argv: string[], options: CliOptions): Promise<Captured> {
  const out = new TransformStream<Uint8Array, Uint8Array>();
  const errs = new TransformStream<Uint8Array, Uint8Array>();
  const decoder = new TextDecoder();
  const collect = async (readable: ReadableStream<Uint8Array>) => {
    let text = "";
    for await (const chunk of readable) {
      text += decoder.decode(chunk, { stream: true });
    }
    return text;
  };
  const stdout = collect(out.readable);
  const stderr = collect(errs.readable);
  const exit = await cliMain(argv, {
    stdout: out.writable,
    stderr: errs.writable,
    cwd: Deno.cwd(),
    installRoot: "/nonexistent-install",
    ...options,
  });
  await out.writable.close();
  await errs.writable.close();
  return { exit, stdout: await stdout, stderr: await stderr };
}

const ENV = (extra: Record<string, string> = {}) => ({
  get: (name: string) =>
    ({ LOPHN_HOME: "/nonexistent-lophn-home", ...extra })[name],
});

async function fakeHelper(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cli-setup-helper-" });
  const helper = `${dir}/lophn-credential`;
  await Deno.writeTextFile(
    helper,
    `#!/bin/sh\ncat > /dev/null\nprintf '%s' '{"token":"${TOKEN}"}'\n`,
  );
  await Deno.chmod(helper, 0o755);
  return helper;
}

function reply(body: unknown, status = 200) {
  return Promise.resolve({
    status,
    headers: new Headers(),
    bytes: new TextEncoder().encode(JSON.stringify(body)),
  });
}

const SHOWN = {
  connection: {
    id: CAC,
    label: "claude",
    scope: { kind: "all", app: null },
    principal: `coding_agent:${CAC}`,
    state: "active",
    revision: "1",
  },
  as_of_seq: "1",
  next_cursor: null,
};

const CLAUDE_TARGET = {
  scope_kind: "user",
  environment: { kind: "host", identity: "native" },
  profile_id: null,
  harness_id: "claude",
  app: null,
  app_realpath: null,
};

type Fixture = {
  home: string;
  ports: Partial<CliPorts>;
  listed: string[];
  probed: string[][];
  launched: { executable: string; argv: readonly string[] }[];
};

// temp home에 claude·codex 실행 파일을 두고 감지 눈을 그 안으로 좁힌다.
async function fixture(): Promise<Fixture> {
  const home = await Deno.makeTempDir({ prefix: "lophn-cli-setup-home-" });
  await Deno.mkdir(`${home}/.local/bin`, { recursive: true });
  for (const name of ["claude", "codex"]) {
    await Deno.writeTextFile(`${home}/.local/bin/${name}`, "#!/bin/sh\n");
    await Deno.chmod(`${home}/.local/bin/${name}`, 0o755);
  }
  const listed: string[] = [];
  const probed: string[][] = [];
  const launched: Fixture["launched"] = [];
  const exec = (classifier: string): ExecPort => ({
    run(argv) {
      probed.push([...argv]);
      return Promise.resolve(
        ok(
          classifier === "first_semver"
            ? { outcome: "ok" as const, detail: "1.2.3" }
            : { outcome: "ok" as const, detail: "verified" },
        ),
      );
    },
  });
  const ports: Partial<CliPorts> = {
    detect: {
      home,
      path: `${home}/.local/bin`,
      files: {
        list(dir) {
          listed.push(dir);
          try {
            return ok([...Deno.readDirSync(dir)].map((entry) => entry.name));
          } catch {
            return ok(null);
          }
        },
        executable(path) {
          try {
            return ok(((Deno.statSync(path).mode ?? 0) & 0o111) !== 0);
          } catch {
            return ok(null);
          }
        },
      },
      execFor: (classifier) => exec(classifier),
    },
    daemon: {
      start: () => Promise.resolve(ok({ executable: "d", argv: ["--tray"] })),
      startFail: (error) => Promise.resolve(err(error)),
      stop: () => Promise.resolve(ok({ executable: "d", argv: ["--quit"] })),
      stopFail: (error) => Promise.resolve(err(error)),
      status: () =>
        Promise.resolve(
          ok({ state: "absent" as const, metadata: "absent" as const }),
        ),
      runMetadata: () =>
        Promise.resolve(err({ code: "not_found", message: "없다" })),
    },
    daemonLogs: { paths: () => [] },
    launch(decision) {
      launched.push(decision);
      return Promise.resolve(ok(undefined));
    },
  };
  return { home, ports, listed, probed, launched };
}

Deno.test("coding-agent/cli#R40 coding-agent/harnesses#R2: harness list는 catalog 일곱 제품이고 detect는 저장한 결과를 다시 감지하지 않으며 refresh만 version·auth probe까지 다시 돈다", async () => {
  const fx = await fixture();
  try {
    const list = await run(["harness", "list", "--json"], {
      env: ENV({ LOPHN_HOME: `${fx.home}/.lophn` }),
      home: fx.home,
      ports: fx.ports,
    });
    assertEquals(list.exit, 0, list.stderr);
    assertEquals(
      (JSON.parse(list.stdout).data.harnesses as unknown[]).length,
      7,
    );
    assertEquals(fx.listed.length, 0);

    const first = await run(["harness", "detect", "--json"], {
      env: ENV({ LOPHN_HOME: `${fx.home}/.lophn` }),
      home: fx.home,
      ports: fx.ports,
    });
    assertEquals(first.exit, 0, first.stderr);
    const firstData = JSON.parse(first.stdout).data;
    assertEquals(firstData.source, "first");
    const codex = firstData.detections.find((item: { harness_id: string }) =>
      item.harness_id === "codex"
    );
    assertEquals(codex.discovery, "detected");
    assertEquals(codex.selected_executable, `${fx.home}/.local/bin/codex`);
    // 최초 감지는 PATH·fallback만 읽고 version·auth probe를 돌리지 않는다.
    assertEquals(fx.probed.length, 0);
    assertEquals(codex.version.result, "unknown");
    const hermes = firstData.detections.find((item: { harness_id: string }) =>
      item.harness_id === "hermes"
    );
    assertEquals(hermes.discovery, "absent");

    const reads = fx.listed.length;
    const again = await run(["harness", "detect", "--json"], {
      env: ENV({ LOPHN_HOME: `${fx.home}/.lophn` }),
      home: fx.home,
      ports: fx.ports,
    });
    assertEquals(JSON.parse(again.stdout).data.source, "cached");
    // 저장 결과를 쓴 두 번째 detect는 디렉터리를 다시 읽지 않았다.
    assertEquals(fx.listed.length, reads);

    const refreshed = await run(["harness", "refresh", "--json"], {
      env: ENV({ LOPHN_HOME: `${fx.home}/.lophn` }),
      home: fx.home,
      ports: fx.ports,
    });
    const refreshedData = JSON.parse(refreshed.stdout).data;
    assertEquals(refreshedData.source, "refreshed");
    assert(fx.listed.length > reads);
    const refreshedCodex = refreshedData.detections.find((
      item: { harness_id: string },
    ) => item.harness_id === "codex");
    assertEquals(refreshedCodex.version.value, "1.2.3");
    assertEquals(refreshedCodex.auth.result, "verified");
    // probe는 감지한 실행 파일의 절대 경로로만 돈다.
    assert(fx.probed.some((argv) => argv[0] === `${fx.home}/.local/bin/codex`));
  } finally {
    await Deno.remove(fx.home, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R40 coding-agent/harnesses#R6 coding-agent/harnesses#R9: harness plan은 쓰지 않고 install·update·remove는 고른 target 하나와 receipt 소유 resource만 바꾸며 coding credential은 거절된다", async () => {
  const fx = await fixture();
  const helper = await fakeHelper();
  const provider = createHelperCredentialProvider({
    helper,
    generation: () => "1",
  });
  const options = {
    // receipt·journal은 data root `H`의 integrations에 쓴다(launcher가 그 폴더만 쓰기로 연다).
    env: ENV({ LOPHN_HOME: `${fx.home}/.lophn` }),
    home: fx.home,
    ports: fx.ports,
    provider,
    fetch: () => reply(SHOWN),
  };
  const input = JSON.stringify({
    target: CLAUDE_TARGET,
    components: ["mcp"],
    operation_id: "op-1",
  });
  const common = ["--connection", CAC, "--json", "--input", input];
  try {
    const humanOnly = await run(["harness", "install", ...common], {
      ...options,
      env: ENV({ LOPHN_CONNECTION: CAC }),
    });
    assertEquals(humanOnly.exit, 3);
    assertFalse(await exists(`${fx.home}/.claude.json`));

    const plan = await run([
      "harness",
      "plan",
      ...common.slice(0, 2),
      "--json",
      "--input",
      JSON.stringify({ target: CLAUDE_TARGET, components: ["mcp"] }),
    ], options);
    assertEquals(plan.exit, 0, plan.stdout + plan.stderr);
    const planData = JSON.parse(plan.stdout).data;
    assertEquals(planData.planned, true);
    assertEquals(planData.resources[0].outcome, "changed");
    // 계획은 설정 파일도 receipt도 만들지 않는다.
    assertFalse(await exists(`${fx.home}/.claude.json`));
    assertFalse(await exists(`${fx.home}/.lophn/integrations`));

    const installed = await run(["harness", "install", ...common], options);
    assertEquals(installed.exit, 0, installed.stdout + installed.stderr);
    const claudeJson = await Deno.readTextFile(`${fx.home}/.claude.json`);
    assert(claudeJson.includes(CAC));
    assertFalse(claudeJson.includes(TOKEN));
    // 고르지 않은 제품 설정은 만들지 않았다.
    assertFalse(await exists(`${fx.home}/.codex`));

    const updated = await run([
      "harness",
      "update",
      ...common.slice(0, 2),
      "--json",
      "--input",
      JSON.stringify({ target: CLAUDE_TARGET, components: ["mcp"] }),
    ], options);
    assertEquals(updated.exit, 0, updated.stdout + updated.stderr);
    assertEquals(
      JSON.parse(updated.stdout).data.resources[0].outcome,
      "unchanged",
    );

    const removed = await run([
      "harness",
      "remove",
      ...common.slice(0, 2),
      "--json",
      "--input",
      JSON.stringify({ target: CLAUDE_TARGET, components: ["mcp"] }),
    ], options);
    assertEquals(removed.exit, 0, removed.stdout + removed.stderr);
    assertFalse(
      (await Deno.readTextFile(`${fx.home}/.claude.json`)).includes(CAC),
    );
  } finally {
    await Deno.remove(fx.home, { recursive: true });
    await Deno.remove(helper.slice(0, helper.lastIndexOf("/")), {
      recursive: true,
    });
  }
});

Deno.test("coding-agent/cli#R40: receipt 없는 target의 update는 설치하지 않고 not_found다", async () => {
  const fx = await fixture();
  const helper = await fakeHelper();
  try {
    const updated = await run(
      [
        "harness",
        "update",
        "--connection",
        CAC,
        "--json",
        "--input",
        JSON.stringify({ target: CLAUDE_TARGET, components: ["mcp"] }),
      ],
      {
        env: ENV(),
        home: fx.home,
        ports: fx.ports,
        provider: createHelperCredentialProvider({
          helper,
          generation: () => "1",
        }),
        fetch: () => reply(SHOWN),
      },
    );
    assertEquals(updated.exit, 4);
    assertFalse(await exists(`${fx.home}/.claude.json`));
  } finally {
    await Deno.remove(fx.home, { recursive: true });
    await Deno.remove(helper.slice(0, helper.lastIndexOf("/")), {
      recursive: true,
    });
  }
});

Deno.test("coding-agent/cli#R8 coding-agent/cli#R6: daemon status는 현재 상태, start는 접수와 실제 상태를 구별하고 coding credential의 start·stop은 거절된다", async () => {
  const fx = await fixture();
  try {
    const status = await run(["daemon", "status", "--json"], {
      env: ENV(),
      home: fx.home,
      ports: fx.ports,
    });
    assertEquals(status.exit, 0, status.stderr);
    assertEquals(JSON.parse(status.stdout).data.state, "absent");

    const start = await run(["daemon", "start", "--json"], {
      env: ENV(),
      home: fx.home,
      ports: fx.ports,
    });
    assertEquals(start.exit, 0, start.stderr);
    const startData = JSON.parse(start.stdout).data;
    assertEquals(startData.accepted, true);
    assertEquals(startData.state, "absent");
    assertEquals(fx.launched, [{ executable: "d", argv: ["--tray"] }]);

    // 이미 중지된 상태의 stop은 새로 띄우지 않고 현재 상태로 답한다.
    const stop = await run(["daemon", "stop", "--json"], {
      env: ENV(),
      home: fx.home,
      ports: fx.ports,
    });
    assertEquals(JSON.parse(stop.stdout).data.accepted, false);
    assertEquals(fx.launched.length, 1);

    const denied = await run(["daemon", "start", "--json"], {
      env: ENV({ LOPHN_CONNECTION: CAC }),
      home: fx.home,
      ports: fx.ports,
    });
    assertEquals(denied.exit, 3);
    assertEquals(fx.launched.length, 1);
  } finally {
    await Deno.remove(fx.home, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R8 coding-agent/cli#R10: doctor는 daemon 상태 port를 읽고 읽지 못한 상태는 성공이 아니다", async () => {
  const fx = await fixture();
  try {
    const running = await run(["doctor", "--json"], {
      env: ENV(),
      home: fx.home,
      ports: {
        ...fx.ports,
        daemon: {
          ...fx.ports.daemon!,
          status: () =>
            Promise.resolve(
              ok({ state: "running" as const, metadata: "present" as const }),
            ),
        },
      },
    });
    assertEquals(running.exit, 0, running.stderr);
    assertEquals(JSON.parse(running.stdout).data.daemon.result, "success");
    const unreadable = await run(["doctor", "--json"], {
      env: ENV(),
      home: fx.home,
      ports: {
        ...fx.ports,
        daemon: {
          ...fx.ports.daemon!,
          status: () =>
            Promise.resolve(err({ code: "unavailable", message: "읽지 못함" })),
        },
      },
    });
    assertEquals(JSON.parse(unreadable.stdout).data.daemon.result, "unknown");
  } finally {
    await Deno.remove(fx.home, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R9: mcp config는 설정 조각만 내고 secret·운영 data 위치가 없으며 backing 없는 session은 성공으로 꾸미지 않고 unavailable이다", async () => {
  const fx = await fixture();
  try {
    const config = await run(
      [
        "mcp",
        "config",
        "--json",
        "--input",
        JSON.stringify({ target: "codex", scope: "user", connection: CAC }),
      ],
      { env: ENV(), home: fx.home, ports: fx.ports },
    );
    assertEquals(config.exit, 0, config.stdout + config.stderr);
    assert(config.stdout.includes(CAC));
    assertFalse(config.stdout.includes("nonexistent-lophn-home"));
    assertFalse(await exists(`${fx.home}/.codex`));

    for (const argv of [["session", "summary", "--json"]]) {
      const result = await run(argv, {
        env: ENV(),
        home: fx.home,
        ports: fx.ports,
        provider: createHelperCredentialProvider({
          helper: "/nonexistent-helper",
          generation: () => "1",
        }),
      });
      assertEquals(result.exit, 5, result.stdout);
    }
  } finally {
    await Deno.remove(fx.home, { recursive: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("coding-agent/cli#R10 coding-agent/guides#R4: skills list는 배포 skill 네 개의 이름·설명·version·hash를 내고 install은 고른 target의 skill root에만 파일별 결과로 설치하며 coding credential은 거절된다", async () => {
  const fx = await fixture();
  try {
    const options = {
      env: ENV({ LOPHN_HOME: `${fx.home}/.lophn` }),
      home: fx.home,
      ports: fx.ports,
    };
    const listed = await run(["skills", "list", "--json"], options);
    assertEquals(listed.exit, 0, listed.stdout + listed.stderr);
    const skills = JSON.parse(listed.stdout).data.skills as {
      name: string;
      description: string;
      version: string;
      hash: string;
    }[];
    assertEquals(skills.map((skill) => skill.name).sort(), [
      "lophn-build-app",
      "lophn-navigate",
      "lophn-repair",
      "lophn-save",
    ]);
    for (const skill of skills) {
      assert(skill.description.length > 0 && skill.version.length > 0);
      assertEquals(skill.hash.length, 64);
    }

    const input = JSON.stringify({ target: CLAUDE_TARGET });
    const refused = await run(
      ["skills", "install", "--json", "--input", input],
      {
        ...options,
        env: ENV({ LOPHN_CONNECTION: CAC }),
      },
    );
    assertEquals(refused.exit, 3);
    assertFalse(await exists(`${fx.home}/.claude`));

    const installed = await run(
      ["skills", "install", "--json", "--input", input],
      options,
    );
    assertEquals(installed.exit, 0, installed.stdout + installed.stderr);
    const data = JSON.parse(installed.stdout).data as {
      install: string;
      skills: { name: string; files: { outcome: string }[] }[];
    };
    assertEquals(data.install, "complete");
    assertEquals(data.skills.length, 4);
    assert(
      data.skills.every((skill) =>
        skill.files.every((file) => file.outcome === "changed")
      ),
    );
    assert(await exists(`${fx.home}/.claude/skills/lophn-save/SKILL.md`));
    // 고르지 않은 제품 root는 만들지 않고 MCP 설정도 쓰지 않는다.
    assertFalse(await exists(`${fx.home}/.codex`));
    assertFalse(await exists(`${fx.home}/.agents`));
    assertFalse(await exists(`${fx.home}/.claude.json`));
  } finally {
    await Deno.remove(fx.home, { recursive: true });
  }
});
