// 주의(attention)의 조립. Bus event를 듣고 host가 보고한 presence를 받아 `unseen`을 들고 push가 필요한지 정한다.
// 기기 목록과 push 보내기는 뒤 단위가 `ctx.attention.bindPush`로 꽂는다(그 전에는 아무것도 보내지 않는다).
import { ok } from "../../../../base/mod.ts";
import {
  ROUTES as ATTENTION_ROUTES,
  presenceReport,
  unseenDismiss,
  unseenList,
} from "../../../../protocol/attention/mod.ts";
import { publishStateChanged } from "../../../../protocol/events/changes.ts";
import { HARNESS_ADAPTER_OF_RUNTIME } from "../../../../protocol/coding-agent/harness-adapter.ts";
import { createAttention, type SessionLookup } from "../../../attention/mod.ts";
import { workspaceDepsOf } from "../../../lophn-agent/workspaces/mod.ts";
import { loadSession } from "../../../lophn-agent/session/model.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../../storage/ledger/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import { routeKey } from "./app-principal.ts";
import type { WiringFactory } from "./context.ts";

// handler는 아래 wiring이 붙인다.
export function createCoreRegistration() {
  return { memoryRoutes: ATTENTION_ROUTES };
}

export const attentionWiring: WiringFactory = () => {
  let connection: LedgerConnection | undefined;
  let unsubscribe: (() => void) | undefined;
  return {
    name: "attention",
    build(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      connection = opened.value;
      const { sql } = opened.value;
      const names = workspaceDepsOf(sql).names;

      // session 한 줄. 지워진 session은 null이다.
      const lookup: SessionLookup = async (session) => {
        const row = loadSession({ sql }, session);
        // GUI 탭의 팀원 session은 그 터미널 탭이 알림의 자리다.
        if (row === undefined || row.harness_gui) return null;
        const runtime = row.harness as string | null;
        return {
          title: row.title,
          agent: names.describe(row.agent as never).name,
          harness:
            runtime === null
              ? null
              : ((HARNESS_ADAPTER_OF_RUNTIME as Record<string, string>)[
                  runtime
                ] ?? runtime),
          opened_by_app: row.opened_by_app !== null,
        };
      };

      // GUI view로 열린 coding session을 찾는다. TUI view(shared handle이 남은 때)는 tracker hook이 계기를 맡는다.
      const guiCodingBy = (
        match: (tab: { session: string; terminal: string }) => boolean,
      ) =>
        ctx.peek.terminalAgents?.coding
          .list()
          .find((tab) => tab.view === "gui" && match(tab)) ?? null;

      const attention = createAttention({
        clock: ctx.clock,
        lookup,
        codingSession: (session) => {
          const tab = guiCodingBy((one) => one.session === session);
          return tab === null
            ? null
            : {
                terminal_ref: tab.terminal,
                harness: tab.harness,
                title: tab.title,
              };
        },
        isGuiTerminal: (terminalRef) =>
          guiCodingBy((one) => one.terminal === terminalRef) !== null,
        // remote wiring이 뒤에 채우는 `deviceKind`는 부를 때 읽는다.
        deviceKind: (principal) => ctx.deviceKind(principal),
        unseenChanged: (session) =>
          publishStateChanged(ctx.bus, ctx.clock.now(), [
            { name: "unseen", id: session },
          ]),
      });
      ctx.provide("attention", attention);

      unsubscribe = ctx.bus.subscribe(
        [
          {
            types: [
              "TurnEnded",
              "TurnStarted",
              "SessionEnded",
              "TurnRequestOpened",
              "QuestionAsked",
              "AcpUpdated",
              "ActivationConsentRequested",
              "ShareRequestOpened",
              "NoticePosted",
              "JobHeld",
            ],
          },
        ],
        {
          send: (event) => void attention.event(event),
          close() {},
        },
      );

      const memory: [string, MemoryHandler][] = [
        [
          routeKey(presenceReport),
          (who, body) => {
            attention.report(
              who.principal,
              body as Parameters<typeof attention.report>[1],
            );
            return ok({});
          },
        ],
        [routeKey(unseenList), () => ok({ items: attention.unseenList() })],
        [
          routeKey(unseenDismiss),
          (_who, body) =>
            ok({
              dismissed: attention.dismiss(
                (body as { session: string }).session,
              ),
            }),
        ],
      ];
      return ok({ memory });
    },
    closeIntake() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
    closeWork() {
      connection?.close();
      connection = undefined;
    },
  };
};
