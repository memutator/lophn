// ledger event read의 테스트 전용 통로. ledger.db reader 연결의 ListEvents를
// EventBackend 모양으로 갚는다. node:sqlite은 platform/ledger 안 코드만 두고,
// 이 모듈은 *_test.ts만 import한다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  EventDefinition,
  EventVisibilityDefinition,
  RequestContext,
} from "../../../protocol/platform/mod.ts";
import { createListEventsRead } from "../events.ts";
import type { EventBatch, EventScan } from "../events.ts";

export type { EventBatch, EventScan };
import type { EventVisibilityRegistry } from "../event-visibility.ts";
import { createEventVisibilityRegistry } from "../event-visibility.ts";
import { openReaderConnection } from "../reader-connection.ts";
import type { ReaderConnection } from "../reader-connection.ts";
import { executeRead } from "../reads.ts";

export type EventsBackendFixture = {
  reader: ReaderConnection;
  registry: EventVisibilityRegistry;
  backend: {
    current(credentialRef: string): Promise<Result<RequestContext>>;
    read(ctx: RequestContext, scan: EventScan): Promise<Result<EventBatch>>;
  };
  close(): void;
};

// reader 연결을 열고 등록 event contract로 ListEvents를 노출한다. trigger
// event와 계기 아닌 event를 모두 등록한다: 등록 schema를 통과하지 않은 event는
// batch에서 빠지므로 engine 테스트는 보려는 type을 모두 건네야 한다.
export function openEventsBackend(
  path: string,
  events: readonly EventDefinition[],
  policies: readonly EventVisibilityDefinition[],
  current: () => Result<RequestContext>,
): Result<EventsBackendFixture> {
  const opened = openReaderConnection(path);
  if (!opened.ok) return opened;
  const registry = createEventVisibilityRegistry(events, policies);
  if (!registry.ok) {
    opened.value.close();
    return registry;
  }
  const read = createListEventsRead({ registry: registry.value, current });
  const reader = opened.value;
  return ok({
    reader,
    registry: registry.value,
    backend: {
      current: () => Promise.resolve(current()),
      read(ctx, scan): Promise<Result<EventBatch>> {
        let output: Result<unknown>;
        try {
          output = executeRead(
            reader,
            read,
            new Map(),
            ctx,
            {
              after_seq: scan.inclusive && BigInt(scan.position) > 0n
                ? (BigInt(scan.position) - 1n).toString()
                : scan.position,
              limit: scan.limit,
            },
          );
        } catch {
          return Promise.resolve(err({
            code: "unavailable" as const,
            message: "event reader를 사용할 수 없다",
          }));
        }
        return Promise.resolve(output as Result<EventBatch>);
      },
    },
    close: () => reader.close(),
  });
}
