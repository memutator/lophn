import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import {
  REWIND_MAX_FILE_BYTES,
  recordRewindFile,
  recordRewindWrite,
  stageRewindFile,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { Writer } from "../../../storage/ledger/mod.ts";
import { REWIND_MACHINE_CONTEXT } from "./files.ts";
import { readInside } from "./restore.ts";
import type { RewindStore } from "./store.ts";

// file tool의 쓰기 기록을 core가 받는 입구다(StageRewindFile, RecordRewindWrite). agent runtime은 파일 내용을
// 보내지 않는다: core가 허용 폴더 안에서 쓰기 직전 내용을 직접 읽어 session 저장소에 두고, 쓴 뒤에는 같은
// 확인을 거쳐 machine 자격으로 RecordRewindFile을 낸다. 확인은 둘: 부른 agent 자격의 session·turn이 입력과
// 같고, root가 그 session의 workspace가 file tool에 연 폴더다.

type RewindWriteDeps = {
  store: Pick<RewindStore, "put" | "has">;
  // 그 session의 workspace가 file tool에 연 쓰기 폴더(절대 경로)다. 열리지 않았으면 빈 목록이다.
  foldersOf(session: string): readonly string[];
  // 이번 대화 동안("session") 허락으로 연 바깥 폴더(절대 경로). 이 폴더 안 쓰기도 rewind 기록에 남는다.
  openedFoldersOf?(session: string): readonly string[];
  writer(): Writer;
};

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

function reject(
  code: "invalid_input" | "forbidden" | "unavailable",
  message: string,
): Result<never> {
  return err({ code, message });
}

function sameTurn(
  ctx: AuthenticatedContext,
  input: { session: string; turn: string },
): boolean {
  return (
    parseActor(ctx.actor)?.kind === "agent" &&
    ctx.conditions.session === input.session &&
    ctx.conditions.turn === input.turn
  );
}

function insideDir(folder: string, target: string): boolean {
  const rel = relative(folder, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function openRoot(
  deps: RewindWriteDeps,
  session: string,
  root: string,
): Promise<boolean> {
  for (const folder of deps.foldersOf(session)) {
    try {
      if ((await realpath(folder)) === root) return true;
    } catch {
      // 없어진 폴더는 열린 폴더가 아니다.
    }
  }
  for (const folder of deps.openedFoldersOf?.(session) ?? []) {
    try {
      const realFolder = await realpath(folder);
      if (realFolder === root || insideDir(realFolder, root)) return true;
    } catch {
      // 없어진 폴더는 열린 폴더가 아니다.
    }
  }
  return false;
}

export function createRewindWriteHandlers(
  deps: RewindWriteDeps,
): ReadonlyMap<string, MemoryHandler> {
  const stage: MemoryHandler = async (ctx, value) => {
    const parsed = stageRewindFile.input.safeParse(value);
    if (!parsed.success) return reject("invalid_input", "invalid input");
    const input = parsed.data;
    if (!sameTurn(ctx, input)) {
      return reject("forbidden", "an agent records only for its own turn");
    }
    if (!(await openRoot(deps, input.session, input.root))) {
      return reject("forbidden", "the folder is not open to this session");
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readInside(input.root, input.path);
    } catch {
      return reject("unavailable", "the file cannot be read");
    }
    if (bytes === null) {
      return ok({
        before: { exists: false, sha256: null, blob: null },
        before_size_bytes: null,
      });
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    let blob: string | null = null;
    if (bytes.length <= REWIND_MAX_FILE_BYTES) {
      try {
        blob = (await deps.store.put(input.session, bytes)).key;
      } catch {
        // 저장소가 실패해도 쓰기를 막지 않는다. blob 없이 기록하면 command가 checkpoint를 낮춘다.
      }
    }
    return ok({
      before: { exists: true, sha256, blob },
      before_size_bytes: bytes.length,
    });
  };

  const record: MemoryHandler = async (ctx, value) => {
    const parsed = recordRewindWrite.input.safeParse(value);
    if (!parsed.success) return reject("invalid_input", "invalid input");
    const input = parsed.data;
    if (!sameTurn(ctx, input)) {
      return reject("forbidden", "an agent records only for its own turn");
    }
    if (!(await openRoot(deps, input.session, input.root))) {
      return reject("forbidden", "the folder is not open to this session");
    }
    const blob = input.before.blob;
    if (blob !== null) {
      let stored = false;
      try {
        stored = await deps.store.has(input.session, blob);
      } catch {
        // 저장소를 읽지 못하면 없는 것으로 본다.
      }
      if (!stored) {
        return reject("invalid_input", "the pre-image is not staged");
      }
    }
    const sent = await deps.writer().command(REWIND_MACHINE_CONTEXT, {
      command: recordRewindFile.name,
      input,
      idempotency_key: `rewind-file:${input.tool_call}:${input.path}`,
      compare: {},
      prepared: [],
    });
    return sent.ok ? ok(sent.value.result) : sent;
  };

  return new Map<string, MemoryHandler>([
    [key(stageRewindFile), stage],
    [key(recordRewindWrite), record],
  ]);
}
