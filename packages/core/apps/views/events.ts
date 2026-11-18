// 앱 event를 view로 보낸다. core가 낸 `AppEventPublished`를, 묶인 release가 그 (source, event)의 구독을 선언했고 audience에
// 든 live view마다 `AppViewEvent`(`event`) 하나로 낸다. preview view와 묶음을 잃은 view는 받지 않는다. 화면이 떠 있는
// 동안만 받고 놓친 것은 다시 오지 않는다.
import type { JsonValue } from "../../../protocol/base/json-values.ts";
import type { AppViewsPorts } from "./ports.ts";
import type { ViewTable } from "./table.ts";

export interface PublishedAppEvent {
  source: string;
  event: string;
  payload: JsonValue;
  /** 이 앱들의 화면만 받는다. null이면 구독을 선언한 모든 화면이다. */
  audience: readonly string[] | null;
}

export function deliverAppEvent(
  table: ViewTable,
  ports: Pick<AppViewsPorts, "publish">,
  published: PublishedAppEvent,
): void {
  for (const entry of [...table.entries()]) {
    if (entry.args.mode !== "live" || entry.lost !== null) continue;
    if (
      published.audience !== null &&
      !published.audience.includes(entry.args.app)
    ) {
      continue;
    }
    if (
      !entry.subscriptions.some(
        (one) =>
          // 다른 컴퓨터를 적은 구독은 이 컴퓨터의 event를 받지 않는다(다른 컴퓨터의 event는 앱 process로만 간다).
          one.machine === undefined &&
          one.source === published.source &&
          one.event === published.event,
      )
    ) {
      continue;
    }
    table.touch(entry);
    ports.publish(entry.args.app, {
      owner: entry.owner,
      view: entry.view,
      kind: "event",
      source: published.source,
      event: published.event,
      payload: published.payload,
    });
  }
}
