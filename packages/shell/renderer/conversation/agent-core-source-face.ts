// 화면이 고정해 보이는 agent(머리·composer의 얼굴, 자리 이름, 권한 요약)와 그 agent·자리의 session 목록.
import { t } from "@lophn/wording";

import type {
  AgentFace,
  AgentRole,
  SessionEntry,
  SourceResult,
} from "./agent-source.ts";
import {
  type AgentEnv,
  fillTimes,
  latestRun,
  runsOfSession,
} from "./agent-core-source-env.ts";
import type { Memo } from "./agent-core-source-link.ts";
import type {
  AssignmentValue,
  RunValue,
  SessionValue,
} from "./agent-core-source-values.ts";

/** 제품이 이름을 고정하는 built-in(lophn-agent/agents#R2). 정의 목록을 읽을 수 없는 전역 자리에서만 쓴다. */
const BUILTIN_NAMES: Record<AgentRole, string> = {
  lophn: "lophn",
  context_engineer: "Context Engineer",
  app_engineer: "App Engineer",
  operator: "Operator",
};

const DEFAULT_ICON = "default";

export type FaceDetails = Omit<AgentFace, "role" | "state">;

interface AgentRow {
  assignment: string;
  name: string;
  profile: { kind: "icon"; icon: string } | { kind: "image"; image: string };
}

function profileOf(row: AgentRow | undefined, name: string) {
  if (row === undefined) return { kind: "icon" as const, icon: DEFAULT_ICON };
  // 올린 이미지는 renderer가 읽을 수 있는 주소가 없어 이름 첫 글자로 그린다.
  return row.profile.kind === "icon"
    ? { kind: "icon" as const, icon: row.profile.icon }
    : { kind: "initial" as const, text: name.slice(0, 1) };
}

async function detailsOf(
  env: AgentEnv,
  role: AgentRole,
): Promise<SourceResult<FaceDetails>> {
  const { link, target } = env;
  const { assignment, place } = target;
  if (place.kind === "global") {
    const name = BUILTIN_NAMES[role];
    return {
      ok: true,
      value: {
        assignment,
        name,
        profile: profileOf(undefined, name),
        place: { kind: "project", name: "" },
        permissionSummary: t("conversation.label.permission-summary", {
          count: 0,
        }),
      },
    };
  }
  const scope = { kind: place.kind, id: place.id };
  const listed = await link.read<{ agents: AgentRow[] }>("agents", "list", {
    place: scope,
  });
  if (!listed.ok) return listed;
  const row = listed.value.agents.find((item) =>
    item.assignment === assignment
  );
  const name = row?.name ?? BUILTIN_NAMES[role];

  const named = place.kind === "project"
    ? await link.read<{ project: { title: string } }>("projects", "get", {
      project: place.id,
    })
    : await link.read<{ app: { name: string } }>("apps", "get", {
      app: place.id,
    });
  if (!named.ok) return named;
  const placeName = "project" in named.value
    ? named.value.project.title
    : named.value.app.name;

  const detail = await link.read<
    { effective: { permissions: { value: { tools: string[] } } } }
  >("agents", "read", { place: scope, assignment });
  if (!detail.ok) return detail;
  return {
    ok: true,
    value: {
      assignment,
      name,
      profile: profileOf(row, name),
      place: { kind: place.kind, name: placeName },
      permissionSummary: t("conversation.label.permission-summary", {
        count: detail.value.effective.permissions.value.tools.length,
      }),
    },
  };
}

/** 담당의 지금 상태는 매번 읽고, 이름·얼굴·자리 이름·권한 요약은 잠깐 기억한다. */
export async function readFace(
  env: AgentEnv,
  cache: Memo<FaceDetails>,
): Promise<SourceResult<AgentFace>> {
  const read = await env.link.read<{ assignment: AssignmentValue }>(
    "assignments",
    "read",
    { assignment: env.target.assignment },
  );
  if (!read.ok) return read;
  const { role, state } = read.value.assignment;
  let details = cache.get();
  if (details === undefined) {
    const fresh = await detailsOf(env, role);
    if (!fresh.ok) return fresh;
    details = fresh.value;
    cache.set(details);
  }
  return { ok: true, value: { ...details, role, state } };
}

function statusOf(run: RunValue | null): SessionEntry["status"] {
  if (run === null) return "idle";
  if (run.state === "waiting_user") return "waiting";
  return run.state === "finished" ? "idle" : "working";
}

/** 그 담당·자리의 session 전부(archived 포함). 전역 자리에는 session이 없다. */
export async function readSessions(
  env: AgentEnv,
): Promise<SourceResult<SessionEntry[]>> {
  const { link, target } = env;
  if (target.place.kind === "global") return { ok: true, value: [] };
  const listed = await link.pages<SessionValue>("sessions", "list", {
    assignment: target.assignment,
    work_place: { kind: target.place.kind, id: target.place.id },
    archived: "include",
  }, "sessions");
  if (!listed.ok) return listed;
  const runs = await env.runsOf();
  if (!runs.ok) return runs;

  // 마지막 활동 시각: 마지막 run의 끝(없으면 시작) 시각, 시각이 없으면 접수 event, run이 없으면 session의
  // 마지막 변경 event의 시각이다.
  const latest = new Map<string, RunValue | null>();
  const wanted: { subject: string; seq: string }[] = [];
  for (const session of listed.value) {
    const run = latestRun(runsOfSession(runs.value, session.id));
    latest.set(session.id, run);
    if (run === null) {
      wanted.push({ subject: session.id, seq: session.state_seq });
    } else if ((run.finished_at ?? run.started_at) === null) {
      wanted.push({ subject: run.id, seq: run.accepted_seq });
    }
  }
  await fillTimes(env, wanted);

  return {
    ok: true,
    value: listed.value.map((session): SessionEntry => {
      const run = latest.get(session.id) ?? null;
      const seq = run === null ? session.state_seq : run.accepted_seq;
      return {
        id: session.id,
        assignment: session.assignment,
        title: session.title,
        status: statusOf(run),
        activeAt: run?.finished_at ?? run?.started_at ??
          env.times.get(seq) ?? env.nowIso(),
        archived: session.archived,
        closed: session.state === "closed",
      };
    }),
  };
}
