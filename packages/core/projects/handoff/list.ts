// `handoff/list`: 다른 기계가 남긴 handoff note 가운데 이 기계에 있는 project의 것. 이 기계의 사람만 읽는다(route actor).
// 읽는 곳은 `computers` 폴더뿐이고(사람의 폴더나 이름 붙인 폴더는 읽지 않는다), 그 안에서도 받는 자리가 그 컴퓨터의 지금 명단
// key로 검증한 manifest가 그 크기·sha256으로 싣는 file만 읽는다(`holds`). 이 기계 자신의 하위 폴더는 출처가 아니다.
// note는 다른 컴퓨터의 글이라 사람에게 보이고 사람이 열면 agent에게 간다: 크기를 먼저 보고, schema로 읽고, path의 기계·session과
// 다르거나 때가 범위 밖인 것은 넘기고, 글 칸마다 제어 문자를 빼고 길이를 줄인다. 틀린 file은 log 한 줄(본문은 적지 않는다,
// file마다 core가 뜬 동안 한 번)로 넘기고 나머지를 계속 읽는다.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type Clock, ok } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type CallPolicy,
  isPrivate,
} from "../../../protocol/lophn-agent/call-policy.ts";
import {
  HANDOFF_MAX_AGE_MS,
  HANDOFF_TEXT_MAX_BYTES,
  handoffFileSchema,
  type handoffList,
  type HandoffNote,
} from "../../../protocol/lophn-agent/handoff.ts";
import { requesterName } from "../../../protocol/machine/requester.ts";
import { decodeRecord } from "../../../protocol/folder/records.ts";
import { CLOCK_AHEAD_MAX_MS } from "../../../protocol/folder/limits.ts";
import {
  NOTE_FILE_MAX_BYTES,
  noteFilePath,
  noteFileSession,
  notesDir,
} from "../../../protocol/remote/carry.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { z } from "zod";
import { createFolderReader } from "../../folder/fs.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import { projectByIdentity, projectStatusOf } from "../lookups.ts";

type ReadSql = Pick<Sql, "get" | "all">;

export type HandoffListDeps = {
  me(): Id<"mch">;
  /** `computers` 폴더 경로. */
  root: string;
  sql: ReadSql;
  /**
   * 받는 자리가 그 기계의 manifest를 지금 명단의 그 컴퓨터 key로 검증해 들고 있고, 그 manifest가 싣는 크기·sha256 그대로 path를
   * 들고 있다(`replica.holds`).
   */
  holds(machine: Id<"mch">, path: string): Promise<boolean>;
  /** 명단의 그 컴퓨터(이 컴퓨터가 아닌) 이름. 없으면 null. */
  computerName(machine: Id<"mch">): string | null;
  policy(): CallPolicy;
  clock: Clock;
  /** 이미 log한 틀린 file의 path. 같은 file은 한 번만 적는다. */
  logged: Set<string>;
  log(message: string): void;
};

// 한 줄 칸(branch, commit)의 길이. git ref 이름과 sha256 commit이 들어간다.
const LINE_MAX = 256;
// 줄바꿈과 탭은 글에 쓸 수 있다. 그 밖의 제어 문자는 뺀다.
const CONTROLS = /[^\P{Cc}\n\t]/gu;
const LINE_BREAKS = /[\n\t]/g;
const encoder = new TextEncoder();

const line = (value: string, max: number) =>
  value.replace(LINE_BREAKS, " ").replace(CONTROLS, "").trim().slice(0, max);
const label = (value: string) =>
  requesterName(value.replace(LINE_BREAKS, " ").replace(CONTROLS, ""));
const optionalLine = (value: string | null) => {
  const out = value === null ? "" : line(value, LINE_MAX);
  return out === "" ? null : out;
};

export function handoffListHandler(deps: HandoffListDeps): MemoryHandler {
  return async (_ctx, body) => {
    const input = body as z.infer<typeof handoffList.input>;
    return ok({ notes: await arrivedNotes(deps, input.project ?? null) });
  };
}

async function arrivedNotes(
  deps: HandoffListDeps,
  only: string | null,
): Promise<HandoffNote[]> {
  const me = deps.me();
  const now = deps.clock.nowMs();
  const policy = deps.policy();
  const reader = createFolderReader(deps.root);
  const skip = (path: string, why: string) => {
    if (deps.logged.has(path)) return;
    deps.logged.add(path);
    deps.log(`${path} ${why}`);
  };
  const machines = await reader.listMachines();
  const notes: HandoffNote[] = [];
  for (const origin of machines.ok ? machines.value : []) {
    if (origin === me) continue;
    const computer = deps.computerName(origin);
    if (computer === null) continue;
    let names: string[];
    try {
      names = await readdir(join(deps.root, ...notesDir(origin).split("/")));
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      const session = noteFileSession(name);
      if (session === null) continue;
      const path = noteFilePath(origin, session);
      if (!(await deps.holds(origin, path))) continue;
      const read = await reader.read(path, NOTE_FILE_MAX_BYTES);
      const file = read.ok
        ? decodeRecord(handoffFileSchema, read.value, NOTE_FILE_MAX_BYTES)
        : null;
      if (!file?.ok) {
        skip(path, "is not a handoff note file");
        continue;
      }
      const note = file.value;
      // 그 폴더의 기계가 그 session으로 쓴 것만.
      if (note.machine !== origin || note.session !== session) {
        skip(path, "is not a handoff note of that computer");
        continue;
      }
      if (encoder.encode(note.text).byteLength > HANDOFF_TEXT_MAX_BYTES) {
        skip(path, "is over the handoff note size");
        continue;
      }
      const at = Date.parse(note.written_at);
      if (at > now + CLOCK_AHEAD_MAX_MS || now - at > HANDOFF_MAX_AGE_MS) {
        continue;
      }
      const project = projectByIdentity(deps.sql, note.identity);
      if (
        project === null ||
        (only !== null && project !== only) ||
        projectStatusOf(deps.sql, project) !== "active" ||
        isPrivate(policy, { kind: "project", id: project as Id<"prj"> })
      ) {
        continue;
      }
      notes.push({
        machine: origin,
        computer: label(computer),
        session,
        project: project as Id<"prj">,
        agent_name: label(note.name),
        text: note.text.replace(CONTROLS, ""),
        branch: optionalLine(note.branch),
        commit: optionalLine(note.commit),
        written_at: note.written_at,
      });
    }
  }
  return notes.sort((a, b) =>
    a.written_at === b.written_at ? 0 : a.written_at < b.written_at ? 1 : -1,
  );
}
