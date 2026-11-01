// 앱 공유 요청의 조립. approvals는 앱 표와 agent 정의를 모르므로 이름·slug·공개 수를 읽는 길을 port로 꽂는다.
// writer·reader Worker가 팀 등록 file로 import한다.
import { ok } from "../../../../base/mod.ts";
import type { BusEvent } from "../../../../protocol/events/mod.ts";
import {
  createShareRequestCommands,
  SHARE_CODING_TOPIC,
  SHARE_REQUEST_TOPIC,
  type ShareCodingData,
  type ShareLookup,
  shareLookupPort,
  shareRequestListRead,
  shareRequestSteps,
  sharedAppsSetting,
} from "../../../approvals/share-requests/mod.ts";
import { SHARED_APPS_SETTING_KEY } from "../../../../protocol/approvals/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import { loadApp } from "../../../apps/registration/store.ts";
import { loadActiveDeclaration } from "../../../apps/releases/store.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  snapshotPort,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";
import { agentDirectory } from "./lophn-agent-team.ts";

type Query = Pick<Sql, "get" | "all">;

function lookupOf(sql: Query): ShareLookup {
  const agents = agentDirectory(sql);
  return {
    app(id) {
      const app = loadApp(sql, id);
      if (!app.ok || app.value === null) return null;
      const active = loadActiveDeclaration(sql, id);
      const declaration = active.ok ? active.value?.declaration : undefined;
      return {
        name: app.value.name,
        slug: app.value.slug,
        public_skills:
          declaration?.skills?.filter((skill) => skill.public).length ?? 0,
        public_commands:
          declaration?.commands.filter((command) => command.public).length ?? 0,
      };
    },
    agent: (id) => agents.agent(id)?.name ?? null,
  };
}

export function createCoreRegistration() {
  const commands = createShareRequestCommands();
  return {
    schemaSteps: shareRequestSteps,
    commands: [commands.open, commands.decide],
    reads: [shareRequestListRead],
    ports: [defineTxPort(shareLookupPort, (tx) => lookupOf(tx.sql))],
  };
}

export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [shareRequestListRead],
    ports: new Map<unknown, unknown>([
      [shareLookupPort, snapshotPort((snapshot) => lookupOf(snapshot.sql))],
    ]),
  };
}

export const shareRequestsWiring: WiringFactory = () => ({
  name: "share-requests",
  build(ctx) {
    return ok({
      writer: (inner) =>
        withAfterCommit(
          inner,
          (actions) => {
            for (const action of actions) {
              if (action.topic === SHARE_REQUEST_TOPIC) {
                ctx.bus.publish(action.data as BusEvent);
              } else if (action.topic === SHARE_CODING_TOPIC) {
                // 설정 store는 writer Worker 밖이라 commit 뒤 여기서 쓴다. 이미 있는 slug는 더하지 않는다.
                const { slug } = action.data as ShareCodingData;
                const shared = ctx.settings.get(sharedAppsSetting) ?? [];
                if (shared.includes(slug)) continue;
                const written = ctx.settingsUpdate([
                  {
                    key: SHARED_APPS_SETTING_KEY,
                    action: "set",
                    value: [...shared, slug],
                  },
                ]);
                if (!written.ok || written.value.rejected.length > 0) {
                  ctx.telemetry.logger.error({
                    component: "share-requests",
                    event: "shared_apps_not_saved",
                    fields: { slug },
                  });
                }
              }
            }
          },
          ctx.telemetry.logger,
        ),
    });
  },
});
