// `lophn daemon` command 테스트다(cli#R6, R8). 사람 전용 거절, port 결정의
// 전달, `H/logs` 안전 log 읽기를 temp dir에서만 본다. 사람의 실제 데이터
// root는 열지 않는다. launcher 결정 자체는 platform#T55의 테스트가 맡으므로
// 여기서는 port를 fake로 주입해 command 쪽 동작만 본다.
import { assert, assertEquals } from "@std/assert";
import {
  DAEMON_COMMANDS,
  DAEMON_LAUNCH_FLAGS,
  daemonConnectionRequest,
  daemonHumanOnlyGate,
  type DaemonLogsInput,
  daemonLogsRead,
  type DaemonPort,
  daemonStartRequest,
  daemonStatusRequest,
  daemonStopRequest,
  findDaemonCommand,
} from "./daemon.ts";
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";

// 거절 결정의 공통 모양이다. 인자를 그대로 실패 Result로 돌려준다.
function failDecision(error: LophnError): Result<never> {
  return err(error);
}

type Decision = Result<{ executable: string; argv: readonly string[] }>;

type PortFacts = {
  status?: {
    state: "absent" | "running" | "conflict";
    metadata: "present" | "absent";
  };
  metadata?: Result<
    { api_port: number; core_epoch: string; started_at: string }
  >;
};

// temp dir 기준 fake port다. launcher 결정과 같은 argv 모양을 내놓는다.
function fakePort(facts: PortFacts = {}): DaemonPort {
  return {
    start(): Promise<Decision> {
      return Promise.resolve(
        ok({ executable: "lophn-desktop", argv: ["--tray"] }),
      );
    },
    startFail(error): Promise<Result<never>> {
      return Promise.resolve(failDecision(error));
    },
    stop(): Promise<Decision> {
      return Promise.resolve(
        ok({ executable: "lophn-desktop", argv: ["--quit"] }),
      );
    },
    stopFail(error): Promise<Result<never>> {
      return Promise.resolve(failDecision(error));
    },
    status(): Promise<
      PortFacts["status"] extends undefined ? never
        : NonNullable<PortFacts["status"]> extends never ? never
        : Result<NonNullable<PortFacts["status"]>>
    > {
      return Promise.resolve(
        ok(facts.status ?? { state: "absent", metadata: "absent" }),
      ) as Promise<Result<NonNullable<PortFacts["status"]>>>;
    },
    runMetadata(): Promise<
      Result<{ api_port: number; core_epoch: string; started_at: string }>
    > {
      return Promise.resolve(
        facts.metadata ??
          err({ code: "not_found", message: "실행 중인 instance가 없다" }),
      );
    },
  };
}

Deno.test("coding-agent/cli#R6: daemon start·stop은 coding credential에서 forbidden 거절이다", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-cli-gate-" });
  try {
    const gateStart = daemonHumanOnlyGate("daemon start", "coding_agent");
    assert(!gateStart.ok);
    assertEquals(gateStart.error.code, "forbidden");
    const gateStop = daemonHumanOnlyGate("daemon stop", "coding_agent");
    assert(!gateStop.ok);
    assertEquals(gateStop.error.code, "forbidden");
    // port를 통과해도 요청은 거절이다. user fallback은 없다(R6 확인).
    const context = { actor: "coding_agent" as const, port: fakePort() };
    const rejectedStart = await daemonStartRequest(context);
    assert(!rejectedStart.ok);
    assertEquals(rejectedStart.error.code, "forbidden");
    const rejectedStop = await daemonStopRequest(context);
    assert(!rejectedStop.ok);
    assertEquals(rejectedStop.error.code, "forbidden");
    // user actor는 같은 command를 통과한다.
    assert(daemonHumanOnlyGate("daemon start", "user").ok);
    assert(daemonHumanOnlyGate("daemon stop", "user").ok);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R6: coding credential은 status·logs 읽기를 거절하지 않는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-cli-read-" });
  try {
    // status·logs는 사람 전용이 아니다. coding credential에서도 읽는다.
    const gateStatus = daemonHumanOnlyGate("daemon status", "coding_agent");
    assert(gateStatus.ok);
    const gateLogs = daemonHumanOnlyGate("daemon logs", "coding_agent");
    assert(gateLogs.ok);
    // status도 token 없이 응답한다(R8).
    const context = { actor: "coding_agent" as const, port: fakePort() };
    const status = await daemonStatusRequest(context);
    assert(status.ok);
    assertEquals(status.value.state, "absent");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R8: daemon start는 launcher에 창 없는 tray 결정을 요청한다", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-cli-start-" });
  try {
    const context = { actor: "user" as const, port: fakePort() };
    const started = await daemonStartRequest(context);
    assert(started.ok);
    assertEquals(started.value.executable, "lophn-desktop");
    assertEquals(started.value.argv, ["--tray"]);
    // 이미 시작된 상태도 같은 결정 경로다(port가 접수와 실제를 구별한다).
    const again = await daemonStartRequest(context);
    assert(again.ok);
    assertEquals(again.value.argv, ["--tray"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R8: 이미 시작된 daemon도 현재 상태로 응답한다", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-cli-running-" });
  try {
    // running이어도 status는 현재 상태 그대로다(R8 확인).
    const context = {
      actor: "user" as const,
      port: fakePort({
        status: { state: "running", metadata: "absent" },
      }),
    };
    const status = await daemonStatusRequest(context);
    assert(status.ok);
    assertEquals(status.value.state, "running");
    // 접수와 실제 상태의 구별: metadata가 없으면 present가 아니다.
    assertEquals(status.value.metadata, "absent");
    // 중지된 상태도 현재 상태로 응답한다.
    const absent = await daemonStatusRequest({
      actor: "user" as const,
      port: fakePort(),
    });
    assert(absent.ok);
    assertEquals(absent.value.state, "absent");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R8: daemon stop은 single-instance --quit 요청이다", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-cli-stop-" });
  try {
    const context = { actor: "user" as const, port: fakePort() };
    const stopped = await daemonStopRequest(context);
    assert(stopped.ok);
    assertEquals(stopped.value.executable, "lophn-desktop");
    assertEquals(stopped.value.argv, ["--quit"]);
    // 이미 중지된 상태에서도 같은 요청이다.
    const again = await daemonStopRequest(context);
    assert(again.ok);
    assertEquals(again.value.argv, ["--quit"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R8: daemon 장애의 안전한 이유는 port 응답 그대로다", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-cli-fault-" });
  try {
    // lock 결함은 conflict 응답이다. message에는 경로·token이 없다(R8 확인).
    const context = {
      actor: "user" as const,
      port: fakePort({
        status: { state: "conflict", metadata: "absent" },
      }),
    };
    const status = await daemonStatusRequest(context);
    assert(status.ok);
    assertEquals(status.value.state, "conflict");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R8: daemon status는 token 없이 H/run metadata 유무를 읽는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-cli-meta-" });
  try {
    // metadata가 있으면 connected다. metadata에는 port·epoch만 있고 credential은 없다.
    const connected = await daemonConnectionRequest({
      actor: "user" as const,
      port: fakePort({
        metadata: ok({
          api_port: 7442,
          core_epoch: "0123456789abcdef",
          started_at: "2026-10-05T00:00:00.000Z",
        }),
      }),
    });
    assert(connected.ok);
    assertEquals(connected.value, "connected");
    // metadata가 없으면 disconnected다.
    const disconnected = await daemonConnectionRequest({
      actor: "user" as const,
      port: fakePort(),
    });
    assert(disconnected.ok);
    assertEquals(disconnected.value, "disconnected");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R8: daemon logs는 안전 log를 cursor·lines로 읽는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-cli-logs-" });
  try {
    await Deno.mkdir(`${root}/logs`);
    // 안전 log는 쓰는 쪽에서 redaction을 통과한 JSONL이다(platform/diagnostics#R5).
    await Deno.writeTextFile(
      `${root}/logs/platform-4.jsonl`,
      '{"kind":"unattributed_observation"}\n',
    );
    await Deno.writeTextFile(
      `${root}/logs/platform-3.jsonl`,
      '{"kind":"unattributed_observation","count":2}\n',
    );
    await Deno.writeTextFile(
      `${root}/logs/platform-0.jsonl`,
      '{"kind":"lophn_internal"}\n',
    );
    // 오래된 파일이 뒤다: platform-4 → platform-0 순서로 읽는다.
    const paths = Array.from(
      { length: 5 },
      (_, i) => `${root}/logs/platform-${4 - i}.jsonl`,
    );
    const logFiles = { paths: () => paths };
    const first = await daemonLogsRead(logFiles);
    assert(first.ok);
    assertEquals(first.value.lines, [
      '{"kind":"unattributed_observation"}',
      '{"kind":"unattributed_observation","count":2}',
      '{"kind":"lophn_internal"}',
    ]);
    assertEquals(first.value.next_cursor, null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R8: daemon logs는 lines·cursor가 대상 줄을 고르고 없는 파일은 건너뛴다", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-cli-logs2-" });
  try {
    await Deno.mkdir(`${root}/logs`);
    await Deno.writeTextFile(
      `${root}/logs/platform-4.jsonl`,
      "a\nb\nc\n",
    );
    const logFiles = { paths: () => [`${root}/logs/platform-4.jsonl`] };
    const input: DaemonLogsInput = { lines: 1 };
    const page = await daemonLogsRead(logFiles, input);
    assert(page.ok);
    assertEquals(page.value.lines, ["a"]);
    assertEquals(page.value.next_cursor, "1");
    const second = await daemonLogsRead(logFiles, {
      cursor: page.value.next_cursor ?? undefined,
      lines: 1,
    });
    assert(second.ok);
    assertEquals(second.value.lines, ["b"]);
    assertEquals(second.value.next_cursor, "2");
    // 파일 부재는 빈 읽기다. 이미 중지된 상태와 같다.
    const empty = await daemonLogsRead({
      paths: () => [`${root}/logs/platform-0.jsonl`],
    });
    assert(empty.ok);
    assertEquals(empty.value.lines, []);
    assertEquals(empty.value.next_cursor, null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R8: daemon command 넷은 registry 표에 있다", () => {
  const names = DAEMON_COMMANDS.map((entry) => entry.name);
  assertEquals(names, [
    "daemon start",
    "daemon stop",
    "daemon status",
    "daemon logs",
  ]);
  assertEquals(
    findDaemonCommand("daemon status")?.name,
    "daemon status",
  );
  assertEquals(findDaemonCommand("daemon no"), undefined);
  // launch intent flag는 tray·quit 둘이다(desktop#R21).
  assertEquals(DAEMON_LAUNCH_FLAGS, ["--tray", "--quit"]);
});
