// 사람 지침(LOPHN.md) 읽기 통로의 core 쪽 길(lophn-agent/instructions). LOPHN.md는 document·판 없이 그냥
// 파일이라 GetInstructions는 읽을 때마다 파일을 연다: 전역 `~/.lophn/LOPHN.md`(data root), project 폴더의
// LOPHN.md(첫 등록 폴더 바로 아래), 그리고 agent 정의 본문이다. 앱 층은 없다.
// 어느 project인지는 읽는 쪽이 정하지 않고 그 session의 place로 정한다(lophn만 project를 골라 읽는다).
// 읽기만 있다. 파일 저장은 사람이 editor에서 하고 agent는 만들 길이 없다.
// 이 모듈은 core가 정적으로 import하지 않는다(createReaderRegistration만 reader Worker가 부른다). 동기
// file API는 reader Worker 안에서만 쓴다(core_imports_test).
import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  INSTRUCTION_PREVIEW_MAX_BYTES,
  instructionPreview,
  instructionRead,
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

type SessionRow = {
  role: Role;
  operator: string | null;
  place: Place | null;
};

function loadSession(
  snapshot: ReadSnapshot,
  session: string,
): SessionRow | undefined {
  const found = snapshot.sql.get(
    `select role, operator, place_kind, place_id from sessions where id = ?`,
    [session],
  );
  if (found === undefined) return undefined;
  const place: Place | null =
    found["place_kind"] === null || found["place_id"] === null ? null : {
      kind: String(found["place_kind"]),
      id: String(found["place_id"]),
    } as Place;
  return {
    role: String(found["role"]) as Role,
    operator: found["operator"] === null ? null : String(found["operator"]),
    place,
  };
}

function projectFolder(snapshot: ReadSnapshot, project: string) {
  const first = snapshot.sql.get(
    "select path from project_folders where project = ? order by position limit 1",
    [project],
  );
  return first === undefined ? null : String(first["path"]);
}

// 앱 source 폴더가 들어 있는 등록 project. 여럿이면 가장 안쪽 폴더를 가진 project다.
function projectOfApp(snapshot: ReadSnapshot, app: string): string | null {
  const found = snapshot.sql.get(
    "select source_path from apps where id = ?",
    [app],
  );
  const source = found?.["source_path"];
  if (typeof source !== "string") return null;
  let best: { project: string; length: number } | null = null;
  for (
    const row of snapshot.sql.all(
      `select f.project as project, f.path as path from project_folders f
       join projects p on p.id = f.project where p.status = 'active'`,
      [],
    )
  ) {
    const folder = String(row["path"]).replace(/\/+$/, "");
    const inside = source === folder || source.startsWith(`${folder}/`);
    if (inside && (best === null || folder.length > best.length)) {
      best = { project: String(row["project"]), length: folder.length };
    }
  }
  return best === null ? null : best.project;
}

// 그 session의 agent가 prompt로 읽는 project. lophn은 place가 없어 없다. 앱 place는 앱 source가 등록 project 안에
// 있을 때만 있다.
function ownProject(snapshot: ReadSnapshot, session: SessionRow) {
  const { place } = session;
  if (place === null) return null;
  return place.kind === "project" ? place.id : projectOfApp(snapshot, place.id);
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

// 정의 파일은 lophn data 아래에 있다(agents/store.ts의 slotOf와 같은 배치).
function agentFilePath(
  root: string,
  session: SessionRow,
): string | null {
  const { place } = session;
  const folder = (kind: Place["kind"], id: string) =>
    `${root}/${kind === "project" ? "projects" : "apps"}/${id}/agents`;
  switch (session.role) {
    case "lophn":
      return `${root}/agents/lophn.md`;
    case "project_manager":
      return place?.kind === "project"
        ? `${folder("project", place.id)}/project-manager.md`
        : null;
    case "app_engineer":
      return place?.kind === "app"
        ? `${folder("app", place.id)}/app-engineer.md`
        : null;
    case "operator":
      return place === null || session.operator === null
        ? null
        : `${folder(place.kind, place.id)}/${session.operator}.md`;
  }
}

function readAgentBody(
  root: string,
  session: SessionRow,
): Result<InstructionFile | null> {
  const path = agentFilePath(root, session);
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
  snapshot: ReadSnapshot,
  sessionId: string,
  layer: InstructionLayerKind,
  requested: string | undefined,
): Result<InstructionFile | null> {
  const session = loadSession(snapshot, sessionId);
  if (session === undefined) return notFound();
  const root = dataRootOf(snapshot.sql, undefined);
  if (!root.ok) return unavailable();
  if (layer === "global") return openFile(`${root.value}/${FILE_NAME}`);
  if (layer === "agent") return readAgentBody(root.value, session);
  const own = ownProject(snapshot, session);
  if (requested !== undefined && requested !== own) {
    if (session.role !== "lophn") {
      return err({
        code: "forbidden",
        message: "only lophn reads another project's instructions",
      });
    }
    const exists = snapshot.sql.get(
      "select 1 as found from projects where id = ?",
      [
        requested,
      ],
    );
    if (exists === undefined) return notFound();
  }
  const project = requested ?? own;
  if (project === null) return ok(null);
  const folder = projectFolder(snapshot, project);
  return folder === null ? ok(null) : openFile(`${folder}/${FILE_NAME}`);
}

// GetInstructions. machine만 읽는다(route의 actors). reader Worker의 동기 handler라 core 흐름과
// ledger writer를 붙잡지 않는다. `as_of_seq`는 읽은 때의 ledger 위치다.
export function instructionsGetHandler(): ReadDefinition<
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

// ReadInstructionFile(옛 입구). turn이 도는 session의 지침을 읽는다. register.ts가 내릴 때까지만 남는다.
export function instructionReadHandler(): ReadDefinition<
  typeof instructionRead
> {
  return {
    route: instructionRead,
    handle(snapshot, _ctx, input) {
      try {
        if (input.layer === "app") return notFound();
        const found = snapshot.sql.get(
          "select session from turns where id = ?",
          [input.turn],
        );
        if (found === undefined) return notFound();
        const file = readInstruction(
          snapshot,
          String(found["session"]),
          input.layer,
          undefined,
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
// 하나뿐이다. 읽는 길은 ReadInstructionFile과 같은 reader Worker라 core 흐름과 ledger writer를 붙잡지 않는다.
export function instructionPreviewHandler(): ReadDefinition<
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

export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [
      instructionsGetHandler(),
      instructionReadHandler(),
      instructionPreviewHandler(),
    ],
    ports: new Map(),
  };
}
