import { err, ok } from "../../packages/base/mod.ts";
import type {
  ChildMessage,
  ParentMessage,
} from "../../packages/protocol/platform/mod.ts";
import type { SecretAttachLike } from "../../packages/lophn-agent/harness/provider/mod.ts";

// provider 호출의 credential은 core가 감독 pipe로 한 번 건네는 값이다(lophn-agent/harness/provider#R7,
// platform/secrets#R5). 값은 core의 보호 메모리와 OS keychain에만 있고 runtime이 요청하면 core가 현재
// 참조·판·목적지를 대조한 뒤 이 응답 하나로만 준다. 값은 인증 전송 callback의 인자로만 쓰고 결과·오류·
// log·ModelCall blob에 남기지 않는다. 값을 받지 못하면 callback은 불리지 않고 요청은 나가지 않는다.

export type SecretLink = {
  // 인증 transport가 쓰는 전송 부착 port다.
  attach: SecretAttachLike;
  // 감독 pipe에서 받은 parent message. 이 link의 응답이면 true다.
  onParent(message: ParentMessage): boolean;
};

type Answer = Extract<ParentMessage, { type: "secret_send_response" }>;

export function createSecretLink(options: {
  send(message: ChildMessage): Promise<void>;
  // 응답을 기다리는 기한. 지나면 값을 받지 못한 것이다.
  timeoutMs?: number;
}): SecretLink {
  const pending = new Map<string, {
    resolve(answer: Answer | null): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const timeoutMs = options.timeoutMs ?? 10_000;
  let sequence = 0;

  return {
    attach: {
      async send(input, transmit) {
        const body = input.body as { url?: unknown; method?: unknown };
        if (typeof body.url !== "string" || typeof body.method !== "string") {
          return err({
            code: "invalid_input",
            message: "전송 근거가 올바르지 않다",
          });
        }
        const id = `secret-send-${++sequence}`;
        const answered = new Promise<Answer | null>((resolve) => {
          const timer = setTimeout(() => {
            if (pending.delete(id)) resolve(null);
          }, timeoutMs);
          pending.set(id, { resolve, timer });
        });
        try {
          await options.send({
            type: "secret_send_request",
            request_id: id,
            use: input.use,
            operation: input.operation,
            url: body.url,
            method: body.method,
          });
        } catch {
          clearTimeout(pending.get(id)?.timer);
          pending.delete(id);
          return err({
            code: "unavailable",
            message: "supervision pipe is closed",
          });
        }
        const answer = await answered;
        if (answer === null) {
          return err({
            code: "unavailable",
            message: "credential was not delivered",
          });
        }
        if (!answer.ok) return err(answer.error);
        const sent = await transmit(answer.value);
        return sent.ok ? ok({ sent: sent.value.sent }) : sent;
      },
    },
    onParent(message) {
      if (message.type !== "secret_send_response") return false;
      const waiting = pending.get(message.request_id);
      if (waiting === undefined) return true;
      pending.delete(message.request_id);
      clearTimeout(waiting.timer);
      waiting.resolve(message);
      return true;
    },
  };
}
