// notifications 구독자와 OS 표시 전달. remove-platform이 이 file을 지운다.
import { ok } from "../../../../base/mod.ts";
import { createNotificationDelivery } from "../../../notifications/delivery.ts";
import {
  type NotificationsLoop,
  startNotifications,
} from "../../../notifications/loop.ts";
import { NOTIFICATIONS_CONTEXT } from "../platform-register.ts";
import type { WiringFactory } from "./context.ts";

export const notificationsWiring: WiringFactory = () => {
  let notifications: NotificationsLoop | undefined;
  return {
    name: "notifications",
    // notifications 구독자(machine:notifications)의 자격 기록. token이 없는 core 내부 자격이라
    // HTTP로는 이 principal이 될 수 없다. reader·writer는 이 ledger 기록으로 현재 자격을 본다.
    records: () => [NOTIFICATIONS_CONTEXT],
    build(ctx) {
      // OS 표시 전달 상태. get·list·display 응답을 꾸미고 shell의 실패 보고를 받는다.
      const delivery = createNotificationDelivery({
        clock: ctx.clock,
        read: (route, context, body) =>
          ctx.runtime.readers.read(route, context, body),
      });
      return ok({
        memory: delivery.memory,
        reads(reads) {
          for (
            const key of [
              "notifications/get",
              "notifications/list",
              "notifications/display",
            ]
          ) {
            const inner = reads.get(key);
            if (inner !== undefined) {
              reads.set(key, delivery.decorate(key, inner));
            }
          }
        },
      });
    },
    // core 안 notifications 구독자. 계기 event를 notification으로 바꾸고 cursor를 올린다.
    start(ctx) {
      notifications = startNotifications({
        runtime: ctx.runtime,
        ledgerPath: ctx.ledgerPath,
      });
      return Promise.resolve(ok(undefined));
    },
    // 진행 중인 notification 생성은 writer가 닫히기 전에 끝난다.
    async closeIntake() {
      await notifications?.stop();
    },
  };
};
