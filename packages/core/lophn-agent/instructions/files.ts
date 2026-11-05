// 사람 지침(LOPHN.md, 없으면 CLAUDE.md) 읽기 통로의 core 쪽 길(lophn-agent/instructions). LOPHN.md는 document·판 없이 그냥
// 파일이라 GetInstructions는 읽을 때마다 파일을 연다: 전역 `~/.lophn/LOPHN.md`(data root), project의
// LOPHN.md(첫 등록 폴더 바로 아래, 폴더가 없으면 `<data>/projects/<prj>/`). 전역과 project 자리는
// LOPHN.md가 없으면(ENOENT) 같은 자리의 CLAUDE.md를 읽는다. 그리고 agent 정의 본문이다.
// 어느 project인지는 읽는 쪽이 정하지 않고 그 session의 workspace로 정한다.
// 읽기만 있다. 파일 저장은 사람이 editor에서 하고 agent는 만들 길이 없다.
// 이 모듈은 core가 정적으로 import하지 않는다(팀 file wiring/instructions-registration.ts만 reader Worker가 부른다). 동기
// file API는 reader Worker 안에서만 쓴다(core_imports_test).
import {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import { err, errorCode, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  INSTRUCTION_FILE_NAMES,
  instructionsGet,
  type AgentId,
  type Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
} from "../../../protocol/server/mod.ts";
import type { ReaderRegistration } from "../../storage/ledger/mod.ts";
import { dataRootOf } from "../agents/store.ts";
import { loadSession, workspaceOf } from "../session/model.ts";
import {
  encodeInstructionFile,
  INSTRUCTION_FILE_MAX_BYTES,
  type InstructionFile,
  type InstructionLayerKind,
} from "./mod.ts";

function unavailable(): Result<never> {
  return err({ code: "unavailable", message: "지침 파일을 읽지 못했다" });
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "instruction not found" });
}

// 처음 INSTRUCTION_FILE_MAX_BYTES까지만 읽고 실제 크기를 함께 낸다. 파일이 없으면 null, 있는데 읽지 못하면(폴더·권한) unavailable이다.
function openFile(
  path: string,
  name?: InstructionFile["name"],
): Result<InstructionFile | null> {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (error) {
    return errorCode(error) === "ENOENT" ? ok(null) : unavailable();
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return unavailable();
    const bytes = new Uint8Array(
      Math.min(stat.size, INSTRUCTION_FILE_MAX_BYTES),
    );
    let read = 0;
    while (read < bytes.length) {
      const count = readSync(fd, bytes, read, bytes.length - read, null);
      if (count === 0) break;
      read += count;
    }
    return ok({
      ...(name === undefined ? {} : { name }),
      size_bytes: stat.size,
      bytes: bytes.subarray(0, read),
    });
  } catch {
    return unavailable();
  } finally {
    closeSync(fd);
  }
}

// 전역·project 자리의 지침. LOPHN.md가 있으면 CLAUDE.md는 보지 않는다(있는데 못 읽어도 그대로 unavailable이다).
function openInstructionFile(folder: string): Result<InstructionFile | null> {
  for (const name of INSTRUCTION_FILE_NAMES) {
    const file = openFile(`${folder}/${name}`, name);
    if (!file.ok || file.value !== null) return file;
  }
  return ok(null);
}

export type SessionRow = {
  agent: AgentId;
  workspace: Workspace | null;
};

function loadInstructionSession(
  snapshot: ReadSnapshot,
  id: string,
): SessionRow | undefined {
  const found = loadSession(snapshot, id);
  if (found === undefined) return undefined;
  return { agent: found.agent, workspace: workspaceOf(found) };
}

// 조립이 넘기는 조회와 규칙이다. project 표와 agent 정의 file 자리는 harness가 모른다.
export type InstructionReadDeps = {
  projectFirstFolder(sql: ReadSnapshot["sql"], project: string): string | null;
  // 등록 폴더가 없는 project의 지침은 data root의 project 자리에 있다.
  projectDataFolder(root: string, project: string): string;
  agentFilePathOf(root: string, session: SessionRow): string | null;
};

// 그 session의 agent가 prompt로 읽는 project. home은 workspace가 없어 없고, 앱 그릇에는 LOPHN.md가 없다.
function ownProject(session: SessionRow) {
  return session.workspace?.kind === "project" ? session.workspace.id : null;
}

// 정의 파일의 frontmatter를 뺀 본문. 닫는 줄이 없으면 깨진 파일이라 null이다.
function bodyOf(text: string): string | null {
  const lines = text.split("\n");
  let body = text;
  if (lines[0]?.trimEnd() === "---") {
    const close = lines.findIndex(
      (line, at) => at > 0 && line.trimEnd() === "---",
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
    text = readFileSync(path, "utf8");
  } catch (error) {
    return errorCode(error) === "ENOENT" ? ok(null) : unavailable();
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
// - project 층은 session의 workspace가 가리키는 project다. home과 앱 workspace는 project 지침이 없다.
function readInstruction(
  deps: InstructionReadDeps,
  snapshot: ReadSnapshot,
  sessionId: string,
  layer: InstructionLayerKind,
): Result<InstructionFile | null> {
  const session = loadInstructionSession(snapshot, sessionId);
  if (session === undefined) return notFound();
  const root = dataRootOf(snapshot.sql, undefined);
  if (!root.ok) return unavailable();
  if (layer === "global") return openInstructionFile(root.value);
  if (layer === "agent") return readAgentBody(deps, root.value, session);
  const project = ownProject(session);
  if (project === null) return ok(null);
  const folder =
    deps.projectFirstFolder(snapshot.sql, project) ??
    deps.projectDataFolder(root.value, project);
  return openInstructionFile(folder);
}

// GetInstructions. machine만 읽는다(route의 actors). reader Worker의 동기 handler라 core 흐름과
// ledger writer를 붙잡지 않는다. `as_of_seq`는 읽은 때의 ledger 위치다.
function instructionsGetHandler(
  deps: InstructionReadDeps,
): ReadDefinition<typeof instructionsGet> {
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

export function createInstructionReads(
  deps: InstructionReadDeps,
): ReaderRegistration {
  return {
    reads: [instructionsGetHandler(deps)],
    ports: new Map(),
  };
}
