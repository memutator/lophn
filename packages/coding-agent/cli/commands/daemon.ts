// `lophn daemon start|stop|status|logs` command의 route 표와 실행 결정이다
// (T37, cli#R6, R8). start·stop은 launcher가 실행할 결정을 내놓고(platform#T55,
// 창 없는 시작 desktop#R21), status·logs는 OS 사용자 권한으로 `H/run` metadata와
// `H/logs`의 안전 log를 읽는다. API token도 coding credential도 쓰지 않는다.
// start·stop은 사람 전용이라 coding credential context는 실행 전 거절이다
// (cli#R6). 실제 process 결정은 플랫폼 설치·시작의 몫이라 이 자리는 port로
// 받는다(connection credential의 provider interface 같은 모양).
import {
  cliDaemonLogsSchema,
  cliDaemonStartSchema,
  cliDaemonStatusSchema,
  cliDaemonStopSchema,
  HUMAN_ONLY_NAMES,
} from "../../../contracts/coding-agent/mod.ts";
import { QUIT_FLAG, TRAY_FLAG } from "../../../contracts/shell/mod.ts";
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import type { CommandEntry } from "./types.ts";

export const DAEMON_COMMANDS: readonly CommandEntry[] = [
  {
    name: "daemon start",
    input: cliDaemonStartSchema,
  },
  {
    name: "daemon stop",
    input: cliDaemonStopSchema,
  },
  {
    name: "daemon status",
    input: cliDaemonStatusSchema,
  },
  {
    name: "daemon logs",
    input: cliDaemonLogsSchema,
  },
];

// 사람 전용 command의 실행 전 거절이다(cli#R6). coding credential context에서
// daemon start·stop을 고르면 forbidden이다. user credential fallback은 없다
// (R6 확인). 표 밖 command는 애초에 표에 없다.
export function daemonHumanOnlyGate(
  command: string,
  actor: "user" | "coding_agent",
): Result<void> {
  if (!(HUMAN_ONLY_NAMES as readonly string[]).includes(command)) {
    return ok(undefined);
  }
  return actor === "user" ? ok(undefined) : err({
    code: "forbidden",
    message: "daemon 시작·중지는 사람 전용이다",
  });
}

// 플랫폼 설치·시작이 채우는 port다(T37 쓰는 contract). 결정은 인자로 받는다.
// 창 없는 시작은 `--tray`, 명시 종료는 single-instance 통로 `--quit`이다(shell
// launch contract, platform#T55). metadata·상태·log 읽기는 token이 없다(R8).
export type DaemonPort = {
  // launcher가 실행할 창 없는 시작 결정. 실행 이름은 설치 contract의 고정 이름이다.
  start(): Promise<Result<{ executable: string; argv: readonly string[] }>>;
  // 거절 이유를 그대로 돌려주는 실패 결정이다. 사람 전용 거절에서 쓴다.
  startFail(error: LophnError): Promise<Result<never>>;
  // OS single-instance 통로로 보내는 명시 종료 요청.
  stop(): Promise<Result<{ executable: string; argv: readonly string[] }>>;
  stopFail(error: LophnError): Promise<Result<never>>;
  // lock 판정과 `H/run` metadata 존재 여부다. 비정상 종료는 metadata를 남겨 둔다.
  status(): Promise<
    Result<
      {
        state: "absent" | "running" | "conflict";
        metadata: "present" | "absent";
      }
    >
  >;
  // `H/run` 위치 metadata다. port·epoch·시각만 있고 credential은 없다.
  runMetadata(): Promise<
    Result<{ api_port: number; core_epoch: string; started_at: string }>
  >;
};

type DaemonContext = {
  actor: "user" | "coding_agent";
  port: DaemonPort;
};

// 시작 요청이다. launcher가 창 없는 Electron main을 띄운다(R8). 이미 실행 중인
// 상태도 port 결정 그대로 내놓는다(접수와 실제 상태의 구별은 port가 한다).
export function daemonStartRequest(
  context: DaemonContext,
): Promise<Result<{ executable: string; argv: readonly string[] }>> {
  const gate = daemonHumanOnlyGate("daemon start", context.actor);
  if (!gate.ok) return context.port.startFail(gate.error);
  return context.port.start();
}

// 명시 종료 요청이다. OS single-instance 통로로 실행 중인 main에 `--quit`을
// 보낸다. token이 없으므로 권한은 OS 사용자 권한 하나다(R8).
export function daemonStopRequest(
  context: DaemonContext,
): Promise<Result<{ executable: string; argv: readonly string[] }>> {
  const gate = daemonHumanOnlyGate("daemon stop", context.actor);
  if (!gate.ok) return context.port.stopFail(gate.error);
  return context.port.stop();
}

// 현재 상태다. 이미 시작·중지된 상태도 현재 상태로 응답한다(R8 확인). 상태는
// lock 판정 그대로고 metadata 부재는 상태를 바꾸지 않는다.
export function daemonStatusRequest(
  context: DaemonContext,
): Promise<
  Result<
    { state: "absent" | "running" | "conflict"; metadata: "present" | "absent" }
  >
> {
  return context.port.status();
}

// 현재 연결 상태다. `H/run` 위치 metadata가 있으면 connected다. metadata에는
// port·epoch만 있고 credential은 없으므로 token 없이 읽는다(R8).
export async function daemonConnectionRequest(
  context: DaemonContext,
): Promise<Result<"connected" | "disconnected">> {
  const read = await context.port.runMetadata();
  return read.ok ? ok("connected") : ok("disconnected");
}

// 안전 log tail이다. `H/logs`의 platform-N.jsonl을 안전 log 순서(오래된 파일이
// 뒤)로 읽는다. 안전 log는 쓰는 쪽에서 redaction을 통과했다(platform/diagnostics#R5)
// 그래서 읽는 쪽에서 다시 거르지 않는다. 파일 수·이름은 OS 사용자 권한의 고정
// 위치라 token도 credential도 없다(R8). 입력 검사는 schema가 이미 했다.
export type DaemonLogsInput = {
  cursor?: string;
  lines?: number;
};

export type DaemonLogFiles = {
  // 안전 log 파일의 전체 경로다. 오래된 것부터 순서대로 준다.
  paths(): readonly string[];
};

export async function daemonLogsRead(
  files: DaemonLogFiles,
  input: DaemonLogsInput = {},
): Promise<Result<{ lines: string[]; next_cursor: string | null }>> {
  const lines: string[] = [];
  for (const path of files.paths()) {
    let text: string;
    try {
      text = await Deno.readTextFile(path);
    } catch (thrown) {
      if (thrown instanceof Deno.errors.NotFound) continue;
      return err({
        code: "unavailable",
        message: "daemon log를 읽을 수 없다",
      });
    }
    for (const line of text.split("\n")) {
      if (line) lines.push(line);
    }
  }
  const size = input.lines ?? lines.length;
  const start = input.cursor === undefined ? 0 : Number(input.cursor);
  const selected = lines.slice(start, start + size);
  const next = start + selected.length;
  return ok({
    lines: selected,
    next_cursor: next < lines.length ? `${next}` : null,
  });
}

// launcher 결정의 argv 모양이다. 창 없는 시작과 명시 종료의 intent flag만 있다
// (desktop#R21: second-instance argv에서 읽는 것은 `--quit`뿐이다).
export function findDaemonCommand(name: string): CommandEntry | undefined {
  return DAEMON_COMMANDS.find((entry) => entry.name === name);
}

// launch intent flag는 tray·quit 둘이다(desktop#R21: second-instance argv에서
// 읽는 것은 `--quit`뿐이다).
export const DAEMON_LAUNCH_FLAGS = [TRAY_FLAG, QUIT_FLAG] as const;
