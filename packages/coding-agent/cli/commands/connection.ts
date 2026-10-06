// `lophn connection list|show|create|revoke|install` command의 route 표와 실행 결정이다(T36,
// coding-agent/cli#R40, connection#R2, R9, R12, harnesses#R6). list·show는 원문 token·hash 없는
// connection을 소유 읽기 route로 읽는다. create·revoke는 사람의 결정이라 CLI가 사람 credential을
// 읽지 않고 shell main의 연결 화면이 받는다(이 표는 안내만 한다). install은 기존 connection의 선택
// target 재설치이고 자동 재발급이 없다. 그리고 사람의 연결 결정 흐름을 shell main이 부를 순서 그대로
// 묶은 `connectAndInstall`(사람 선택 → 신뢰 경계 token·keychain → core create → 선택 target 설치 →
// doctor)을 둔다. token은 이 흐름의 어디에도 지나지 않는다.
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  cliConnectionCreateSchema,
  cliConnectionInstallSchema,
  cliConnectionListSchema,
  cliConnectionRevokeSchema,
  cliConnectionShowSchema,
  type ConnectionId,
  connectionIdSchema,
  connectionList,
  type ConnectionScope,
  connectionShow,
  decisionLink,
  type IntegrationTarget,
} from "../../../contracts/coding-agent/mod.ts";
import type { InstallOutcome } from "../../harnesses/mod.ts";
import type { DoctorReport } from "./doctor.ts";
import type { CommandEntry } from "./types.ts";

export const CONNECTION_COMMANDS: readonly CommandEntry[] = [
  {
    name: "connection list",
    input: cliConnectionListSchema,
    monoRoute: connectionList,
  },
  {
    name: "connection show",
    input: cliConnectionShowSchema,
    monoRoute: connectionShow,
  },
  { name: "connection create", input: cliConnectionCreateSchema },
  { name: "connection revoke", input: cliConnectionRevokeSchema },
  { name: "connection install", input: cliConnectionInstallSchema },
];

// 연결 생성은 lophn 연결 화면에서 사람이 고른다. CLI는 사람 credential을 읽지 않으므로 실행하지 않고
// 어디서 하는지만 안내한다(cli#R7). 연결 생성은 확인 창이 없다.
export function humanDecisionGuide(
  name: "connection create",
): { summary: string; data: unknown; next: string[]; isError: true } {
  return {
    summary: "연결 생성은 lophn 연결 화면에서 사람이 고른다",
    data: { command: name, human_only: true },
    next: [
      "lophn 창의 Connection 화면에서 진행한다. CLI는 token도 사람 credential도 받지 않는다",
    ],
    isError: true,
  };
}

// 연결 회수는 confirmation window에서 사람이 결정한다(connection#R2, cli#R7). CLI는 창을 열지도
// 연결을 읽지도 않고 결정 화면 링크와 기다린다는 사실만 낸다. 대상 연결이 있든 없든, 범위 안이든
// 밖이든 같은 답이라 존재를 드러내지 않는다. 회수가 일어났다고도, 외부 프로세스·OS 파일 편집을
// 멈춘다고도 말하지 않는다(connection#R18).
export function connectionRevokeGuide(
  input: { connection: ConnectionId; base_revision: string },
): { summary: string; data: unknown; next: string[]; isError: true } {
  const link = decisionLink(input.connection);
  return {
    summary:
      "연결 회수는 사람이 lophn 확인 창에서 결정한다. 사람의 결정을 기다리는 중이고 아무것도 회수하지 않았다",
    data: {
      command: "connection revoke",
      human_only: true,
      connection: input.connection,
      base_revision: input.base_revision,
      decision_link: link,
      waiting: true,
      window_opened: false,
      revoked: false,
    },
    next: [
      `사람이 ${link}에서 연결과 판을 보고 결정한다. 창을 닫거나 결정이 없으면 연결은 그대로다`,
      "회수는 그 연결의 새 요청 인증을 거절한다. 이미 떠 있는 외부 프로세스나 OS 파일 편집을 멈추지는 않는다",
    ],
    isError: true,
  };
}

export type ConnectionInstallDeps = {
  // 호출 주체다. 연결 참조(LOPHN_CONNECTION)로 시작한 coding credential context는 관리 쓰기를 거절한다
  // (cli#R40, connection#R2).
  actor: "user" | "coding_agent";
  // connection 상태 읽기다. 원문 token·hash는 받지 않는다.
  connections: {
    read(id: string): Promise<Result<{ state: "active" | "revoked" }>>;
  };
  // 선택 target 설치다. 조립이 root·launch·store를 묶어 준다.
  install(
    connection: ConnectionId,
    target: IntegrationTarget,
  ): Promise<Result<InstallOutcome>>;
};

export type CommandOutput = {
  summary: string;
  data: unknown;
  next: string[];
  isError?: true;
};

function failed(
  summary: string,
  data: unknown,
  next: string[],
): CommandOutput {
  return { summary, data, next, isError: true };
}

// 설치 결과를 사람·기계가 같은 모양으로 읽는 값이다. 설치 실패는 connection 성공과 따로 보이고
// credential을 다시 만들거나 회수하지 않는다.
export function describeInstall(
  connection: ConnectionId,
  outcome: InstallOutcome,
): CommandOutput {
  const data = {
    connection,
    install: outcome.status,
    resources: outcome.resources,
    notices: outcome.notices,
    receipt_stored: outcome.receipt_stored,
    recovery_pending: outcome.recovery_pending,
  };
  if (outcome.status === "complete") {
    return {
      summary: `연결 ${connection}의 선택 target 설치를 마쳤다`,
      data,
      next: [
        "`lophn doctor`로 loading 단계를 확인한다(설치 성공이 loading 성공은 아니다)",
      ],
    };
  }
  return failed(
    outcome.status === "partial"
      ? `연결 ${connection}의 설치가 일부만 됐다. 연결 credential은 그대로다`
      : `연결 ${connection}의 설치를 하지 못했다. 연결 credential은 그대로다`,
    data,
    [
      "resource별 결과의 충돌·실패를 사람이 확인한 뒤 `lophn connection install`을 다시 실행한다. credential은 다시 만들지 않는다",
    ],
  );
}

// `connection install`: 기존 connection의 선택 target 재설치다(harnesses#R6, cli#R40). 감지된 다른
// 제품은 바꾸지 않고 회수된 connection은 거절하며 자동 재발급이 없다(connection#R9).
export async function runConnectionInstall(
  input: { connection?: string; target: IntegrationTarget },
  deps: ConnectionInstallDeps,
): Promise<Result<CommandOutput, LophnError>> {
  if (deps.actor !== "user") {
    return err({
      code: "forbidden",
      message: "연결 설치는 사람 전용이다",
    });
  }
  const parsed = connectionIdSchema.safeParse(input.connection);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "연결 참조(--connection)가 필요하다",
    });
  }
  const connection = parsed.data;
  const read = await deps.connections.read(connection);
  if (!read.ok) {
    return err(
      read.error.code === "not_found"
        ? { code: "not_found", message: "연결을 읽을 수 없다" }
        : read.error,
    );
  }
  if (read.value.state !== "active") {
    // 회수된 연결을 되살리거나 새로 발급하지 않는다. 사람이 새 연결을 만든다.
    return ok(failed(
      `연결 ${connection}은 회수됐다. 설치하지 않았다`,
      { connection, state: read.value.state },
      ["사람이 lophn 연결 화면에서 새 연결을 만든다. 회수된 연결은 되살리지 않는다"],
    ));
  }
  const installed = await deps.install(connection, input.target);
  if (!installed.ok) return installed;
  return ok(describeInstall(connection, installed.value));
}

export type ConnectFlowPorts = {
  // 사람 선택(이름·범위) 뒤 신뢰 경계가 token을 발급·keychain에 보관하고 core create를 보낸다
  // (core `connect` route). 결과는 connection 참조뿐이다.
  connect(input: {
    label: string;
    scope: ConnectionScope;
  }): Promise<Result<{ connection: ConnectionId }>>;
  install(
    connection: ConnectionId,
    target: IntegrationTarget,
  ): Promise<Result<InstallOutcome>>;
  doctor(
    connection: ConnectionId,
    target: IntegrationTarget,
  ): Promise<Result<DoctorReport>>;
};

export type ConnectFlowResult = {
  connection: ConnectionId;
  install:
    | { status: InstallOutcome["status"]; outcome: InstallOutcome }
    | { status: "error"; error: LophnError };
  doctor: DoctorReport | null;
};

// 사람 선택 → connection 생성 → 선택 target 설치 → doctor다. token을 만들거나 붙여 넣는 단계가
// 없고 연결 생성에 확인 창이 없다(connection#R2). 보관 준비가 실패하면 connection이 생기지 않아
// 설치·doctor를 시작하지 않는다. 설치 실패·일부 실패는 이미 생긴 connection을 회수하거나 다시
// 발급하지 않고 따로 보인다(R12). doctor는 읽기만 한다.
export async function connectAndInstall(
  input: {
    label: string;
    scope: ConnectionScope;
    target: IntegrationTarget;
  },
  ports: ConnectFlowPorts,
): Promise<Result<ConnectFlowResult, LophnError>> {
  // 같은 앱을 가리키지 않는 앱 범위 연결·앱 target은 발급 전에 거절한다.
  if (
    input.scope.kind === "app" && input.target.scope_kind === "app" &&
    input.target.app !== input.scope.app
  ) {
    return err({
      code: "invalid_input",
      message: "연결 범위의 앱과 설치 target의 앱이 다르다",
    });
  }
  const connected = await ports.connect({
    label: input.label,
    scope: input.scope,
  });
  if (!connected.ok) return connected;
  const connection = connected.value.connection;
  const installed = await ports.install(connection, input.target).catch((
    caught,
  ): Result<InstallOutcome> =>
    err({
      code: "unavailable",
      message: caught instanceof Error ? "설치를 끝내지 못했다" : "설치 실패",
    })
  );
  const doctor = await ports.doctor(connection, input.target).catch((): Result<
    DoctorReport
  > => err({ code: "unavailable", message: "doctor를 끝내지 못했다" }));
  return ok({
    connection,
    install: installed.ok
      ? { status: installed.value.status, outcome: installed.value }
      : { status: "error", error: installed.error },
    doctor: doctor.ok ? doctor.value : null,
  });
}
