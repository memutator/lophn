// 화면이 고정해 보이는 agent(머리·composer의 얼굴, 자리 이름, 권한 요약)와 그 agent의 session 목록, session 관리
// (열기, 이름, archive, 지우기, fork, compact)와 권한 보기. 모두 snapshot read와 command이고 polling은 없다.
import { t } from "@lophn/wording";

import {
  type AgentGrant,
  agentGrantsGet,
  DEFAULT_ASK,
  SETTINGS_EDIT_DEFAULT_ASK,
} from "../../../protocol/approvals/grants.ts";
import { sessionSnapshotsList } from "../../../protocol/events/snapshot.ts";
import { agentDefinitionRead } from "../../../protocol/lophn-agent/agent-definitions.ts";
import {
  type AgentSession,
  agentSessionList,
  agentSessionRead,
  openAgentSession,
} from "../../../protocol/lophn-agent/agent-sessions.ts";
import type { CallAgent } from "../../../protocol/lophn-agent/calls.ts";
import {
  archiveSession,
  deleteSession,
  forkSession,
  renameSession,
  requestSessionCompact,
} from "../../../protocol/lophn-agent/sessions.ts";
import { receivedMessageList } from "../../../protocol/lophn-agent/received-messages.ts";
import { turnList } from "../../../protocol/lophn-agent/turn-reads.ts";
import { appGet } from "../../../protocol/apps/apps.ts";
import { projectGet } from "../../../protocol/projects/project-routes.ts";
import type { Place } from "../../../protocol/lophn-agent/places.ts";
import type {
  AgentFace,
  GrantRow,
  GrantSetting,
  PermissionsView,
  SessionEntry,
  SessionStatus,
  SourceResult,
} from "./agent-tab-source.ts";
import {
  dropValue,
  type Env,
  keyTag,
  type Memo,
  memo,
} from "./agent-tab-core-source-env.ts";

/** 얼굴(이름·자리 이름·권한 요약)을 기억하는 시간. */
const FACE_TTL_MS = 10_000;
/** session의 마지막 활동 시각을 기억하는 시간. 목록을 다시 읽을 때마다 turn 목록 전체를 읽지 않게 한다. */
const ACTIVE_TTL_MS = 30_000;

// ---------------------------------------------------------------- 얼굴

type FaceDetails = AgentFace;

async function placeNameOf(
  env: Env,
  place: Place | null,
): Promise<SourceResult<string>> {
  if (place === null) return { ok: true, value: "" };
  const read = await env.read(projectGet, { project: place.id });
  return read.ok ? { ok: true, value: read.value.project.title } : read;
}

function roleLabel(agent: CallAgent["role"]): string {
  switch (agent) {
    case "lophn":
      return t("waiting.label.agent-lophn");
    case "project_manager":
      return t("waiting.label.agent-project-manager");
    case "app_engineer":
      return t("waiting.label.agent-project-manager");
    case "operator":
      return t("waiting.label.agent-operator");
    case "coding_agent":
      return t("waiting.label.agent-coding");
  }
}

export { roleLabel };

// ---------------------------------------------------------------- 권한

/** 앱이나 이름을 모르면 id가 대신 보인다. */
async function appNameOf(env: Env, app: string): Promise<string> {
  const read = await env.read(appGet, { app });
  return read.ok ? read.value.app.name : app;
}

function settingOf(
  setting: "never" | "ask" | undefined,
  fallback: "never" | "ask",
): GrantSetting {
  return (setting ?? fallback) === "ask" ? "ask" : "allow";
}

/** grant 한 대상이 효과 하나에 대한 한 줄이 된다. 사람이 바꾸지 않은 칸은 효과별 기본값이다. */
async function grantRowsOf(
  env: Env,
  grant: AgentGrant,
): Promise<GrantRow[]> {
  const rows: GrantRow[] = [];
  for (const entry of grant.entries) {
    switch (entry.kind) {
      case "app": {
        const name = await appNameOf(env, entry.app);
        if (entry.apis.length === 0) {
          rows.push({
            target: name,
            effect: "app",
            setting: settingOf(undefined, DEFAULT_ASK.write),
          });
        }
        for (const api of entry.apis) {
          rows.push({
            target: `${name} · ${api.api}`,
            effect: "app",
            setting: api.setting === "excluded"
              ? "deny"
              : settingOf(api.setting, DEFAULT_ASK.write),
          });
        }
        break;
      }
      case "mcp_tool":
        rows.push({
          target: `${entry.server} · ${entry.tool}`,
          effect: "external",
          setting: settingOf(entry.setting, DEFAULT_ASK.external),
        });
        break;
      case "agent":
        rows.push({
          target: roleLabel(entry.agent.role),
          effect: "agent",
          setting: entry.setting === "excluded"
            ? "deny"
            : settingOf(entry.setting, DEFAULT_ASK.read),
        });
        break;
      case "settings":
        rows.push({
          target: "settings",
          effect: "write",
          setting: settingOf(entry.setting, SETTINGS_EDIT_DEFAULT_ASK),
        });
        break;
    }
  }
  return rows;
}

async function readGrantRows(env: Env): Promise<SourceResult<GrantRow[]>> {
  const read = await env.read(agentGrantsGet, { agent: env.agent });
  if (!read.ok) return read;
  return { ok: true, value: await grantRowsOf(env, read.value.grant) };
}

/** `/permissions`와 입력칸 아래 요약. "이 session 동안" 허락은 core 메모리에 있고 읽는 route가 없어 비어 있다. */
export async function readPermissions(
  env: Env,
): Promise<SourceResult<PermissionsView>> {
  const rows = await readGrantRows(env);
  if (!rows.ok) return rows;
  return { ok: true, value: { grants: rows.value, session: [] } };
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
  const read = await env.read(agentDefinitionRead, { agent: env.agent });
  if (!read.ok) return read;
  const { role, place, effective } = read.value;
  const named = await placeNameOf(env, place);
  if (!named.ok) return named;
  const grants = await readGrantRows(env);
  if (!grants.ok) return grants;
  const name = effective.name.value;
  const profile = effective.profile.value;
  const face: AgentFace = {
    role,
    name,
    // 올린 이미지는 renderer가 읽을 수 있는 주소가 없어 이름 첫 글자로 그린다.
    profile: profile.kind === "icon"
      ? { kind: "icon", icon: profile.icon }
      : { kind: "initial", text: name.slice(0, 1) },
    place: { kind: "project", name: named.value },
    permissionSummary: t("conversation.label.permission-summary", {
      count: grants.value.filter((row) => row.setting === "allow").length,
    }),
  };
  cache.set(face);
  return { ok: true, value: face };
}

// ---------------------------------------------------------------- 목록

export async function readSession(
  env: Env,
  session: string,
): Promise<SourceResult<AgentSession>> {
  const read = await env.read(agentSessionRead, { session });
  return read.ok ? { ok: true, value: read.value.session } : read;
}

function statusOf(state: string | undefined): SessionStatus {
  return state === "waiting"
    ? "waiting"
    : state === "running"
    ? "working"
    : "idle";
}

export function createActiveTimes(): Map<
  string,
  { at: number; value: string | null }
> {
  return new Map();
}

/** 마지막 turn이 끝난(없으면 시작한) 시각. turn이 없으면 null이다. */
async function lastActiveOf(
  env: Env,
  times: ReturnType<typeof createActiveTimes>,
  session: string,
): Promise<string | null> {
  const known = times.get(session);
  if (known !== undefined && env.now() - known.at < ACTIVE_TTL_MS) {
    return known.value;
  }
  const turns = await env.pages(turnList, { session }, (out) => out.turns);
  if (!turns.ok) return known?.value ?? null;
  let latest: string | null = null;
  for (const turn of turns.value) {
    const at = turn.finished_at ?? turn.started_at;
    if (latest === null || at > latest) latest = at;
  }
  times.set(session, { at: env.now(), value: latest });
  return latest;
}

/** 그 agent의 session 전부(archive 포함). 상태는 session snapshot에서 온다. */
export async function readSessions(
  env: Env,
  times: ReturnType<typeof createActiveTimes>,
): Promise<SourceResult<SessionEntry[]>> {
  const listed = await env.pages(
    agentSessionList,
    { agent: env.agent, archived: "include" },
    (out) => out.sessions,
  );
  if (!listed.ok) return listed;
  if (listed.value.length === 0) return { ok: true, value: [] };
  const [snapshots, active] = await Promise.all([
    env.read(sessionSnapshotsList, {
      sessions: listed.value.map((session) => session.id),
    }),
    Promise.all(
      listed.value.map((session) => lastActiveOf(env, times, session.id)),
    ),
  ]);
  if (!snapshots.ok) return snapshots;
  const states = new Map(
    snapshots.value.snapshots.map((one) => [one.session, one.state]),
  );
  return {
    ok: true,
    value: listed.value.map((session, index): SessionEntry => ({
      id: session.id,
      title: session.title,
      status: statusOf(states.get(session.id)),
      activeAt: active[index] ?? env.nowIso(),
      archived: session.lifecycle === "archived",
    })),
  };
}

// ---------------------------------------------------------------- 관리

/** 첫 말을 보내기 전에 session을 연다. */
export async function openSession(
  env: Env,
  id: string,
): Promise<SourceResult<{ state_seq: string }>> {
  const opened = await env.command(openAgentSession, {
    input: { id, agent: env.agent, opening_context: null },
    compare: {},
    key: `sessions-open-${id}`,
  });
  return opened.ok ? { ok: true, value: opened.value } : opened;
}

export async function renameSessionTo(
  env: Env,
  session: string,
  title: string,
): Promise<SourceResult<void>> {
  const trimmed = title.trim();
  if (trimmed === "") return { ok: false, code: "invalid_input" };
  const record = await readSession(env, session);
  if (!record.ok) return record;
  return dropValue(
    await env.command(renameSession, {
      input: { session, title: trimmed },
      compare: { state_seq: record.value.state_seq },
      key: `sessions-rename-${session}-${record.value.state_seq}-${await keyTag(
        trimmed,
      )}`,
    }),
  );
}

export async function archiveSessionOf(
  env: Env,
  session: string,
): Promise<SourceResult<void>> {
  const record = await readSession(env, session);
  if (!record.ok) return record;
  return dropValue(
    await env.command(archiveSession, {
      input: { session },
      compare: { state_seq: record.value.state_seq },
      key: `sessions-archive-${session}-${record.value.state_seq}`,
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

/** 고른 메시지(없으면 마지막 메시지)까지 복사한 새 session. 복사 구간의 끝은 그 메시지의 순번이다. */
export async function forkSessionOf(
  env: Env,
  input: { id: string; session: string; through: string | null },
): Promise<SourceResult<void>> {
  const messages = await env.pages(
    receivedMessageList,
    { session: input.session },
    (out) => out.messages,
  );
  if (!messages.ok) return messages;
  const point = input.through === null
    ? messages.value.at(-1)
    : messages.value.find((message) => message.id === input.through);
  if (point === undefined) return { ok: false, code: "invalid_input" };
  return dropValue(
    await env.command(forkSession, {
      input: {
        id: input.id,
        source: input.session,
        through_seq: point.created_seq,
      },
      compare: {},
      key: `sessions-fork-${input.id}`,
    }),
  );
}

export async function compactSessionOf(
  env: Env,
  session: string,
): Promise<SourceResult<void>> {
  const record = await readSession(env, session);
  if (!record.ok) return record;
  return dropValue(
    await env.command(requestSessionCompact, {
      input: { session },
      compare: { state: "open", state_seq: record.value.state_seq },
      key: `sessions-compact-${session}-${record.value.state_seq}`,
    }),
  );
}
