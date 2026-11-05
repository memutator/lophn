// rewind: 시점으로 고를 수 있는 메시지와 시점을 고르면 보이는 것(파일과 앱별 write). 적용은 ACP `rewind` 입력이다.
// 확인은 대화 화면 안의 panel이라 확인 창이 없다. 앱 data는 session rewind가 저절로 되돌리지 않고 사람이 고른 앱만
// 같은 시점으로 되돌아간다. 편집 undo와 되돌린 구간 redo는 없다.
import { t } from "@lophn/i18n";

import type { AppToolCaller } from "../../../protocol/apps/calls/caller.ts";
import { appRewindPlan } from "../../../protocol/apps/calls/rewind.ts";
import { appGet } from "../../../protocol/apps/apps.ts";
import { acpSnapshot } from "../../../protocol/acp/mod.ts";
import { sessionRewindPreview } from "../../../protocol/lophn-agent/session-rewinds.ts";
import { rewindPointsOf } from "./agent-view-model.ts";
import type {
  RewindApp,
  RewindFileView,
  RewindPreviewView,
  RewindWrite,
  SourceResult,
} from "./agent-tab-source.ts";
import type { Env } from "./agent-tab-core-source-env.ts";
import { agentNameOf, readSession } from "./agent-tab-core-source-sessions.ts";

// ---------------------------------------------------------------- 시점

export async function readRewindPoints(
  env: Env,
  session: string,
): Promise<SourceResult<readonly string[]>> {
  const read = await env.read(acpSnapshot, { session });
  return read.ok ? { ok: true, value: rewindPointsOf(read.value) } : read;
}

// ---------------------------------------------------------------- 사전 검사

function operationText(operation: { kind: string; name?: string }): string {
  return (operation.kind === "operation" || operation.kind === "command") &&
    operation.name !== undefined
    ? operation.name
    : operation.kind;
}

async function callerName(
  env: Env,
  caller: AppToolCaller | null,
): Promise<string> {
  if (caller === null) return t("conversation.label.rewind-item-app");
  if (caller.kind === "person") {
    return t("conversation.label.rewind-caller-person");
  }
  if (caller.kind === "program") {
    return t("conversation.label.rewind-caller-program");
  }
  if (caller.kind === "flow") {
    return t("conversation.label.rewind-caller-flow");
  }
  if (caller.kind === "agent") {
    const read = await readSession(env, caller.session);
    if (!read.ok) return caller.session;
    return (await agentNameOf(env, read.value.agent)) ?? caller.session;
  }
  const app = await env.read(appGet, { app: caller.app });
  return app.ok ? app.value.app.name : caller.app;
}

/** 앱 하나: 이 session이 한 write, 함께 되돌아갈 다른 변경, 되돌아가지 않는 external 효과. */
async function appViewOf(
  env: Env,
  app: string,
  invocations: readonly string[],
): Promise<SourceResult<RewindApp | null>> {
  const first = invocations[0];
  if (first === undefined) return { ok: true, value: null };
  const plan = await env.read(appRewindPlan, { app, from_invocation: first });
  // 고를 수 없는 앱(이전 release 등)은 목록에 두지 않는다.
  if (!plan.ok) {
    return plan.code === "invalid_input" ? { ok: true, value: null } : plan;
  }
  const name = await env.read(appGet, { app });
  const mine = new Set(invocations);
  const { items, blocked } = plan.value.plan;
  const writes = items
    .filter((item) => mine.has(item.invocation))
    .map(
      (item): RewindWrite => ({
        at: item.started_at,
        text: operationText(item.operation),
        unknown: blocked?.invocation === item.invocation,
      }),
    );
  const others = await Promise.all(
    items
      .filter((item) => !mine.has(item.invocation) && item.reverts_db)
      .map(async (item) => ({
        by: await callerName(env, item.caller),
        text: operationText(item.operation),
      })),
  );
  return {
    ok: true,
    value: {
      app,
      name: name.ok ? name.value.app.name : app,
      writes,
      others,
      outside: items
        .filter((item) => item.external)
        .map((item) => operationText(item.operation)),
    },
  };
}

/** 시점을 고르면 보이는 것. 파일 목록은 파일까지 되돌리는 범위의 것이고, 아무것도 바꾸지 않는다. */
export async function previewRewind(
  env: Env,
  session: string,
  message: string,
): Promise<SourceResult<RewindPreviewView>> {
  const read = await env.read(sessionRewindPreview, {
    session,
    checkpoint: message,
    choice: "restore_all",
  });
  if (!read.ok) return read;
  const { restore, skip, app_writes } = read.value;
  const files = [...restore, ...skip]
    .filter((item) => item.class === "file")
    .map(
      (item): RewindFileView => ({
        path: item.target,
        skipped: item.reason,
      }),
    );
  const apps: RewindApp[] = [];
  for (const entry of app_writes) {
    const view = await appViewOf(env, entry.app, entry.invocations);
    if (!view.ok) return view;
    if (view.value !== null) apps.push(view.value);
  }
  return { ok: true, value: { files, apps } };
}
