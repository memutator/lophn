// 시작 실패 화면의 네 경우. core 연결 상태가 어느 경우인지 정한다.
import type { MessageKey } from "@lophn/i18n";
import type { ConnectionState } from "../../../../ipc/core.ts";

type SchemaReason = NonNullable<ConnectionState["schemaFailure"]>;

type StartFailureKind = "start" | SchemaReason;

export interface StartFailure {
  kind: StartFailureKind;
  title: MessageKey;
  text: MessageKey;
  /** update 안내. schema 세 경우에만 있다. */
  update?: MessageKey;
  /** 복구본(마지막 변환 전 ledger)으로 손수 되돌리는 길. 새 판을 받아도 풀리지 않는 손상·어긋난 이력에만 있다. */
  recovery?: MessageKey;
  /** 접힌 자세히에 보이는 검사 내용 한 줄. */
  details?: MessageKey;
}

const SCHEMA: Record<SchemaReason, StartFailure> = {
  newer_schema: {
    kind: "newer_schema",
    title: "home.title.newer-schema",
    text: "home.failure.newer-schema",
    update: "home.failure.update-newer-schema",
    details: "home.failure.check-newer-schema",
  },
  history_mismatch: {
    kind: "history_mismatch",
    title: "home.title.history-mismatch",
    text: "home.failure.history-mismatch",
    update: "home.failure.update-history-mismatch",
    recovery: "home.failure.recovery",
    details: "home.failure.check-history-mismatch",
  },
  damaged_original: {
    kind: "damaged_original",
    title: "home.title.damaged-original",
    text: "home.failure.damaged-original",
    update: "home.failure.update-damaged-original",
    recovery: "home.failure.recovery",
    details: "home.failure.check-damaged-original",
  },
};

/** Core 시작 실패: daemon lock 확인, 프로세스 상태 확인 실패, binary 못 찾음. */
function startFailure(): StartFailure {
  return {
    kind: "start",
    title: "home.title.start-failed",
    text: "home.failure.start-failed",
  };
}

/** 높은 schema, hash가 다른 이력, 손상 원본. 이유가 없으면 높은 schema로 본다. */
export function schemaFailure(
  reason: SchemaReason = "newer_schema",
): StartFailure {
  return SCHEMA[reason];
}

/** 시작 실패 화면을 보여야 하면 그 경우, 아니면 null이다. */
export function failureOf(connection: ConnectionState): StartFailure | null {
  switch (connection.state) {
    case "failed-start":
      return startFailure();
    case "failed-schema":
      return schemaFailure(connection.schemaFailure);
    default:
      return null;
  }
}
