// <data root>/terminal-agents/sessions/<project>.json은 core만 쓴다. lophn 터미널에서 hook이나 GUI가 session id를 알려 준
// coding agent session의 identity(harness·id·folder·cwd·첫 prompt·harness가 붙인 이름·시각)만 남기고
// 실행 상태는 저장하지 않는다. 쓰기는 temp file 뒤 rename인 원자 교체다(폴더 0700, file 0600).
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { TerminalAgentSession } from "../../protocol/coding-agent/terminals.ts";
import { cleanAgentTitle } from "./agent-state.ts";

/** 저장한 session의 자리. 옛 자리에서 옮기는 data step도 이것을 쓴다. */
export const sessionsFolder = (dataRoot: string) =>
  join(dataRoot, "terminal-agents", "sessions");

async function writeFileAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, file);
}

const MAX_SESSIONS = 50;

type Stored = Omit<TerminalAgentSession, "resumable">;

export type SessionNote = {
  project: string;
  folder_ref: string;
  cwd: string;
  harness: string;
  external_session: string;
  title: string | null;
  /** hook이나 ACP가 알려 준 harness의 session 이름. 없으면 null이다. */
  name: string | null;
};

export interface AgentSessionStore {
  /** 그 project의 저장한 session. 새것부터다. 없거나 손상이면 비어 있다. */
  list(project: string): Promise<TerminalAgentSession[]>;
  /** (harness, external_session)으로 upsert하고 바뀐 목록을 돌려준다. */
  note(note: SessionNote): Promise<TerminalAgentSession[]>;
  /**
   * 사람이 정한 이름을 쓰고 고정한다. null이면 이름을 비우고 고정을 푼다(다음 hook 이름이 다시 들어온다).
   * 저장한 적 없는 session이면 바꿀 것이 없다. 바뀐 목록을 돌려준다.
   */
  rename(input: {
    project: string;
    harness: string;
    external_session: string;
    name: string | null;
  }): Promise<TerminalAgentSession[]>;
}

// name·pinned는 뒤에 생긴 칸이라 없는 옛 record도 받아 기본값(null·false)을 채운다.
type StoredBase = Omit<Stored, "name" | "pinned">;

function isStoredBase(value: unknown): value is StoredBase {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.harness === "string" &&
    typeof item.external_session === "string" &&
    typeof item.project === "string" &&
    typeof item.folder_ref === "string" &&
    typeof item.cwd === "string" &&
    (item.title === null || typeof item.title === "string") &&
    typeof item.started_at === "number" &&
    typeof item.last_at === "number"
  );
}

function stored(value: unknown): Stored | null {
  if (!isStoredBase(value)) return null;
  const item = value as Record<string, unknown>;
  return {
    ...value,
    name: typeof item.name === "string" ? item.name : null,
    pinned: item.pinned === true,
  };
}

export function createAgentSessionStore(options: {
  dataRoot: string;
  now(): number;
  /** harness에 resume 규칙이 있는지. */
  resumable(harness: string): boolean;
}): AgentSessionStore {
  // 같은 project의 hook이 겹쳐도 읽고 쓰는 순서를 지켜 갱신을 잃지 않는다.
  const chains = new Map<string, Promise<unknown>>();

  const fileOf = (project: string) =>
    join(sessionsFolder(options.dataRoot), `${project}.json`);

  async function read(project: string): Promise<Stored[]> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(fileOf(project), "utf8"),
      );
      const sessions = (parsed as { sessions?: unknown } | null)?.sessions;
      return Array.isArray(sessions)
        ? sessions.flatMap((item) => stored(item) ?? [])
        : [];
    } catch {
      return [];
    }
  }

  const view = (sessions: Stored[]): TerminalAgentSession[] =>
    sessions.map((item) => ({
      ...item,
      resumable: options.resumable(item.harness),
    }));

  function queue<T>(project: string, run: () => Promise<T>): Promise<T> {
    const result = (chains.get(project) ?? Promise.resolve()).then(run, run);
    chains.set(project, result);
    return result;
  }

  return {
    async list(project) {
      return view(await read(project));
    },
    note(note) {
      const run = async (): Promise<TerminalAgentSession[]> => {
        const at = options.now();
        const sessions = await read(note.project);
        const old = sessions.find(
          (item) =>
            item.harness === note.harness &&
            item.external_session === note.external_session,
        );
        // null·빈 문자열·harness 기본 라벨은 기존 non-null 제목·이름을 절대 지우지 못한다.
        const incomingTitle = cleanAgentTitle(note.title, note.harness);
        const incomingName = cleanAgentTitle(note.name, note.harness);
        const next: Stored = {
          harness: note.harness,
          external_session: note.external_session,
          project: note.project,
          folder_ref: note.folder_ref,
          cwd: note.cwd,
          title: old?.title ?? incomingTitle,
          // 사람이 고정한 이름은 hook·ACP가 덮어쓰지 않는다. 비어 있는 값은 아는 이름을 지우지 않는다.
          name: old?.pinned ? old.name : (incomingName ?? old?.name ?? null),
          pinned: old?.pinned ?? false,
          started_at: old?.started_at ?? at,
          last_at: at,
        };
        const rest = sessions.filter((item) => item !== old);
        const list = [next, ...rest]
          .sort((a, b) => b.last_at - a.last_at)
          .slice(0, MAX_SESSIONS);
        await writeFileAtomic(
          fileOf(note.project),
          JSON.stringify({ sessions: list }),
        );
        return view(list);
      };
      return queue(note.project, run);
    },
    rename(input) {
      const run = async (): Promise<TerminalAgentSession[]> => {
        const sessions = await read(input.project);
        const old = sessions.find(
          (item) =>
            item.harness === input.harness &&
            item.external_session === input.external_session,
        );
        if (old === undefined) return view(sessions);
        const list = sessions.map((item) =>
          item === old
            ? { ...item, name: input.name, pinned: input.name !== null }
            : item,
        );
        await writeFileAtomic(
          fileOf(input.project),
          JSON.stringify({ sessions: list }),
        );
        return view(list);
      };
      return queue(input.project, run);
    },
  };
}
