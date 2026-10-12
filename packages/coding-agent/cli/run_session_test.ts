// CLI `session plan` 실행 조립 시험이다(coding-agent#T38, cli#R40, sessions#R1·R2·R4). home·data root는
// temp dir이고 감지 파일 눈·launcher는 fake다. 사람의 실제 home·data root·harness 설정은 열지 않고 실제
// harness도 띄우지 않는다. plan은 spawn이 아니라서 launcher가 한 번도 불리지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import { cliMain, type CliOptions } from "./main.ts";
import type { CliPorts } from "./dispatch.ts";

const TKT = "tkt_01arz3ndektsv4rrffq69g5fav";
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";

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

const ENV = (home: string, extra: Record<string, string> = {}) => ({
  get: (name: string) => ({ LOPHN_HOME: `${home}/.lophn`, ...extra })[name],
});

type Fixture = {
  home: string;
  ports: Partial<CliPorts>;
  launched: unknown[];
};

async function fixture(): Promise<Fixture> {
  const home = await Deno.makeTempDir({ prefix: "lophn-cli-session-home-" });
  await Deno.mkdir(`${home}/.local/bin`, { recursive: true });
  await Deno.writeTextFile(`${home}/.local/bin/claude`, "#!/bin/sh\n");
  await Deno.chmod(`${home}/.local/bin/claude`, 0o755);
  const launched: unknown[] = [];
  const ports: Partial<CliPorts> = {
    detect: {
      home,
      path: `${home}/.local/bin`,
      files: {
        list(dir) {
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
      // 최초 감지에는 version·auth probe가 없다. 불리면 시험이 실패한다.
      execFor: () => ({
        run: () => Promise.resolve(err({ code: "internal", message: "probe" })),
      }),
    },
    launch(decision) {
      launched.push(decision);
      return Promise.resolve(ok(undefined));
    },
  };
  return { home, ports, launched };
}

function planArgs(patch: Record<string, unknown> = {}): string[] {
  return [
    "session",
    "plan",
    "--json",
    "--input",
    JSON.stringify({
      plan_input: {
        ticket: TKT,
        ticket_revision: "12",
        connection: CAC,
        harness_id: "claude",
        project: PRJ,
        folder_ref: "src",
        cwd: "/work/app",
        method: "terminal_tui",
        facts: {
          ticket_app: APP,
          screen_state: "ready",
          connection_state: "active",
          connection_scope: { kind: "app", app: APP },
          problems: [],
          inspect: ["src/a.ts"],
        },
        human_start_handle: "hs_1",
        operation_id: "op_1",
        ...patch,
      },
    }),
  ];
}

Deno.test("coding-agent/sessions#R2 coding-agent/cli#R40: session plan은 감지한 실행 파일로 plan을 내고 process를 열지 않으며 coding credential context에서는 거절이다", async () => {
  const fx = await fixture();
  try {
    const planned = await run(planArgs(), {
      env: ENV(fx.home),
      home: fx.home,
      ports: fx.ports,
    });
    assertEquals(planned.exit, 0, planned.stdout + planned.stderr);
    const plan = JSON.parse(planned.stdout).data.plan;
    assertEquals(plan.executable, `${fx.home}/.local/bin/claude`);
    assertEquals(plan.method, "terminal_tui");
    assertEquals(plan.human_start_handle, "hs_1");
    assertEquals(plan.argv[0], "claude");
    assertEquals(plan.env_overlay.LOPHN_CONNECTION, CAC);
    assertFalse(plan.first_prompt.includes("token"));
    // plan은 spawn이 아니다.
    assertEquals(fx.launched.length, 0);

    // 시작 계획은 사람 클릭을 검증한 쪽만 부른다. LOPHN_CONNECTION이 있는 coding credential은 거절이다.
    const coding = await run(planArgs(), {
      env: ENV(fx.home, { LOPHN_CONNECTION: CAC }),
      home: fx.home,
      ports: fx.ports,
    });
    assert(coding.exit !== 0);
    assert((coding.stdout + coding.stderr).includes("forbidden"));
    assertFalse((coding.stdout + coding.stderr).includes('"plan"'));
  } finally {
    await Deno.remove(fx.home, { recursive: true });
  }
});

Deno.test("coding-agent/sessions#R4: 감지한 실행 파일이 옮겨지면 session plan은 conflict와 다음 행동으로 끝나고 다시 감지하지 않는다", async () => {
  const fx = await fixture();
  try {
    const first = await run(planArgs(), {
      env: ENV(fx.home),
      home: fx.home,
      ports: fx.ports,
    });
    assertEquals(first.exit, 0, first.stdout + first.stderr);
    // 감지 뒤 실행 파일이 사라졌다.
    await Deno.remove(`${fx.home}/.local/bin/claude`);
    const moved = await run(planArgs(), {
      env: ENV(fx.home),
      home: fx.home,
      ports: fx.ports,
    });
    assert(moved.exit !== 0);
    const text = moved.stdout + moved.stderr;
    assert(text.includes("conflict"), text);
    assert(text.includes("harness refresh"), text);
    assertFalse(text.includes('"plan"'));
    assertEquals(fx.launched.length, 0);
  } finally {
    await Deno.remove(fx.home, { recursive: true });
  }
});

Deno.test("coding-agent/sessions#R1: session plan의 자기 터미널 방식은 plan이 아니라 안내를 내고 process 정보가 없다", async () => {
  const fx = await fixture();
  try {
    const guided = await run(planArgs({ method: "own_terminal" }), {
      env: ENV(fx.home),
      home: fx.home,
      ports: fx.ports,
    });
    assertEquals(guided.exit, 0, guided.stdout + guided.stderr);
    const data = JSON.parse(guided.stdout).data;
    assertEquals(data.guide.method, "own_terminal");
    assertEquals(data.plan, undefined);
    assertFalse(guided.stdout.includes("executable"));
  } finally {
    await Deno.remove(fx.home, { recursive: true });
  }
});
