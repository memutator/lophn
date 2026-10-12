// broker `/_lophn/broker/invocations/submit`의 apps 쪽 구현(apps/invocations#R1, R5, R10).
// 앱이 응답 뒤에 보낸 기록 사실을 자식 연결의 신원(app·release·mode·process nonce)과 함께 core
// command 입력으로 바꿔 전달 목록에 넣는다. 신원은 본문이 정하지 않고, 앱이 보낸 사실이 신원 필드를
// 덮어쓰지도 못한다. 앱 업무 응답과는 이어지지 않는다. 자식이 사실을 다 보내지 못하고 끝나면 알려진
// 호출만 미확인으로 확정하고, 모르는 호출을 만들어 채우지 않는다.
import { type Clock, err, ok, type Result } from "../../../../base/mod.ts";
import {
  brokerInvocationSubmitInputSchema,
  invocationRecordDeniedInputSchema,
  invocationRecordFinishedInputSchema,
  invocationRecordStartedInputSchema,
} from "../../../../protocol/apps/mod.ts";

// 전달 목록에서 쓰는 모양만 본다. 목록 구현(apps/invocations/delivery)은 supervisor 쪽이 넘긴다.
export type BrokerQueue = {
  enqueue(message: {
    invocation: string;
    fact: "start" | "finish" | "deny";
    app: string;
    body: unknown;
  }): unknown;
  pump(): Promise<void>;
};

// 한 자식이 한 번에 열어 둘 수 있는 호출 수다. confirm marker 한도와 같다.
const OPEN_LIMIT = 4096;

export type BrokerChild = {
  app: string;
  // preview·test는 release가 없고 ledger 기록 대상이 아니다.
  release: string | null;
  mode: "live" | "preview" | "test";
  processNonce: string;
};

export type CoreRecordMethod =
  | "record_started"
  | "record_finished"
  | "record_denied";

// 전달 목록의 메시지 본문이다. core의 `/v1/invocations/<method>` 입력 그대로다.
export type CoreRecord = { method: CoreRecordMethod; input: unknown };

const IDENTITY_KEYS = ["invocation", "app", "release", "mode"] as const;

type Open = {
  app: string;
  release: string;
  mode: BrokerChild["mode"];
  startedAt: string;
};

export type InvocationBroker = {
  submit(child: BrokerChild, body: unknown): Result<{ accepted: true }>;
  // 자식 종료를 확인했다. 시작은 알렸지만 결과를 못 받은 호출은 미확인으로 확정한다.
  childExited(processNonce: string): number;
};

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

export function createInvocationBroker(deps: {
  queue: BrokerQueue;
  clock: Clock;
}): InvocationBroker {
  const open = new Map<string, Map<string, Open>>();

  function track(nonce: string, invocation: string, entry: Open): void {
    let list = open.get(nonce);
    if (!list) {
      list = new Map();
      open.set(nonce, list);
    }
    if (list.size < OPEN_LIMIT) list.set(invocation, entry);
  }

  function settle(nonce: string, invocation: string): void {
    const list = open.get(nonce);
    if (!list) return;
    list.delete(invocation);
    if (list.size === 0) open.delete(nonce);
  }

  function enqueue(
    child: { app: string },
    invocation: string,
    fact: "start" | "finish" | "deny",
    record: CoreRecord,
  ): void {
    deps.queue.enqueue({ invocation, fact, app: child.app, body: record });
    void deps.queue.pump();
  }

  return {
    submit(child, body) {
      const parsed = brokerInvocationSubmitInputSchema.safeParse(body);
      if (!parsed.success) return invalid("invocation submit is invalid");
      const submitted = parsed.data;
      if (
        submitted.process_nonce !== child.processNonce ||
        submitted.mode !== child.mode
      ) {
        return err({
          code: "unauthorized",
          message: "submit does not match the child connection",
        });
      }
      const fact = submitted.summary;
      if (
        fact === null || typeof fact !== "object" || Array.isArray(fact) ||
        IDENTITY_KEYS.some((key) => key in fact)
      ) {
        return invalid("invocation fact is invalid");
      }
      // preview·test 자식에는 release가 없어 ledger에 남길 대상이 아니다.
      if (child.release === null) return ok({ accepted: true });
      const identity = {
        invocation: submitted.invocation,
        app: child.app,
        release: child.release,
        mode: child.mode,
      };
      if (submitted.fact === "start") {
        const input = invocationRecordStartedInputSchema.safeParse({
          ...fact,
          ...identity,
        });
        if (!input.success) return invalid("start fact is invalid");
        track(child.processNonce, submitted.invocation, {
          app: child.app,
          release: child.release,
          mode: child.mode,
          startedAt: input.data.started_at,
        });
        enqueue(child, submitted.invocation, "start", {
          method: "record_started",
          input: input.data,
        });
        return ok({ accepted: true });
      }
      if (submitted.fact === "finish") {
        const input = invocationRecordFinishedInputSchema.safeParse({
          ...fact,
          invocation: submitted.invocation,
        });
        if (!input.success) return invalid("finish fact is invalid");
        settle(child.processNonce, submitted.invocation);
        enqueue(child, submitted.invocation, "finish", {
          method: "record_finished",
          input: input.data,
        });
        return ok({ accepted: true });
      }
      const input = invocationRecordDeniedInputSchema.safeParse({
        ...fact,
        invocation: submitted.invocation,
        app: child.app,
        release: child.release,
      });
      if (!input.success) return invalid("deny fact is invalid");
      enqueue(child, submitted.invocation, "deny", {
        method: "record_denied",
        input: input.data,
      });
      return ok({ accepted: true });
    },
    childExited(processNonce) {
      const list = open.get(processNonce);
      open.delete(processNonce);
      if (!list) return 0;
      const finishedAt = deps.clock.now();
      for (const [invocation, entry] of list) {
        enqueue(entry, invocation, "finish", {
          method: "record_finished",
          input: {
            invocation,
            status: "unknown",
            started_at: entry.startedAt,
            finished_at: finishedAt,
            summary: { reason: "process_exited" },
            detail_hash: null,
          },
        });
      }
      return list.size;
    },
  };
}
