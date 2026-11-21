// `handoff/write`: agent가 자기 session의 handoff note를 `computers` 폴더의 자기 하위 폴더에 file 하나로 쓴다. 글은 agent의 것이고
// program은 사실(이 기계, project의 기계를 건너는 id, 첫 등록 폴더의 branch와 commit, 시각, agent 이름)만 붙인다. session은 부른
// agent 자격에서 정한다(입력으로 받지 않는다): 다른 session의 note를 쓰지 못한다. private workspace는 note를 남기지 않는다.
// 언제 쓸지는 지침이 정한다. program은 쓰라고 하거나 스스로 쓰지 않는다.
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type Clock,
  err,
  ok,
  type RandomSource,
  type Result,
} from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type CallPolicy,
  isPrivate,
} from "../../../protocol/lophn-agent/call-policy.ts";
import {
  HANDOFF_MAX_AGE_MS,
  HANDOFF_TEXT_MAX_BYTES,
  handoffFileSchema,
  type handoffWrite,
} from "../../../protocol/lophn-agent/handoff.ts";
import type { Workspace } from "../../../protocol/lophn-agent/workspaces.ts";
import { requesterName } from "../../../protocol/machine/requester.ts";
import {
  decodeRecord,
  encodeRecord,
} from "../../../protocol/folder/records.ts";
import {
  NOTE_FILE_MAX_BYTES,
  noteFilePath,
  noteFileSession,
  notesDir,
} from "../../../protocol/remote/carry.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { z } from "zod";
import { createFolderReader, createFolderWriter } from "../../folder/fs.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import { projectHoldingIdentity } from "../registry/store.ts";
import { loadProject } from "../registry/mod.ts";

type ReadSql = Pick<Sql, "get" | "all">;

export type HandoffWriteDeps = {
  me(): Id<"mch">;
  /** `computers` 폴더 경로. */
  root: string;
  sql: ReadSql;
  /** 이 기계의 session과 그 agent. 없으면 null. */
  session(
    id: Id<"ses">,
  ): { workspace: Workspace | null; agent: string; name: string } | null;
  policy(): CallPolicy;
  /** 안전화를 끝내지 못하면 null. */
  redact(text: string): string | null;
  head(dir: string): Promise<{ branch: string | null; commit: string | null }>;
  clock: Clock;
  random: RandomSource;
  /** note file을 쓴 뒤. 나르기를 깨운다. */
  written(): void;
};

const encoder = new TextEncoder();

const fail = (
  code: "invalid_input" | "forbidden" | "not_found" | "unavailable",
  message: string,
): Result<never> => err({ code, message });

export function handoffWriteHandler(deps: HandoffWriteDeps): MemoryHandler {
  return async (ctx, body) => {
    const input = body as z.infer<typeof handoffWrite.input>;
    const session = ctx.conditions.session as Id<"ses"> | undefined;
    if (session === undefined) {
      return fail("forbidden", "only an agent session leaves a handoff note");
    }
    const found = deps.session(session);
    if (found === null) return fail("not_found", "session not found");
    const { workspace } = found;
    if (workspace?.kind !== "project") {
      return fail(
        "invalid_input",
        "a handoff note belongs to a project session",
      );
    }
    if (isPrivate(deps.policy(), workspace)) {
      return fail("forbidden", "a private workspace leaves no handoff note");
    }
    const project = loadProject(deps.sql, workspace.id);
    if (!project.ok) return project;
    if (project.value === null) return fail("not_found", "project not found");
    const identity = project.value.identity as Id<"pri">;
    const text = deps.redact(input.text);
    if (text === null) {
      return fail("unavailable", "handoff note redaction did not finish");
    }
    if (encoder.encode(text).byteLength > HANDOFF_TEXT_MAX_BYTES) {
      return fail(
        "invalid_input",
        `a handoff note is at most ${HANDOFF_TEXT_MAX_BYTES} bytes`,
      );
    }
    const folder = project.value.folders[0]?.path;
    const { branch, commit } =
      folder === undefined
        ? { branch: null, commit: null }
        : await deps.head(folder);
    const me = deps.me();
    const written_at = deps.clock.now();
    const bytes = encodeRecord(handoffFileSchema, {
      format: 1,
      machine: me,
      session,
      identity,
      agent: found.agent,
      name: requesterName(found.name),
      text,
      branch,
      commit,
      written_at,
    });
    // escape로 불어난 글.
    if (bytes.byteLength > NOTE_FILE_MAX_BYTES) {
      return fail("invalid_input", "the handoff note is too large to carry");
    }
    try {
      await mkdir(deps.root, { recursive: true, mode: 0o700 });
    } catch {
      return fail("unavailable", "the computers folder is missing");
    }
    const saved = await createFolderWriter({
      root: deps.root,
      machine: me,
      random: deps.random,
    }).writeFile(noteFilePath(me, session), bytes);
    if (!saved.ok) return saved;
    deps.written();
    return ok({ identity, branch, commit, written_at });
  };
}

/**
 * 자기 note 가운데 `HANDOFF_MAX_AGE_MS`보다 옛 것, 읽지 못하는 것, 지금 이 기계에서 private이거나 없는 project의 것을 지운다
 * (쓴 뒤 private이 된 project의 note도 다른 기계로 가지 않는다). project는 지금 id나 옛 id로 찾는다(쓴 뒤 컴퓨터끼리 맞추어 id가
 * 바뀌어도 note는 남는다). 나르기가 manifest를 쓰기 전에 부른다.
 */
export async function pruneHandoffNotes(input: {
  me: Id<"mch">;
  /** `computers` 폴더 경로. */
  root: string;
  sql: ReadSql;
  policy: CallPolicy;
  nowMs: number;
  random: RandomSource;
}): Promise<Result<void>> {
  const { me, root } = input;
  let names: string[];
  try {
    names = await readdir(join(root, ...notesDir(me).split("/")));
  } catch {
    return ok(undefined);
  }
  const reader = createFolderReader(root);
  const writer = createFolderWriter({
    root,
    machine: me,
    random: input.random,
  });
  for (const name of names) {
    const session = noteFileSession(name);
    if (session === null) continue;
    const path = noteFilePath(me, session);
    const read = await reader.read(path, NOTE_FILE_MAX_BYTES);
    const file = read.ok
      ? decodeRecord(handoffFileSchema, read.value, NOTE_FILE_MAX_BYTES)
      : null;
    const project = file?.ok
      ? projectHoldingIdentity(input.sql, file.value.identity)
      : null;
    const keep =
      file?.ok === true &&
      project !== null &&
      input.nowMs - Date.parse(file.value.written_at) <= HANDOFF_MAX_AGE_MS &&
      !isPrivate(input.policy, { kind: "project", id: project as Id<"prj"> });
    if (keep) continue;
    const removed = await writer.remove(path);
    if (!removed.ok) return removed;
  }
  return ok(undefined);
}
