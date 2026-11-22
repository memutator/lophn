// 화면이 고정해 보이는 agent(머리·composer의 얼굴, 자리 이름, 권한 요약)와 그 agent의 session 목록, session 관리
// (열기, archive, 지우기)와 권한 보기. 모두 snapshot read와 command이고 polling은 없다.
import { t } from "@lophn/i18n";

import { assignmentGet } from "../../../protocol/approvals/assignment.ts";
import { appGet } from "../../../protocol/apps/apps.ts";
import { sessionSnapshotsList } from "../../../protocol/events/snapshot.ts";
import { agentRead } from "../../../protocol/lophn-agent/agent-definitions.ts";
import {
  type WorkspaceSession,
  workspaceSessionList,
  workspaceSessionOpen,
  workspaceSessionRead,
} from "../../../protocol/lophn-agent/agent-sessions.ts";
import {
  archiveSession,
  deleteSession,
} from "../../../protocol/lophn-agent/sessions.ts";
import type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import { projectApi } from "../../../protocol/projects/project-api.ts";
import { codingFaceOf } from "../workspace/agents/coding-face.ts";
import {
  dropValue,
  type Env,
  type Memo,
  memo,
} from "./agent-tab-core-source-env.ts";
import type {
  AgentFace,
  PermissionsView,
  SessionEntry,
  SessionStatus,
  SourceResult,
} from "./agent-tab-source.ts";

/** 얼굴(이름·자리 이름·권한 요약)을 기억하는 시간. */
const FACE_TTL_MS = 10_000;

// ---------------------------------------------------------------- 얼굴

type FaceDetails = AgentFace;

async function workspaceNameOf(
  env: Env,
  workspace: Workspace | null,
): Promise<SourceResult<string>> {
  if (workspace === null) return { ok: true, value: "" };
  if (workspace.kind === "project") {
    const read = await env.read(projectApi.get, { project: workspace.id });
    return read.ok ? { ok: true, value: read.value.project.title } : read;
  }
  const read = await env.read(appGet, { app: workspace.id });
  return read.ok ? { ok: true, value: read.value.app.name } : read;
}

const agentNames = new WeakMap<Env, Map<string, Promise<string | null>>>();

/** agent 이름. id마다 한 번 읽는다(lophn도 workspace마다 이름이 달라 그 id로 읽는다). 못 읽으면 null이다. */
export function agentNameOf(env: Env, agent: AgentId): Promise<string | null> {
  let known = agentNames.get(env);
  if (known === undefined) {
    known = new Map();
    agentNames.set(env, known);
  }
  let found = known.get(agent);
  if (found === undefined) {
    found = env
      .read(agentRead, { agent })
      .then((read) => (read.ok ? read.value.effective.name.value : null));
    known.set(agent, found);
  }
  return found;
}

// ---------------------------------------------------------------- 권한

/** 앱이나 이름을 모르면 id가 대신 보인다. */
async function appNameOf(env: Env, app: string): Promise<string> {
  const read = await env.read(appGet, { app });
  return read.ok ? read.value.app.name : app;
}

/** 할당한 앱마다 이름과 뺀 tool. MCP server는 설정한 층이 할당이라 줄이 없다. */
async function readApps(
  env: Env,
): Promise<SourceResult<PermissionsView["apps"]>> {
  const read = await env.read(assignmentGet, { agent: env.agent });
  if (!read.ok) return read;
  const apps = [];
  for (const entry of read.value.assignment.entries) {
    apps.push({
      name:
        entry.machine === undefined
          ? await appNameOf(env, entry.app)
          : (entry.name ?? entry.app),
      removed: entry.removed_tools,
    });
  }
  return { ok: true, value: apps };
}

/** `/permissions`와 입력칸 아래 요약. */
export async function readPermissions(
  env: Env,
): Promise<SourceResult<PermissionsView>> {
  const apps = await readApps(env);
  return apps.ok ? { ok: true, value: { apps: apps.value } } : apps;
}

// ---------------------------------------------------------------- 얼굴 읽기

export function createFaceCache(env: Env): Memo<FaceDetails> {
  return memo<FaceDetails>(env.now, FACE_TTL_MS);
}

/** 이름·얼굴·자리 이름·권한 요약은 잠깐 기억한다. */
export async function readFace(
  env: Env,
  cache: Memo<FaceDetails>,
): Promise<SourceResult<AgentFace>> {
  const known = cache.get();
  if (known !== undefined) return { ok: true, value: known };
  const read = await env.read(agentRead, {
    agent: env.agent,
    ...(env.workspace === null ? {} : { workspace: env.workspace }),
  });
  if (!read.ok) return read;
  const { effective } = read.value;
  // 정의에는 workspace가 없다. 자리는 이 source의 workspace다.
  const workspace = env.workspace;
  const named = await workspaceNameOf(env, workspace);
  if (!named.ok) return named;
  const apps = await readApps(env);
  if (!apps.ok) return apps;
  const name = effective.name.value;
  const avatar = effective.avatar.value;
  const face: AgentFace = {
    agent: env.agent,
    name,
    // 내장 coding agent는 그 제품 아이콘이다. 올린 이미지는 renderer가 읽을 수 있는 주소가 없어 이름 첫 글자로 그린다.
    avatar:
      codingFaceOf(env.agent) ??
      (avatar.kind === "character"
        ? avatar
        : { kind: "initial", text: name.slice(0, 1) }),
    workspace:
      workspace === null ? null : { kind: workspace.kind, name: named.value },
    permissionSummary: t("conversation.label.permission-summary", {
      count: apps.value.length,
    }),
  };
  cache.set(face);
  return { ok: true, value: face };
}

// ---------------------------------------------------------------- 목록

export async function readSession(
  env: Env,
  session: string,
): Promise<SourceResult<WorkspaceSession>> {
  const read = await env.read(workspaceSessionRead, { session });
  return read.ok ? { ok: true, value: read.value.session } : read;
}

function statusOf(state: string | undefined): SessionStatus {
  return state === "waiting"
    ? "waiting"
    : state === "running"
      ? "working"
      : "idle";
}

/** 그 agent의 session 전부(archive 포함). 상태는 session snapshot에서 온다. */
export async function readSessions(
  env: Env,
): Promise<SourceResult<SessionEntry[]>> {
  const listed = await env.pages(
    workspaceSessionList,
    { agent: env.agent, workspace: env.workspace, archived: "include" },
    (out) => out.sessions,
  );
  if (!listed.ok) return listed;
  if (listed.value.length === 0) return { ok: true, value: [] };
  const snapshots = await env.read(sessionSnapshotsList, {
    sessions: listed.value.map((session) => session.id),
  });
  if (!snapshots.ok) return snapshots;
  const states = new Map(
    snapshots.value.snapshots.map((one) => [one.session, one.state]),
  );
  return {
    ok: true,
    value: listed.value.map(
      (session): SessionEntry => ({
        id: session.id,
        title: session.title,
        status: statusOf(states.get(session.id)),
        activeAt: session.last_active_at ?? env.nowIso(),
        archived: session.lifecycle === "archived",
      }),
    ),
  };
}

// ---------------------------------------------------------------- 관리

/** 첫 말을 보내기 전에 session을 연다. */
export async function openSession(
  env: Env,
  id: string,
): Promise<SourceResult<{ state_seq: string }>> {
  const opened = await env.command(workspaceSessionOpen, {
    input: { id, agent: env.agent, workspace: env.workspace },
    compare: {},
    key: `sessions-open-${id}`,
  });
  return opened.ok ? { ok: true, value: opened.value } : opened;
}

export async function archiveSessionOf(
  env: Env,
  session: string,
  options?: { readonly stopTurn?: boolean },
): Promise<SourceResult<void>> {
  const record = await readSession(env, session);
  if (!record.ok) return record;
  const stopTurn = options?.stopTurn === true;
  return dropValue(
    await env.command(archiveSession, {
      input: stopTurn ? { session, stop_turn: true } : { session },
      compare: { state_seq: record.value.state_seq },
      key: `sessions-archive-${session}-${record.value.state_seq}${stopTurn ? "-stop" : ""}`,
    }),
  );
}

export async function deleteSessionOf(
  env: Env,
  session: string,
): Promise<SourceResult<void>> {
  const record = await readSession(env, session);
  if (!record.ok) return record;
  return dropValue(
    await env.command(deleteSession, {
      input: { session },
      compare: { state_seq: record.value.state_seq },
      key: `sessions-delete-${session}-${record.value.state_seq}`,
    }),
  );
}
