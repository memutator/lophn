// 화면이 고정해 보이는 agent(머리·composer의 얼굴, 자리 이름, 권한 요약)와 그 agent의 session 목록, session 관리
// (열기, archive, 지우기)와 권한 보기. 모두 snapshot read와 command이고 polling은 없다.
import { t } from "@lophn/i18n";

import { assignmentGet } from "../../../protocol/approvals/assignment.ts";
import { appGet } from "../../../protocol/apps/apps.ts";
import { sessionSnapshotsList } from "../../../protocol/events/snapshot.ts";
import { agentRead } from "../../../protocol/lophn-agent/agent-definitions.ts";
import { LOPHN_AGENT_NAME } from "../../../protocol/lophn-agent/agent-values.ts";
import {
  type PlaceSession,
  placeSessionList,
  placeSessionOpen,
  placeSessionRead,
} from "../../../protocol/lophn-agent/agent-sessions.ts";
import {
  type AgentId,
  LOPHN_AGENT_ID,
  type Place,
} from "../../../protocol/lophn-agent/places.ts";
import {
  archiveSession,
  deleteSession,
} from "../../../protocol/lophn-agent/sessions.ts";
import { turnList } from "../../../protocol/lophn-agent/turn-reads.ts";
import { projectGet } from "../../../protocol/projects/project-routes.ts";
import {
  dropValue,
  type Env,
  keyTag,
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
/** session의 마지막 활동 시각을 기억하는 시간. 목록을 다시 읽을 때마다 turn 목록 전체를 읽지 않게 한다. */
const ACTIVE_TTL_MS = 30_000;

// ---------------------------------------------------------------- 얼굴

type FaceDetails = AgentFace;

async function placeNameOf(
  env: Env,
  place: Place | null,
): Promise<SourceResult<string>> {
  if (place === null) return { ok: true, value: "" };
  if (place.kind === "project") {
    const read = await env.read(projectGet, { project: place.id });
    return read.ok ? { ok: true, value: read.value.project.title } : read;
  }
  const read = await env.read(appGet, { app: place.id });
  return read.ok ? { ok: true, value: read.value.app.name } : read;
}

const agentNames = new WeakMap<Env, Map<string, Promise<string | null>>>();

/** agent 이름. lophn은 바뀌지 않아 읽지 않는다. 다른 agent는 id마다 한 번 읽는다. 못 읽으면 null이다. */
export function agentNameOf(env: Env, agent: AgentId): Promise<string | null> {
  if (agent === LOPHN_AGENT_ID) return Promise.resolve(LOPHN_AGENT_NAME);
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
      name: await appNameOf(env, entry.app),
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
    ...(env.place === null ? {} : { place: env.place }),
  });
  if (!read.ok) return read;
  const { effective } = read.value;
  // 정의에는 place가 없다. 자리는 이 source의 place다.
  const place = env.place;
  const named = await placeNameOf(env, place);
  if (!named.ok) return named;
  const apps = await readApps(env);
  if (!apps.ok) return apps;
  const name = effective.name.value;
  const profile = effective.profile.value;
  const face: AgentFace = {
    agent: env.agent,
    name,
    // 올린 이미지는 renderer가 읽을 수 있는 주소가 없어 이름 첫 글자로 그린다.
    profile:
      profile.kind === "character"
        ? profile
        : { kind: "initial", text: name.slice(0, 1) },
    place: place === null ? null : { kind: place.kind, name: named.value },
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
): Promise<SourceResult<PlaceSession>> {
  const read = await env.read(placeSessionRead, { session });
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
    placeSessionList,
    { agent: env.agent, place: env.place, archived: "include" },
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
    value: listed.value.map(
      (session, index): SessionEntry => ({
        id: session.id,
        title: session.title,
        status: statusOf(states.get(session.id)),
        activeAt: active[index] ?? env.nowIso(),
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
  const opened = await env.command(placeSessionOpen, {
    input: { id, agent: env.agent, place: env.place },
    compare: {},
    key: `sessions-open-${id}`,
  });
  return opened.ok ? { ok: true, value: opened.value } : opened;
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
