// 사람 지침(LOPHN.md) 읽기 통로의 core 쪽 길(lophn-agent/instructions). LOPHN.md는 document·판 없이 그냥
// 파일이라 GetInstructions는 읽을 때마다 파일을 연다: 전역 `~/.lophn/LOPHN.md`(data root), project 폴더의
// LOPHN.md(첫 등록 폴더 바로 아래), 그리고 agent 정의 본문이다. 앱 층은 없다.
// 어느 project인지는 읽는 쪽이 정하지 않고 그 session의 place로 정한다(lophn만 project를 골라 읽는다).
// 읽기만 있다. 파일 저장은 사람이 editor에서 하고 agent는 만들 길이 없다.
// 이 모듈은 core가 정적으로 import하지 않는다(팀 file wiring/instructions-registration.ts만 reader Worker가 부른다). 동기
// file API는 reader Worker 안에서만 쓴다(core_imports_test).
import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  INSTRUCTION_PREVIEW_MAX_BYTES,
  instructionPreview,
  instructionsGet,
  type Place,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
} from "../../../protocol/server/mod.ts";
import type { ReaderRegistration } from "../../storage/ledger/mod.ts";
import { dataRootOf } from "../agents/store.ts";
import { loadSession, placeOf } from "../session/model.ts";
import {
  encodeInstructionFile,
  INSTRUCTION_FILE_MAX_BYTES,
  type InstructionFile,
  type InstructionLayerKind,
  previewInstruction,
} from "./mod.ts";

const FILE_NAME = "LOPHN.md";

function unavailable(): Result<never> {
  return err({ code: "unavailable", message: "지침 파일을 읽지 못했다" });
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "instruction not found" });
}

// 처음 maxBytes까지만 읽고 실제 크기를 함께 낸다. 파일이 없으면 null, 있는데 읽지 못하면(폴더·권한) unavailable이다.
function openFile(
  path: string,
  maxBytes = INSTRUCTION_FILE_MAX_BYTES,
): Result<InstructionFile | null> {
  let file: Deno.FsFile;
  try {
    file = Deno.openSync(path, { read: true });
  } catch (error) {
    return error instanceof Deno.errors.NotFound ? ok(null) : unavailable();
  }
  try {
    const stat = file.statSync();
    if (!stat.isFile) return unavailable();
    const bytes = new Uint8Array(
      Math.min(stat.size, maxBytes),
    );
    let read = 0;
    while (read < bytes.length) {
      const count = file.readSync(bytes.subarray(read));
      if (count === null) break;
      read += count;
    }
    return ok({ size_bytes: stat.size, bytes: bytes.subarray(0, read) });
  } catch {
    return unavailable();
  } finally {
    file.close();
  }
}

export type SessionRow = {
  role: Role;
  operator: string | null;
  place: Place | null;
};

function loadInstructionSession(
  snapshot: ReadSnapshot,
  id: string,
): SessionRow | undefined {
  const found = loadSession(snapshot, id);
  return found === undefined
    ? undefined
    : { role: found.role, operator: found.operator, place: placeOf(found) };
}

// 조립이 넘기는 조회와 규칙이다. project·앱 표와 role별 정의 file 자리는 harness가 모른다.
export type InstructionReadDeps = {
  projectExists(sql: ReadSnapshot["sql"], project: string): boolean;
  projectFirstFolder(sql: ReadSnapshot["sql"], project: string): string | null;
  // 앱 source 폴더가 들어 있는 등록 project.
  projectOfApp(sql: ReadSnapshot["sql"], app: string): string | null;
  agentFilePathOf(root: string, session: SessionRow): string | null;
  mayReadOtherProject(role: Role): boolean;
};

// 그 session의 agent가 prompt로 읽는 project. lophn은 place가 없어 없다. 앱 place는 앱 source가 등록 project 안에
// 있을 때만 있다.
function ownProject(
  deps: InstructionReadDeps,
  snapshot: ReadSnapshot,
  session: SessionRow,
) {
  const { place } = session;
  if (place === null) return null;
  return place.kind === "project"
    ? place.id
    : deps.projectOfApp(snapshot.sql, place.id);
}

// 정의 파일의 frontmatter를 뺀 본문. 닫는 줄이 없으면 깨진 파일이라 null이다.
function bodyOf(text: string): string | null {
  const lines = text.split("\n");
  let body = text;
  if (lines[0]?.trimEnd() === "---") {
    const close = lines.findIndex((line, at) =>
      at > 0 && line.trimEnd() === "---"
    );
    if (close === -1) return null;
    body = lines.slice(close + 1).join("\n");
  }
  return body.replace(/^(\s*\n)+/, "").trimEnd();
}

function readAgentBody(
  deps: InstructionReadDeps,
  root: string,
  session: SessionRow,
): Result<InstructionFile | null> {
  const path = deps.agentFilePathOf(root, session);
  if (path === null) return unavailable();
  let text: string;
  try {
    text = Deno.readTextFileSync(path);
  } catch (error) {
    return error instanceof Deno.errors.NotFound ? ok(null) : unavailable();
  }
  const body = bodyOf(text);
  if (body === null) return unavailable();
  const bytes = new TextEncoder().encode(body);
  return ok({
    size_bytes: bytes.length,
    bytes: bytes.subarray(0, INSTRUCTION_FILE_MAX_BYTES),
  });
}

// GetInstructions의 읽기. 층 하나의 파일을 돌려준다(부재는 null).
// - project 칸은 lophn session만 다른 project를 줄 수 있다. 다른 role은 자기 place의 project만 받는다.
// - 칸이 없으면 session의 place가 가리키는 project다. lophn과 등록 project 밖의 앱은 project 지침이 없다.
function readInstruction(
  deps: InstructionReadDeps,
  snapshot: ReadSnapshot,
  sessionId: string,
  layer: InstructionLayerKind,
  requested: string | undefined,
): Result<InstructionFile | null> {
  const session = loadInstructionSession(snapshot, sessionId);
  if (session === undefined) return notFound();
  const root = dataRootOf(snapshot.sql, undefined);
  if (!root.ok) return unavailable();
  if (layer === "global") return openFile(`${root.value}/${FILE_NAME}`);
  if (layer === "agent") return readAgentBody(deps, root.value, session);
  const own = ownProject(deps, snapshot, session);
  if (requested !== undefined && requested !== own) {
    if (!deps.mayReadOtherProject(session.role)) {
      return err({
        code: "forbidden",
        message: "only lophn reads another project's instructions",
      });
    }
    if (!deps.projectExists(snapshot.sql, requested)) return notFound();
  }
  const project = requested ?? own;
  if (project === null) return ok(null);
  const folder = deps.projectFirstFolder(snapshot.sql, project);
  return folder === null ? ok(null) : openFile(`${folder}/${FILE_NAME}`);
}

// GetInstructions. machine만 읽는다(route의 actors). reader Worker의 동기 handler라 core 흐름과
// ledger writer를 붙잡지 않는다. `as_of_seq`는 읽은 때의 ledger 위치다.
function instructionsGetHandler(
  deps: InstructionReadDeps,
): ReadDefinition<
  typeof instructionsGet
> {
  return {
    route: instructionsGet,
    handle(snapshot, ctx, input) {
      // agent는 자기 session의 지침만 읽는다.
      const actor = parseActor(ctx.actor);
      if (actor?.kind === "agent" && actor.id !== input.session) {
        return err({
          code: "forbidden",
          message: "an agent reads the instructions of its own session",
        });
      }
      try {
        const file = readInstruction(
          deps,
          snapshot,
          input.session,
          input.layer,
          input.project,
        );
        if (!file.ok) return file;
        return ok({
          file: file.value === null ? null : encodeInstructionFile(file.value),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      } catch {
        return unavailable();
      }
    },
  };
}

// PreviewGlobalInstructions. 사람 화면이 모든 project의 LOPHN.md(data root) 앞부분을 읽는다. turn을 모르고 전역 층
// 하나뿐이다. 읽는 길은 GetInstructions와 같은 reader Worker라 core 흐름과 ledger writer를 붙잡지 않는다.
function instructionPreviewHandler(): ReadDefinition<
  typeof instructionPreview
> {
  return {
    route: instructionPreview,
    handle(snapshot) {
      try {
        const root = dataRootOf(snapshot.sql, undefined);
        if (!root.ok) return unavailable();
        const file = openFile(
          `${root.value}/${FILE_NAME}`,
          INSTRUCTION_PREVIEW_MAX_BYTES,
        );
        if (!file.ok) return file;
        if (file.value === null) {
          return ok({
            preview: null,
            as_of_seq: snapshot.as_of_seq,
            next_cursor: null,
          });
        }
        const preview = previewInstruction(file.value);
        if (!preview.ok) return preview;
        return ok({
          preview: preview.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      } catch {
        return unavailable();
      }
    },
  };
}

export function createInstructionReads(
  deps: InstructionReadDeps,
): ReaderRegistration {
  return {
    reads: [
      instructionsGetHandler(deps),
      instructionPreviewHandler(),
    ],
    ports: new Map(),
  };
}
