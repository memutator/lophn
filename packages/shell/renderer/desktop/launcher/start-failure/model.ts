// 시작 실패 화면의 다섯 경우. core 연결 상태가 어느 경우인지 정한다.
import type { MessageKey } from "@lophn/wording";
import type { ConnectionState } from "../../../../ipc/core.ts";

export type SchemaReason = NonNullable<ConnectionState["schemaFailure"]>;

export type StartFailureKind = "start" | "sandbox" | SchemaReason;

export interface StartFailure {
  kind: StartFailureKind;
  title: MessageKey;
  text: MessageKey;
  /** update 안내. schema 세 경우에만 있다. */
  update?: MessageKey;
  /** 접힌 자세히에 보이는 검사 내용 한 줄. */
  details?: MessageKey;
}

const SCHEMA: Record<SchemaReason, StartFailure> = {
  newer_schema: {
    kind: "newer_schema",
    title: "launcher.title.newer-schema",
    text: "launcher.failure.newer-schema",
    update: "launcher.failure.update-newer-schema",
    details: "launcher.failure.check-newer-schema",
  },
  history_mismatch: {
    kind: "history_mismatch",
    title: "launcher.title.history-mismatch",
    text: "launcher.failure.history-mismatch",
    update: "launcher.failure.update-history-mismatch",
    details: "launcher.failure.check-history-mismatch",
  },
  damaged_original: {
    kind: "damaged_original",
    title: "launcher.title.damaged-original",
    text: "launcher.failure.damaged-original",
    update: "launcher.failure.update-damaged-original",
    details: "launcher.failure.check-damaged-original",
  },
};

/** Core 시작 실패: daemon lock 확인, 프로세스 상태 확인 실패, binary 못 찾음. */
export function startFailure(): StartFailure {
  return {
    kind: "start",
    title: "launcher.title.start-failed",
    text: "launcher.failure.start-failed",
  };
}

/** Sandbox 실패: security settings 적용 불가, permissions 오류. */
export function sandboxFailure(): StartFailure {
  return {
    kind: "sandbox",
    title: "launcher.title.sandbox-failed",
    text: "launcher.failure.sandbox-failed",
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
    case "failed-sandbox":
      return sandboxFailure();
    case "failed-schema":
      return schemaFailure(connection.schemaFailure);
    default:
      return null;
  }
}
