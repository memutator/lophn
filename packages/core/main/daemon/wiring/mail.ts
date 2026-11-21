// 기계 사이 mail의 main thread 쪽이다: agent가 부르는 보내는 입구(`calls/send_remote`), 다른 컴퓨터가 부르는 받는 입구(`a2a/mail`),
// 늦게 닿은 mail의 대기 목록(`mail/holds`, `mail/decide_hold`), outbox를 link로 내보내고 만료를 닫는 drain. 쓰기는 core 안 machine 자격으로 `calls/mail-*`를 접은 writer로 부른다(본문 준비는 router wiring의 층).
// 읽기는 같은 ledger를 읽는 main thread 연결로 한다(app-calls와 같다). 명단과 link는 remote wiring이 늦게 내므로 부를 때 읽는다.
import { err, ok } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import { DEFAULT_CALL_POLICY } from "../../../../protocol/lophn-agent/call-policy.ts";
import { textBlocks } from "../../../../protocol/lophn-agent/content-block.ts";
import {
  a2aMail,
  callSendRemote,
  mailDecideHold,
  mailHolds,
} from "../../../../protocol/lophn-agent/mail.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import { redactBlocks } from "../../../lophn-agent/session/message-body.ts";
import { requesterOf } from "../../../remote/call.ts";
import { createMailDrain, type MailDrain } from "../../../remote/mail-drain.ts";
import {
  createMailInbox,
  decideHoldHandler,
  holdsHandler,
  type MailEntryDeps,
  mailHandler,
  sendRemoteHandler,
} from "../../../remote/mail-entry.ts";
import {
  callsMailApply,
  callsMailDecide,
  callsMailRefuse,
  callsMailSend,
  callsMailSent,
  callsMailSweep,
  FAILURE_TEXTS,
  MAIL_QUEUED_TOPIC,
  outboxPeers,
  pendingMails,
} from "../../../router/mod.ts";
import {
  type LedgerConnection,
  openConnection,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";
import { prepareBodies } from "./router.ts";

const MAIL_PRINCIPAL = "machine:mail";
const MAIL_CONTEXT: AuthenticatedContext = {
  principal: MAIL_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      callsMailSend.name,
      callsMailApply.name,
      callsMailRefuse.name,
      callsMailSent.name,
      callsMailDecide.name,
      callsMailSweep.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: MAIL_PRINCIPAL,
};

export const mailWiring: WiringFactory = () => {
  let connection: LedgerConnection | undefined;
  let drain: MailDrain | undefined;
  let unsubscribe: (() => void) | undefined;
  return {
    name: "mail",
    records: () => [MAIL_CONTEXT],
    build(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      connection = opened.value;
      const { sql } = opened.value;
      const command = async (route: { name: string }, input: unknown) => {
        const done = await ctx.writer.command(MAIL_CONTEXT, {
          command: route.name,
          input,
          idempotency_key: crypto.randomUUID(),
          compare: {},
          prepared: [],
        });
        return done.ok ? ok(done.value.result) : done;
      };
      const deps: MailEntryDeps = {
        command,
        sql,
        policy: () =>
          ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY,
        computers: () => ctx.machineLinks.computers(),
        resolve: (ref) => ctx.machineLinks.resolve(ref),
        self: () => ctx.machine.id,
        redact: (blocks) =>
          redactBlocks(createProductRedactor(ctx.peek.knownSecrets), blocks),
        kind: (principal) => ctx.deviceKind(principal),
        granted: (machine) => ctx.computerGranted(machine),
        requesterOf,
        async prepare(bodies) {
          const relay = ctx.peek.bodyPrepare;
          if (relay === undefined) {
            return err({
              code: "unavailable",
              message: "blob preparation is not available",
            });
          }
          return await prepareBodies(relay, MAIL_CONTEXT, bodies);
        },
        now: () => ctx.clock.now(),
        // workflows wiring이 놓는다(부를 때 읽는다).
        stepReport: (mail, origin) =>
          ctx.workflowService.remoteReport(mail, origin),
      };
      ctx.provide("mailInbox", createMailInbox(deps));
      const draining = createMailDrain({
        peers: () => outboxPeers(sql),
        pending: (peer) => pendingMails(sql, peer),
        // 그 기계의 컴퓨터 항목이 둘이면 먼저 나온 것이다(나르기와 같다).
        connected(peer) {
          const links = ctx.machineLinks;
          const linked = links
            .list()
            .some(
              (each) => each.machine === peer && each.status === "connected",
            );
          if (!linked) return null;
          return (
            links
              .computers()
              .find((each) => each.machine === peer && !each.self)?.device ??
            null
          );
        },
        call: (device, call, by) => ctx.machineLinks.call(device, call, by),
        record: (mail, result) => command(callsMailSent, { mail, result }),
        // 닿지 못하고 만료된 call은 보낸 session에 실패 알림이 간다. 그 글을 먼저 준비한다.
        async sweep() {
          const prepared = await deps.prepare([
            textBlocks(FAILURE_TEXTS.expired),
          ]);
          if (!prepared.ok) return prepared;
          return await command(callsMailSweep, {});
        },
        every(ms, fn) {
          const timer = setInterval(() => void fn(), ms);
          timer.unref();
          return () => clearInterval(timer);
        },
        warn: (event, fields) =>
          ctx.telemetry.logger.warn({ component: "mail", event, fields }),
      });
      drain = draining;
      return ok({
        memory: [
          [
            `${callSendRemote.resource}/${callSendRemote.method}`,
            sendRemoteHandler(deps),
          ],
          [`${a2aMail.resource}/${a2aMail.method}`, mailHandler(deps)],
          [`${mailHolds.resource}/${mailHolds.method}`, holdsHandler(deps)],
          [
            `${mailDecideHold.resource}/${mailDecideHold.method}`,
            decideHoldHandler(deps),
          ],
        ],
        writer: (inner) =>
          withAfterCommit(
            inner,
            (actions) => {
              for (const action of actions) {
                if (action.topic === MAIL_QUEUED_TOPIC) {
                  void draining.wake((action.data as { peer: Id<"mch"> }).peer);
                }
              }
            },
            ctx.telemetry.logger,
          ),
      });
    },
    async afterReady(ctx) {
      if (drain === undefined) return;
      const draining = drain;
      // link가 붙거나 끊기면 remote_devices가 바뀐다.
      unsubscribe = ctx.bus.subscribe([{ types: ["StateChanged"] }], {
        send(event) {
          const changes = (event.payload as { changes: { name: string }[] })
            .changes;
          if (changes.some((change) => change.name === "remote_devices")) {
            void draining.wakeAll();
          }
        },
        close: () => undefined,
      });
      draining.start();
    },
    closeIntake() {
      unsubscribe?.();
      unsubscribe = undefined;
      drain?.stop();
    },
    closeWork() {
      connection?.close();
      connection = undefined;
    },
  };
};
