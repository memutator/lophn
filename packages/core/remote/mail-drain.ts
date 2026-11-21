// outbox의 mail을 link로 내보낸다. 상대 기계마다 한 번에 하나이고 seq 순이다. 깨우는 때는 wiring이 정한다(outbox에 줄이 생김, link
// 상태가 바뀜, timer, 기동 뒤 한 번). 받은 답을 `calls/mail-sent`로 적는다.
import type { LophnError, Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  a2aMail,
  type Mail,
  mailAppliedSchema,
} from "../../protocol/lophn-agent/mail.ts";
import type { Requester } from "../../protocol/machine/requester.ts";
import type { MailSendResult } from "../router/mod.ts";

export type MailDrainDeps = {
  peers(): Id<"mch">[];
  // 그 기계로 낼 mail(seq 순).
  pending(peer: Id<"mch">): Mail[];
  // 그 기계의 link가 connected면 그 컴퓨터의 기기 id, 아니면 null.
  connected(peer: Id<"mch">): string | null;
  // 그 기기로 route 하나를 보낸다(`by`는 요청한 쪽).
  call(
    device: string,
    call: { resource: string; method: string; body: unknown },
    by: Requester,
  ): Promise<Result<unknown>>;
  record(mail: Id<"mal">, result: MailSendResult): Promise<Result<unknown>>;
  warn(event: string, fields: Record<string, unknown>): void;
};

export type MailDrain = {
  // 그 기계의 줄을 돈다. 도는 중이면 끝난 뒤 한 번 더 돈다. 돌기가 끝나면 풀린다.
  wake(peer: Id<"mch">): Promise<void>;
  wakeAll(): Promise<void>;
  stop(): void;
};

// 답 하나가 무엇으로 이어지는가. null이면 그 기계를 다음 때까지 멈춘다.
// - ok: 받았다(적용 결과). 답의 꼴을 읽지 못하면 결과를 모르는 것과 같다.
// - unavailable이고 link를 떠났다: 결과를 모른다. 같은 id로 다음에 다시 보낸다(받는 쪽이 id로 한 번만 돌린다).
// - not_found(그 route를 모른다)와 invalid_input(그 판이 이 mail의 꼴을 읽지 못한다): 옛 판이 거절했다. 두면 그 기계의 줄이 영영 막힌다.
// - 그 밖(link를 떠나지 않은 unavailable, forbidden, internal 등): 그 기계 전체의 사정이다. 다음 때에 다시 한다.
export function sendResultOf(sent: Result<unknown>): MailSendResult | null {
  if (sent.ok) {
    const parsed = mailAppliedSchema.safeParse(sent.value);
    return parsed.success
      ? { kind: "acked", applied: parsed.data }
      : { kind: "unknown" };
  }
  const error: LophnError = sent.error;
  if (
    error.code === "unavailable" &&
    (error.details as { sent?: unknown } | undefined)?.sent === true
  ) {
    return { kind: "unknown" };
  }
  if (error.code === "not_found" || error.code === "invalid_input") {
    return { kind: "refused" };
  }
  return null;
}

// 받는 기계는 요청한 쪽의 종류만 믿는다. 나머지는 표시다.
function requesterOf(mail: Mail): Requester {
  return {
    kind: "agent",
    agent: mail.from.agent,
    session: mail.from.session,
    name: mail.from.name,
  };
}

export function createMailDrain(deps: MailDrainDeps): MailDrain {
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();
  let stopped = false;

  async function drain(peer: Id<"mch">): Promise<void> {
    const device = deps.connected(peer);
    if (device === null) return;
    for (const mail of deps.pending(peer)) {
      if (stopped) return;
      const sent = await deps.call(
        device,
        {
          resource: a2aMail.resource,
          method: a2aMail.method,
          body: { mail },
        },
        requesterOf(mail),
      );
      const result = sendResultOf(sent);
      if (result === null) {
        if (!sent.ok) {
          deps.warn("mail_send_stopped", { peer, code: sent.error.code });
        }
        return;
      }
      if (stopped) return;
      const recorded = await deps.record(mail.id as Id<"mal">, result);
      if (!recorded.ok) {
        deps.warn("mail_sent_not_recorded", {
          peer,
          code: recorded.error.code,
        });
        return;
      }
      if (result.kind === "unknown") return;
    }
  }

  function wake(peer: Id<"mch">): Promise<void> {
    if (stopped) return Promise.resolve();
    const current = running.get(peer);
    if (current !== undefined) {
      again.add(peer);
      return current;
    }
    const done = (async () => {
      try {
        do {
          again.delete(peer);
          await drain(peer);
        } while (again.has(peer) && !stopped);
      } catch (thrown) {
        deps.warn("mail_drain_threw", {
          peer,
          message: thrown instanceof Error ? thrown.message : String(thrown),
        });
      } finally {
        running.delete(peer);
      }
    })();
    running.set(peer, done);
    return done;
  }

  return {
    wake,
    async wakeAll() {
      if (stopped) return;
      await Promise.all(deps.peers().map((peer) => wake(peer)));
    },
    stop() {
      stopped = true;
    },
  };
}
