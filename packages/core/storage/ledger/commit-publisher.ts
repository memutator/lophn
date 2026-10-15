import type { Result } from "../../../base/mod.ts";
import {
  type DomainEvent,
  domainEventSchema,
} from "../../../protocol/events/mod.ts";
import type { Bus } from "../../events/ports.ts";
import type { CommandSuccess } from "./writer-message.ts";

// first_seq..last_seq(양 끝 포함)의 events 행을 seq 순서로 읽는다. 행은 envelope 모양이다
// (seq, type, subject, actor, at, payload는 파싱한 값). 검사는 publisher가 한다.
export type CommitEventReader = {
  readRange(firstSeq: string, lastSeq: string): Promise<Result<unknown[]>>;
};

export type CommitPublisherDeps = {
  reader: CommitEventReader;
  bus: Pick<Bus, "publish">;
  log?: (message: string) => void;
};

// command가 commit된 뒤 그 tx의 domain event를 Bus로 낸다. Bus는 메모리라 놓칠 수 있고, 놓친
// 것은 Ledger를 읽는 Reactor가 메운다. 그래서 읽기나 검사가 실패해도 command를 실패시키지 않는다.
export function createCommitPublisher(deps: CommitPublisherDeps) {
  const log = deps.log ?? ((message) => console.error(message));
  return {
    async onCommit(success: CommandSuccess): Promise<void> {
      if (success.first_seq === null || success.last_seq === null) return;
      const range = `${success.first_seq}..${success.last_seq}`;
      let rows: Result<unknown[]>;
      try {
        rows = await deps.reader.readRange(success.first_seq, success.last_seq);
      } catch {
        log(`commit publisher: events ${range}를 읽다 던졌다`);
        return;
      }
      if (!rows.ok) {
        log(
          `commit publisher: events ${range}를 읽지 못했다: ${rows.error.code}`,
        );
        return;
      }
      let skipped = 0;
      for (const row of rows.value) {
        const parsed = domainEventSchema.safeParse(row);
        if (!parsed.success) {
          skipped++;
          continue;
        }
        const event: DomainEvent = parsed.data;
        deps.bus.publish(event);
      }
      if (skipped > 0) {
        log(
          `commit publisher: domain event가 아닌 행 ${skipped}개를 건너뛰었다 (${range})`,
        );
      }
    },
  };
}
