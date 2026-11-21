// outbox의 mail을 link로 내보낸다. 상대 기계마다 한 번에 하나이고 seq 순이다. 깨우는 때: outbox에 줄이 생김, link 상태가 바뀜(wiring이
// 부른다), 주기 timer, 시작할 때 한 번. 받은 답을 `calls/mail-sent`로 적는다. 주기 timer는 먼저 만료된 mail을 닫는다.
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
  // 만료된 mail을 닫는다(`calls/mail-sweep`). 주기 timer마다 부른다.
  sweep(): Promise<Result<unknown>>;
  // 주기 timer. 멈추는 함수를 돌려준다.
  every(ms: number, fn: () => Promise<void>): () => void;
  warn(event: string, fields: Record<string, unknown>): void;
};

// 닿지 않은 mail을 다시 내보는 간격.
export const DRAIN_EVERY_MS = 60_000;
// 받는 기계가 줄 맨 앞 mail에 timer가 시작한 차례마다 internal로 답한 횟수가 이만큼이면 그 mail을 버린다.
export const INTERNAL_GIVE_UP = 5;

// 버린 mail의 결과. call mail은 expired로 닫힌다(옛 판도 아는 이유다). reply·cancel·state는 줄에서 지워질 뿐이라 그 기계의 call은 만료까지
// 열려 있다.
const GIVE_UP: MailSendResult = {
  kind: "acked",
  applied: { delivery: "failed", reason: "expired", session: null },
};

export type MailDrain = {
  // 그 기계의 줄을 돈다. 도는 중이면 끝난 뒤 한 번 더 돈다. 돌기가 끝나면 풀린다.
  wake(peer: Id<"mch">): Promise<void>;
  wakeAll(): Promise<void>;
  // 주기 timer를 걸고 한 번 돈다(sweep은 timer에서만).
  start(): void;
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
  // 끝난 뒤 한 번 더 돌 기계와 그 차례가 timer가 시작한 것인지.
  const again = new Map<string, boolean>();
  // 기계마다 줄 맨 앞 mail과, timer가 시작한 차례에 받는 기계가 internal로 답한 횟수. 메모리에만 있다.
  const internal = new Map<string, { mail: string; count: number }>();
  let stopped = false;
  let cancelTimer: (() => void) | undefined;

  async function drain(peer: Id<"mch">, byTimer: boolean): Promise<void> {
    const device = deps.connected(peer);
    if (device === null) return;
    for (const mail of deps.pending(peer)) {
      if (stopped) return;
      if (internal.get(peer)?.mail !== mail.id) internal.delete(peer);
      const sent = await deps.call(
        device,
        {
          resource: a2aMail.resource,
          method: a2aMail.method,
          body: { mail },
        },
        requesterOf(mail),
      );
      let result = sendResultOf(sent);
      if (result === null && !sent.ok && sent.error.code === "internal") {
        // 받는 기계에서 늘 실패하는 mail 하나가 그 기계로 가는 줄을 영영 막지 않게 한다. 짧은 고장 동안 몰려 오는 깨움(줄이 생김, link
        // 바뀜)은 세지 않는다.
        if (byTimer) {
          const count = (internal.get(peer)?.count ?? 0) + 1;
          internal.set(peer, { mail: mail.id, count });
          if (count >= INTERNAL_GIVE_UP) {
            internal.delete(peer);
            deps.warn("mail_given_up", { peer, mail: mail.id });
            result = GIVE_UP;
          }
        }
      }
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

  function wake(peer: Id<"mch">, byTimer = false): Promise<void> {
    if (stopped) return Promise.resolve();
    const current = running.get(peer);
    if (current !== undefined) {
      again.set(peer, (again.get(peer) ?? false) || byTimer);
      return current;
    }
    const done = (async () => {
      try {
        let timed = byTimer;
        for (;;) {
          await drain(peer, timed);
          const next = again.get(peer);
          again.delete(peer);
          if (next === undefined || stopped) break;
          timed = next;
        }
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

  async function wakeAll(byTimer = false): Promise<void> {
    if (stopped) return;
    await Promise.all(deps.peers().map((peer) => wake(peer, byTimer)));
  }

  return {
    wake: (peer) => wake(peer),
    wakeAll: () => wakeAll(),
    start() {
      if (stopped || cancelTimer !== undefined) return;
      cancelTimer = deps.every(DRAIN_EVERY_MS, async () => {
        const swept = await deps.sweep();
        if (!swept.ok) {
          deps.warn("mail_sweep_failed", { code: swept.error.code });
        }
        await wakeAll(true);
      });
      void wakeAll();
    },
    stop() {
      stopped = true;
      cancelTimer?.();
      cancelTimer = undefined;
    },
  };
}
