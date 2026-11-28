// app.delete의 조립. approvals·jobs·lophn-agent의 기록은 서로 import하지 못하는 module의 것이라 이 조립이 port 하나로
// 한 Tx에서 지우고(createCoreRegistration), commit 뒤의 파일과 설정 정리를 쓰기 앞 처리기가 한다.
// ledger를 먼저 지우므로 파일 정리 중에 끊겨도 설치된 척하는 앱은 없다. 남은 폴더는 이름 없는 고아일 뿐이다.
import { deleteCallsSentByApp } from "../../../router/mod.ts";
import { chmod, readdir, rm } from "node:fs/promises";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { appDelete, appRemnantsEraser } from "../../../../protocol/apps/mod.ts";
import {
  appFolder,
  bundleFileStore,
} from "../../../../protocol/apps/app-storage.ts";
import { agentDelete } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { isLophn } from "../../../../protocol/lophn-agent/workspaces.ts";
import { deleteSession } from "../../../../protocol/lophn-agent/sessions.ts";
import type {
  AuthenticatedContext,
  Tx,
} from "../../../../protocol/server/mod.ts";
import {
  eraseShareRequest,
  sharedAppsSetting,
} from "../../../approvals/share-requests/mod.ts";
import {
  appLaunchSetting,
  quickLaunchSetting,
  sidebarPanelsOffSetting,
  trayOffSetting,
  trayOrderSetting,
} from "../../../config/shell-settings.ts";
import { sweepBundleFiles } from "../../../apps/releases/bundle/share.ts";
import { eraseJobsOfApp } from "../../../jobs/commands.ts";
import { eraseSyncLog } from "../../../apps/sync/log.ts";
import {
  agentSlotOf,
  createAgentStore,
  dataRootOf,
} from "../../../lophn-agent/agents/store.ts";
import type { AgentFileSystem } from "../../../lophn-agent/agents/ports.ts";
import { appWorkspaceSessions } from "../../../lophn-agent/session/model.ts";
import { eraseToolResults } from "../../../lophn-agent/session/rewind/erase.ts";
import { platformEntryUrl } from "../../../install-and-update/mod.ts";
import { defineTxPort } from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";
import { agentDirectory } from "./lophn-agent-team.ts";
import { readAssignment, writeAssignment } from "./assignment-file.ts";

// 동기 file API는 core 프로세스의 module graph에 정적으로 두지 않는다. adapter는 URL로 연다.
const NODE_AGENT_FILES = platformEntryUrl(import.meta.url, "agentNodeFs").href;
const { createNodeAgentFiles } = (await import(NODE_AGENT_FILES)) as {
  createNodeAgentFiles(): AgentFileSystem;
};

// 한 Tx에서 앱 workspace에 딸린 다른 module의 기록을 지운다. 앱 행이 아직 있을 때 부른다(할당 정리가 앱 행을 읽는다).
function eraseRemnants(
  tx: Tx,
  app: { id: string; slug: string },
): Result<{ sessions: string[] }> {
  // 대화. 지우는 순서와 규칙은 session.delete 그대로다(도는 turn 닫기, blob 참조, 되돌리기 기록).
  const sessions: string[] = [];
  for (const session of appWorkspaceSessions(tx, app.id)) {
    const deleted = tx.call(
      deleteSession,
      { session: session.id },
      { state_seq: session.state_seq },
    );
    if (!deleted.ok) return deleted;
    sessions.push(session.id);
  }
  // 그 앱이 보낸 call 행(받은 session이 앱 밖이어도 답 글이 남지 않게).
  const sent = deleteCallsSentByApp(tx, app.id);
  if (!sent.ok) return sent;

  // 그 앱에 범위가 있는 agent 정의(파일, 앱의 lophn 포함)와 다른 agent에 준 할당. 슬러그가 비면 같은 slug의 새 앱이 할당을 물려받으므로 지운다.
  const agents = agentDirectory(tx.sql);
  const root = dataRootOf(tx.sql, undefined);
  if (!root.ok) return root;
  const store = createAgentStore(createNodeAgentFiles(), root.value);
  for (const info of agents.agents()) {
    if (info.workspace?.kind === "app" && info.workspace.id === app.id) {
      const slot = agentSlotOf(root.value, info.id);
      const file = store.read(slot);
      if (!file.ok) return file;
      if (file.value === null) continue;
      // 앱의 lophn은 agentDelete가 막으므로 앱과 함께 정의 file을 직접 지운다.
      if (isLophn(info.id)) {
        const gone = store.remove(slot);
        if (!gone.ok) return gone;
        continue;
      }
      const removed = tx.call(
        agentDelete,
        { agent: info.id },
        { hash: file.value.hash },
      );
      if (!removed.ok) return removed;
    } else if (info.apps.includes(app.slug)) {
      const state = readAssignment(tx.sql, info.id);
      if (!state.ok) return state;
      const written = writeAssignment(
        tx.sql,
        info.id,
        state.value.assignment.entries.filter(
          (entry) => entry.machine !== undefined || entry.app !== app.id,
        ),
        state.value.revision,
      );
      if (!written.ok) return written;
    }
  }

  eraseJobsOfApp(tx, app.id);
  eraseShareRequest(tx, app.id);
  // 폰 sync log. 임시 snapshot file은 앱 폴더 아래라 commit 뒤 폴더와 같이 지워진다.
  const synced = eraseSyncLog(tx, app.id);
  if (!synced.ok) return synced;
  return ok({ sessions });
}

export function createCoreRegistration() {
  return {
    ports: [
      defineTxPort(appRemnantsEraser, (tx) => ({
        erase: (app) => eraseRemnants(tx, app),
      })),
    ],
  };
}

// 읽기 전용 폴더가 있어도 지워진다. 실패하면 던진다(남은 폴더는 다시 지울 수 있는 고아다).
async function removeFolder(path: string): Promise<void> {
  async function open(directory: string): Promise<void> {
    await chmod(directory, 0o755).catch(() => undefined);
    for (const entry of await readdir(directory, {
      withFileTypes: true,
    }).catch(() => [])) {
      if (entry.isDirectory()) await open(`${directory}/${entry.name}`);
    }
  }
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    await open(path);
    await rm(path, { recursive: true, force: true });
  }
}

type Deleted = { id: string; slug: string; sessions: string[] };

export const appsDeleteWiring: WiringFactory = () => ({
  name: "apps-delete",
  build(ctx) {
    const log = (event: string, message: unknown) =>
      ctx.telemetry.logger.error({
        component: "apps-delete",
        event,
        fields: { message: String(message) },
      });

    // 앱이 보관된 상태로 쓰던 preview process를 먼저 멈춘다. commit 뒤에는 앱을 찾을 수 없어 권한 검사가 거절한다.
    async function stopPreview(
      auth: AuthenticatedContext,
      app: string,
    ): Promise<void> {
      try {
        const facts = await ctx.appsControl.facts.app(app);
        if (!facts.ok || facts.value?.status !== "archived") return;
        const current = await ctx.appsControl.previews.current(app);
        if (!current.ok || current.value === null) return;
        await ctx.appsControl.previews.stop(auth, {
          app,
          process_nonce: current.value.process_nonce,
        } as never);
      } catch (thrown) {
        log("preview_not_stopped", thrown);
      }
    }

    // 지금 이 앱의 process가 살아 있는가(멈추는 중 포함). ledger의 마지막 AppStarted는 core가 꺼질 때 남은 옛 사실일 수 있어
    // 보지 않는다. supervisor에 닿지 못하면 자식도 없다(core가 끊기면 자식은 끝난다).
    async function aliveNow(app: string): Promise<boolean> {
      const facts = await ctx.appsControl.facts.app(app);
      if (!facts.ok || facts.value?.status !== "archived") return false;
      const observed = await ctx.appsControl.client.observe(app);
      return (
        observed.ok &&
        observed.value !== null &&
        observed.value.process_nonce !== ""
      );
    }

    // 사람이 쓰는 설정에서 이 앱을 가리키는 것을 뺀다. 없는 앱은 shell이 그릴 때 건너뛰지만, 같은 slug의 새 앱이
    // 공유(coding agent)나 고정을 물려받지 않게 지운다.
    function cleanSettings(app: Deleted): void {
      const changes: { key: string; action: "set"; value: unknown }[] = [];
      const quick = ctx.settings.get(quickLaunchSetting) ?? {
        order: [],
        apps: [],
      };
      const pinned = `pin:${app.id}:`;
      if (
        quick.apps.some((pin) => pin.app === app.id) ||
        quick.order.some((id) => id.startsWith(pinned)) ||
        (quick.hidden ?? []).some((id) => id.startsWith(pinned))
      ) {
        changes.push({
          key: quickLaunchSetting.key,
          action: "set",
          value: {
            ...quick,
            order: quick.order.filter((id) => !id.startsWith(pinned)),
            apps: quick.apps.filter((pin) => pin.app !== app.id),
            ...(quick.hidden === undefined
              ? {}
              : {
                  hidden: quick.hidden.filter((id) => !id.startsWith(pinned)),
                }),
          },
        });
      }
      const launch = ctx.settings.get(appLaunchSetting) ?? {};
      const launched = Object.keys(launch).filter((key) =>
        key.startsWith(`${app.id}:`),
      );
      if (launched.length > 0) {
        changes.push({
          key: appLaunchSetting.key,
          action: "set",
          value: Object.fromEntries(
            Object.entries(launch).filter(([key]) => !launched.includes(key)),
          ),
        });
      }
      for (const setting of [
        sidebarPanelsOffSetting,
        trayOffSetting,
        trayOrderSetting,
      ]) {
        const off = ctx.settings.get(setting) ?? [];
        if (off.some((item) => item.app === app.id)) {
          changes.push({
            key: setting.key,
            action: "set",
            value: off.filter((item) => item.app !== app.id),
          });
        }
      }
      const shared = ctx.settings.get(sharedAppsSetting) ?? [];
      if (shared.includes(app.slug)) {
        changes.push({
          key: sharedAppsSetting.key,
          action: "set",
          value: shared.filter((slug) => slug !== app.slug),
        });
      }
      if (changes.length === 0) return;
      const written = ctx.settingsUpdate(changes);
      if (!written.ok || written.value.rejected.length > 0) {
        log("settings_not_cleaned", written.ok ? "rejected" : written.error);
      }
    }

    async function cleanFiles(app: Deleted): Promise<void> {
      ctx.appsControl.forget(app.id);
      try {
        await removeFolder(appFolder(ctx.root.path, app.id));
      } catch (thrown) {
        log("folder_not_removed", thrown);
      }
      await sweepBundleFiles(bundleFileStore(ctx.root.path));
      for (const session of app.sessions) {
        await eraseToolResults(ctx.root.path, session);
        await ctx.rewindFiles.store.removeSession(session).catch(() => {});
      }
      try {
        cleanSettings(app);
      } catch (thrown) {
        log("settings_not_cleaned", thrown);
      }
    }

    return ok({
      writer: (inner) => ({
        ...inner,
        async command(auth, envelope) {
          if (envelope.command !== appDelete.name) {
            return await inner.command(auth, envelope);
          }
          const target = (envelope.input as { app?: unknown } | undefined)?.app;
          if (typeof target === "string") {
            await stopPreview(auth, target);
            if (await aliveNow(target)) {
              return err({
                code: "unavailable",
                message: "the app process is still stopping; try again shortly",
              });
            }
          }
          const done = await inner.command(auth, envelope);
          if (done.ok) {
            const deleted = done.value.result as Deleted;
            await cleanFiles(deleted);
            // 열린 창이 shell 쪽 자리(browser 저장소, layout, 전역 float)를 정리하게 알린다. 남지 않는 event다.
            ctx.bus.publish({
              type: "AppRemoved",
              subject: deleted.id,
              at: ctx.clock.now(),
              payload: {},
            } as never);
          }
          return done;
        },
      }),
    });
  },
});
