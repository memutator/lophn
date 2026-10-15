// 사람 지침(LOPHN.md) 읽기 통로의 core 쪽 길(lophn-agent/instructions). LOPHN.md는 document·판 없이 그냥
// 파일이라 ReadInstructionFile은 읽을 때마다 파일을 연다: 전역 `~/.lophn/LOPHN.md`(data root), project 폴더의
// LOPHN.md(첫 등록 폴더 바로 아래), 앱 자리 `<data root>/apps/<앱>/LOPHN.md`, 그리고 agent 정의 본문이다.
// 어느 자리인지는 읽는 쪽이 정하지 않고 그 turn의 작업 자리로 정한다. 읽기만 있다. 파일 저장은 사람이
// editor에서 하고 agent는 만들 길이 없다.
// 이 모듈은 core가 정적으로 import하지 않는다(createReaderRegistration만 reader Worker가 부른다). 동기
// file API는 reader Worker 안에서만 쓴다(core_imports_test).
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentRole,
  INSTRUCTION_PREVIEW_MAX_BYTES,
  instructionPreview,
  instructionRead,
  type WorkPlace,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
} from "../../../protocol/server/mod.ts";
import type { ReaderRegistration } from "../../storage/ledger/mod.ts";
import {
  agentFileName,
  createAgentStore,
  parseAgentFile,
} from "../agents/mod.ts";
import { dataRootOf } from "../agents/store.ts";
import { createNodeAgentFiles } from "../agents/adapters/node-fs.ts";
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

type TurnPlace = {
  role: AgentRole;
  // Operator의 정의 파일 이름이 된다. 다른 역할은 null이다.
  operator: string | null;
  place: WorkPlace | null;
};

// turn의 작업 자리. turn이 도는 session의 agent와 place가 정한다. 전역(lophn) session은 자리가 없다.
function placeOf(snapshot: ReadSnapshot, turn: string): Result<TurnPlace> {
  const found = snapshot.sql.get(
    `select s.role as role, s.operator as operator, s.place_kind as place_kind,
       s.place_id as place_id
     from turns t join sessions s on s.id = t.session where t.id = ?`,
    [turn],
  );
  if (found === undefined) return notFound();
  const place: WorkPlace | null =
    found["place_kind"] === null || found["place_id"] === null ? null : {
      kind: String(found["place_kind"]),
      id: String(found["place_id"]),
    } as WorkPlace;
  return ok({
    role: String(found["role"]) as AgentRole,
    operator: found["operator"] === null ? null : String(found["operator"]),
    place,
  });
}

function projectFolder(snapshot: ReadSnapshot, project: string) {
  const first = snapshot.sql.get(
    "select path from project_folders where project = ? order by position limit 1",
    [project],
  );
  return first === undefined ? null : String(first["path"]);
}

function readLayer(
  snapshot: ReadSnapshot,
  turn: TurnPlace,
  layer: InstructionLayerKind,
): Result<InstructionFile | null> {
  const root = dataRootOf(snapshot.sql, undefined);
  if (!root.ok) return unavailable();
  if (layer === "global") return openFile(`${root.value}/${FILE_NAME}`);
  const { place } = turn;
  if (layer === "project") {
    if (place?.kind !== "project") return notFound();
    const folder = projectFolder(snapshot, place.id);
    return folder === null ? ok(null) : openFile(`${folder}/${FILE_NAME}`);
  }
  if (layer === "app") {
    if (place?.kind !== "app") return notFound();
    return openFile(`${root.value}/apps/${place.id}/${FILE_NAME}`);
  }
  // agent 층: 그 turn의 정의 파일 본문. 정의 파일의 frontmatter는 지침이 아니다.
  if (place === null) return ok(null);
  const store = createAgentStore(createNodeAgentFiles(), root.value);
  const loaded = store.read(
    place,
    agentFileName(turn.role, turn.operator ?? ""),
  );
  if (!loaded.ok) return unavailable();
  if (loaded.value === null) return ok(null);
  const parsed = parseAgentFile(loaded.value.text, {
    role: turn.role,
    place: place.kind,
  });
  if (!parsed.ok) return unavailable();
  const bytes = new TextEncoder().encode(parsed.value.body);
  return ok({
    size_bytes: bytes.length,
    bytes: bytes.subarray(0, INSTRUCTION_FILE_MAX_BYTES),
  });
}

// ReadInstructionFile. machine만 읽는다(route의 actors). reader Worker의 동기 handler라 core 흐름과
// ledger writer를 붙잡지 않는다. `as_of_seq`는 읽은 때의 ledger 위치다.
export function instructionReadHandler(): ReadDefinition<
  typeof instructionRead
> {
  return {
    route: instructionRead,
    handle(snapshot, _ctx, input) {
      try {
        const turn = placeOf(snapshot, input.turn);
        if (!turn.ok) return turn;
        const file = readLayer(snapshot, turn.value, input.layer);
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
    reads: [instructionReadHandler(), instructionPreviewHandler()],
    ports: new Map(),
  };
}
