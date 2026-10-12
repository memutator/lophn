// CLI `session observe` 실행 조립 시험이다(coding-agent#T39, sessions#R6·R8·R9, harnesses#R11). hook이 stdin으로
// 준 payload를 정규화해 관측 socket에만 쓰고, 환경에 socket이 없으면 아무것도 읽거나 보내지 않으며, core·credential을
// 부르지 않는다. 실제 harness는 띄우지 않는다. 사람의 실제 home·data root는 열지 않고 socket은 temp dir에 만든다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok } from "../../packages/base/mod.ts";
import {
  CREDENTIAL_DELIVERY_FAILURES,
  harnessSessionObservationSchema,
} from "../../packages/protocol/coding-agent/mod.ts";
import { cliMain, type CliOptions } from "./main.ts";
import {
  planSelection,
  selectionFlags,
} from "../../packages/coding-agent/cli/mod.ts";

const CAC = "cac_01arz3ndektsv4rrffq69g5fav";

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
    ({ LOPHN_HOME: "/nonexistent-home/.lophn", ...extra })[name],
});

const STREAM = [
  { event: "session_start", session_id: "pi-1", session_file: "/s/pi-1.jsonl" },
  { event: "agent_start", session_id: "pi-1" },
  { event: "agent_end", session_id: "pi-1" },
  { event: "agent_settled", session_id: "pi-1" },
  { event: "session_shutdown", reason: "quit", session_id: "pi-1" },
].map((payload) => JSON.stringify(payload)).join("\n");

type Fixture = {
  sent: { path: string; text: string }[];
  stdinReads: number;
  options: CliOptions;
  fetches: number;
  provided: number;
};

function fixture(stdin: string, observeFails = false): Fixture {
  const fx: Fixture = {
    sent: [],
    stdinReads: 0,
    fetches: 0,
    provided: 0,
    options: {},
  };
  fx.options = {
    stdin() {
      fx.stdinReads += 1;
      return Promise.resolve(stdin);
    },
    // core를 부르면 센다.
    fetch() {
      fx.fetches += 1;
      return Promise.resolve({
        status: 500,
        headers: new Headers(),
        bytes: new Uint8Array(),
      });
    },
    provider() {
      fx.provided += 1;
      return Promise.resolve(err(CREDENTIAL_DELIVERY_FAILURES[0]));
    },
    ports: {
      observe(path, text) {
        fx.sent.push({ path, text });
        return Promise.resolve(
          observeFails
            ? err({ code: "unavailable", message: "관측 socket에 쓰지 못했다" })
            : ok(undefined),
        );
      },
    },
  };
  return fx;
}

Deno.test("coding-agent/sessions#R6 coding-agent/sessions#R9: session observe는 NDJSON stream을 정규화해 관측 socket에만 쓰고 core·credential을 부르지 않으며 stdout이 비어 있다", async () => {
  const fx = fixture(STREAM);
  // LOPHN_CONNECTION이 있는 coding credential context의 TUI 아래에서도 observe는 거절이 아니다.
  const done = await run(["session", "observe", "--hook", "pi"], {
    ...fx.options,
    env: ENV({
      LOPHN_TERMINAL_OBSERVE: "/run/user/1000/lophn/obs.sock",
      LOPHN_CONNECTION: CAC,
    }),
  });
  assertEquals(done.exit, 0, done.stderr);
  // hook stdout은 제품이 model context로 읽을 수 있어 비어 있다.
  assertEquals(done.stdout, "");
  assertEquals(fx.sent.length, 1);
  assertEquals(fx.sent[0].path, "/run/user/1000/lophn/obs.sock");
  const lines = fx.sent[0].text.split("\n").filter((line) => line !== "");
  const observations = lines.map((line) =>
    harnessSessionObservationSchema.parse(JSON.parse(line))
  );
  assertEquals(
    observations.map((item) => [item.state, item.evidence_ref]),
    [
      ["ready", "pi:session_start"],
      ["working", "pi:agent_start"],
      ["ready", "pi:agent_settled"],
    ],
  );
  assertEquals(observations[0].provider_session?.id, "pi-1");
  assertEquals(
    observations[0].provider_session?.transcript_path,
    "/s/pi-1.jsonl",
  );
  // 소유·runtime·connection·ticket은 helper가 주장하지 않는다. host가 envelope와 함께 붙인다(R8).
  for (const item of observations) {
    assertEquals(item.origin, "external_terminal");
    assertEquals(item.runtime_ref, null);
    assertEquals(item.connection, null);
    assertEquals(item.ticket, null);
  }
  // claim과 credential은 건드리지 않는다(R9).
  assertEquals(fx.fetches, 0);
  assertEquals(fx.provided, 0);
});

Deno.test("coding-agent/harnesses#R11: 관측 socket 환경이 없으면 stdin도 읽지 않고 아무것도 보내지 않는다", async () => {
  const fx = fixture(STREAM);
  const done = await run(["session", "observe", "--hook", "claude"], {
    ...fx.options,
    env: ENV(),
  });
  assertEquals(done.exit, 0, done.stderr);
  assertEquals(done.stdout, "");
  assertEquals(fx.sent.length, 0);
  assertEquals(fx.stdinReads, 0);
});

Deno.test("coding-agent/sessions#R6: 상태 evidence가 없는 payload나 보내지 못한 socket은 harness 작업을 막지 않는다", async () => {
  const noState = fixture(JSON.stringify({ event: "agent_end" }));
  const ignored = await run(["session", "observe", "--hook", "pi"], {
    ...noState.options,
    env: ENV({ LOPHN_TERMINAL_OBSERVE: "/run/obs.sock" }),
  });
  assertEquals(ignored.exit, 0);
  assertEquals(noState.sent.length, 0);

  const broken = fixture(STREAM, true);
  const failed = await run(["session", "observe", "--hook", "pi"], {
    ...broken.options,
    env: ENV({ LOPHN_TERMINAL_OBSERVE: "/run/obs.sock" }),
  });
  // exit 0이고 stdout은 비어 있으며 진단은 stderr 한 줄이다.
  assertEquals(failed.exit, 0);
  assertEquals(failed.stdout, "");
  assert(failed.stderr.includes("관측 socket에 쓰지 못했다"));
  // 상대 경로나 제어 문자가 든 socket 환경은 쓰지 않는다.
  const relative = fixture(STREAM);
  const refused = await run(["session", "observe", "--hook", "pi"], {
    ...relative.options,
    env: ENV({ LOPHN_TERMINAL_OBSERVE: "relative.sock" }),
  });
  assertEquals(refused.exit, 0);
  assertEquals(relative.sent.length, 0);
  assertFalse(refused.stdout.includes("session_start"));
});

Deno.test("coding-agent/sessions#R6: 알 수 없는 --hook 제품은 실행 전 거절이다", async () => {
  const fx = fixture(STREAM);
  const bad = await run(["session", "observe", "--hook", "nope"], {
    ...fx.options,
    env: ENV({ LOPHN_TERMINAL_OBSERVE: "/run/obs.sock" }),
  });
  assert(bad.exit !== 0);
  assertEquals(fx.sent.length, 0);
});

Deno.test("coding-agent/sessions#R6: 실제 Unix socket에는 observation NDJSON만 쓰인다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-observe-" });
  const path = `${dir}/obs.sock`;
  const listener = Deno.listen({ transport: "unix", path });
  try {
    const received = (async () => {
      const connection = await listener.accept();
      const chunks: Uint8Array[] = [];
      for await (const chunk of connection.readable) chunks.push(chunk);
      return new TextDecoder().decode(
        new Uint8Array(chunks.flatMap((chunk) => [...chunk])),
      );
    })();
    const fx = fixture(STREAM);
    // 기본 observe port(실제 socket 쓰기)를 쓴다.
    const done = await run(["session", "observe", "--hook", "pi"], {
      stdin: fx.options.stdin,
      env: ENV({ LOPHN_TERMINAL_OBSERVE: path, LOPHN_CONNECTION: CAC }),
    });
    assertEquals(done.exit, 0, done.stderr);
    const text = await received;
    const states = text.split("\n").filter((line) => line !== "").map((line) =>
      JSON.parse(line).state
    );
    assertEquals(states, ["ready", "working", "ready"]);
    // token·credential 같은 값은 한 줄에도 없다.
    assertFalse(text.includes("token"));
    assertFalse(text.includes(CAC));
  } finally {
    listener.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("coding-agent/harnesses#R11: 권한 계획은 환경의 관측 socket 하나만 읽기·쓰기로 열고 없으면 아무것도 열지 않는다", async () => {
  const roots = (socket: string | undefined) => ({
    home: "/h",
    env: {
      get: (name: string) =>
        name === "LOPHN_TERMINAL_OBSERVE" ? socket : undefined,
    },
  });
  const none = { sourceDirOf: () => Promise.resolve(undefined) };
  const planned = await planSelection({
    command: "session observe",
    input: {},
    roots: roots("/run/user/1000/lophn/obs.sock"),
  }, none);
  assertEquals(selectionFlags(planned), [
    "--allow-read=/run/user/1000/lophn/obs.sock",
    "--allow-write=/run/user/1000/lophn/obs.sock",
  ]);
  for (const socket of [undefined, "relative.sock", "/a/../b.sock"]) {
    const refused = await planSelection({
      command: "session observe",
      input: {},
      roots: roots(socket),
    }, none);
    assertEquals(selectionFlags(refused), [], String(socket));
  }
});
