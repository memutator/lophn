// host(desktop, 폰)가 보고한 지금의 모습. 메모리뿐이고 ledger 표가 없다.
import type { Clock } from "../../base/mod.ts";

// desktop은 30초마다 다시 보고한다. 이 시간이 지난 보고는 없는 것이다: 죽은 desktop이 push를 영원히 막지 않게 하는 안전망이다.
export const PRESENCE_TTL_MS = 90_000;
export const DESKTOP_IDLE_LIMIT_MS = 120_000;

export type PresenceReport = {
  at: number;
  focused: boolean;
  idle_ms: number | null;
  looking: readonly string[];
};
export type PresenceTable = ReadonlyMap<string, PresenceReport>;

export const isPhone = (reporter: string): boolean =>
  reporter.startsWith("device:");

// 앞에 있다: 폰은 앞에 보이는 것(focused), desktop은 focused이고 idle이 한도 아래다(idle을 모르면 아래로 본다).
export function isPresent(
  reporter: string,
  report: PresenceReport,
  now: number,
): boolean {
  if (now - report.at >= PRESENCE_TTL_MS) return false;
  if (!report.focused) return false;
  return (
    isPhone(reporter) ||
    report.idle_ms === null ||
    report.idle_ms < DESKTOP_IDLE_LIMIT_MS
  );
}

export function anyDesktopPresent(table: PresenceTable, now: number): boolean {
  for (const [reporter, report] of table) {
    if (!isPhone(reporter) && isPresent(reporter, report, now)) return true;
  }
  return false;
}

export function anyLooking(
  table: PresenceTable,
  session: string,
  now: number,
): boolean {
  for (const [reporter, report] of table) {
    if (isPresent(reporter, report, now) && report.looking.includes(session)) {
      return true;
    }
  }
  return false;
}

export function createPresence(clock: Clock) {
  const table = new Map<string, PresenceReport>();
  return {
    table: table as PresenceTable,
    report(
      reporter: string,
      report: {
        focused: boolean;
        idle_ms?: number;
        looking: readonly string[];
      },
    ): void {
      table.set(reporter, {
        at: clock.nowMs(),
        focused: report.focused,
        idle_ms: report.idle_ms ?? null,
        looking: report.looking,
      });
    },
    forget(reporter: string): void {
      table.delete(reporter);
    },
    present(reporter: string): boolean {
      const report = table.get(reporter);
      return report !== undefined && isPresent(reporter, report, clock.nowMs());
    },
  };
}
