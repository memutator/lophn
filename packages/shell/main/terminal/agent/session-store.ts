// <data root>/shell/agent-sessions/<project>.json은 main만 쓴다. lophn 터미널에서 hook이 session id를 알려 준
// coding agent session의 identity(harness·id·folder·cwd·첫 prompt·시각)만 남기고 상태는 저장하지 않는다.
// 쓰기는 layout-store와 같은 원자 교체다.
import { join } from "node:path";

import type { TerminalAgentSession } from "../../../ipc/terminal.ts";
import {
  defaultStoreDeps,
  type StoreDeps,
  writeFileAtomic,
} from "../../workspace/atomic-file.ts";

const MAX_SESSIONS = 50;

type Stored = Omit<TerminalAgentSession, "resumable">;

export type SessionNote = {
  project: string;
  folder_ref: string;
  cwd: string;
  harness: string;
  external_session: string;
  title: string | null;
};

export interface AgentSessionStore {
  /** 그 project의 저장한 session. 새것부터다. 없거나 손상이면 비어 있다. */
  list(project: string): Promise<TerminalAgentSession[]>;
  /** (harness, external_session)으로 upsert하고 바뀐 목록을 돌려준다. */
  note(note: SessionNote): Promise<TerminalAgentSession[]>;
}

function isStored(value: unknown): value is Stored {
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

export function createAgentSessionStore(options: {
  dataRoot: string;
  now(): number;
  /** harness에 resume 규칙이 있는지. 표는 protocol에 있고 shell tsc는 따라가지 못해 wiring이 넣는다. */
  resumable(harness: string): boolean;
  fs?: Partial<StoreDeps>;
}): AgentSessionStore {
  const fs: StoreDeps = { ...defaultStoreDeps, ...options.fs };
  // 같은 project의 hook이 겹쳐도 읽고 쓰는 순서를 지켜 갱신을 잃지 않는다.
  const chains = new Map<string, Promise<unknown>>();

  const fileOf = (project: string) =>
    join(options.dataRoot, "shell", "agent-sessions", `${project}.json`);

  async function read(project: string): Promise<Stored[]> {
    try {
      const parsed: unknown = JSON.parse(
        new TextDecoder().decode(await fs.readFile(fileOf(project))),
      );
      const sessions = (parsed as { sessions?: unknown } | null)?.sessions;
      return Array.isArray(sessions) ? sessions.filter(isStored) : [];
    } catch {
      return [];
    }
  }

  const view = (sessions: Stored[]): TerminalAgentSession[] =>
    sessions.map((item) => ({
      ...item,
      resumable: options.resumable(item.harness),
    }));

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
        const next: Stored = {
          harness: note.harness,
          external_session: note.external_session,
          project: note.project,
          folder_ref: note.folder_ref,
          cwd: note.cwd,
          title: old?.title ?? note.title,
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
          fs,
        );
        return view(list);
      };
      const result = (chains.get(note.project) ?? Promise.resolve()).then(
        run,
        run,
      );
      chains.set(note.project, result);
      return result;
    },
  };
}
