// activation 동의 표(`activation_consents`)를 읽고 쓰는 helper. 동의 command, 읽기, driver가 같이 쓴다.
// 대기와 허락 모두 표에 남아 재시작을 넘는다: 허락만 메모리에서 시작으로 넘기면 허락이 commit된 뒤 시작하기 전에
// core가 꺼질 때 허락을 잃는다.
import type { ActivationConsent } from "../../../../protocol/apps/mod.ts";
import type { Sql, Tx } from "../../../../protocol/server/mod.ts";
import { afterCommit } from "../../../storage/ledger/after-commit.ts";

// 남지 않는 동의 event를 commit 뒤 Bus로 내는 topic. apps wiring의 writer가 받는다.
export const ACTIVATION_CONSENT_TOPIC = "activation_consent";

// event 이름은 protocol의 남지 않는 event와 같다. subject는 release다.
export function pushConsentEvent(
  tx: Pick<Tx, "port" | "now">,
  event: {
    type: "ActivationConsentRequested";
    app: string;
    release: string;
  } | {
    type: "ActivationConsentClosed";
    app: string;
    release: string;
    outcome: "allow" | "reject" | "cancelled";
  },
): void {
  const { type, ...payload } = event;
  tx.port(afterCommit).push(ACTIVATION_CONSENT_TOPIC, {
    type,
    subject: event.release,
    at: tx.now(),
    payload,
  });
}

type Query = Pick<Sql, "get" | "all">;

// 사람을 기다리는 줄. 오래된 것부터 준다.
export function waitingConsents(
  sql: Query,
  app?: string,
): ActivationConsent[] {
  return sql.all(
    `SELECT release, app, comparison, requested_at FROM activation_consents
      WHERE allowed_at IS NULL AND (? IS NULL OR app = ?)
      ORDER BY requested_at, release`,
    [app ?? null, app ?? null],
  ).map((row) => ({
    app: String(row.app),
    release: String(row.release),
    comparison: JSON.parse(String(row.comparison)),
    requested_at: String(row.requested_at),
  } as ActivationConsent));
}

// 사람이 허락했고 아직 시작하지 않은 줄. comparison은 저장된 정규 값 그대로다.
export function allowedConsents(
  sql: Query,
): { release: string; comparison: string }[] {
  return sql.all(
    `SELECT c.release AS release, c.comparison AS comparison
       FROM activation_consents c JOIN releases r ON r.id = c.release
      WHERE c.allowed_at IS NOT NULL AND r.status = 'prepared'
      ORDER BY c.allowed_at, c.release`,
    [],
  ).map((row) => ({
    release: String(row.release),
    comparison: String(row.comparison),
  }));
}
