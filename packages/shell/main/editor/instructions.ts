// [Instructions]: 지침 파일(LOPHN.md)을 같은 편집기로 연다(shell/editor#R17, flow edit-instructions).
// 전역은 data root의 LOPHN.md 한 파일, project는 그 project의 첫 등록 폴더 바로 아래 LOPHN.md 한
// 파일이다. main이 이 exact 파일만 resolve하고 renderer에는 연결된 문서 id만 준다(경로·instruction
// target 이름은 넘기지 않는다). 파일이 없으면 문서도 없어 renderer가 빈 초안을 보이고, 사람의 첫
// 저장이 미존재 CAS(base_hash null)로 파일을 만든다. 만든 파일은 documents가 바로 다시 관측해
// 첫 판이 되므로 연결 문서가 생길 때까지 짧게 기다린다. 그 뒤의 고침·충돌·비교·복원은 일반 문서와
// 같은 파일 adapter가 한다. 지침 문서의 쓰기는 사람 자격뿐이라(documents/versions#R20) agent의
// 제안은 이 통로로 저장되지 않는다. app 층은 documents에 등록 파일이 없어(앱 자리 경로를 내놓는
// contract가 아직 없다) 없는 대상과 같게 답한다.
import type { EditorReply } from "../../ipc/editor.ts";
import type {
  InstructionsCreated,
  InstructionsOpened,
  InstructionsPlace,
} from "../../ipc/instructions.ts";
import {
  type FileOperationResult,
  type FileTarget,
  type PortError,
  type PortResult,
  type PreparedBlob,
  sha256,
  type WriteRequest,
} from "./file-adapter.ts";

// shell tsc는 contracts를 보지 않는다. contract output에서 이 통로가 읽는 field만 옮긴다.

/** 원본 연결 문서 하나. */
export interface PlacelessDocument {
  id: string;
  latest_version: string;
  file_source: { kind: string; instruction_target?: string } | null;
}

export interface InstructionsPort {
  /** `projects.get`에서 지침 자리가 읽는 것. */
  project(id: string): Promise<
    PortResult<{ status: string; folders: readonly { path: string }[] }>
  >;
  /** 자리가 없는 문서(지침 문서는 place·name이 null이다)를 원본 정보와 함께 읽는다. */
  placeless(): Promise<PortResult<readonly PlacelessDocument[]>>;
  upload(bytes: Uint8Array, hash: string): Promise<PortResult<PreparedBlob>>;
  write(request: WriteRequest): Promise<PortResult<FileOperationResult>>;
}

export interface InstructionsOptions {
  /** 연결된 core가 없으면 null이다. 그때 열기·저장은 offline이다. */
  port: () => InstructionsPort | null;
  /** 이 shell이 core에 준 data root. 전역 지침 파일이 그 바로 아래에 있다. */
  dataRoot: string;
  hash?: (bytes: Uint8Array) => string;
  /** 첫 판이 연결 문서로 보일 때까지 기다리는 횟수와 간격. */
  waits?: number;
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Instructions {
  open(input: { target: InstructionsPlace }): Promise<
    EditorReply<InstructionsOpened>
  >;
  create(
    input: {
      target: InstructionsPlace;
      request_key: string;
      bytes: Uint8Array;
    },
  ): Promise<EditorReply<InstructionsCreated>>;
}

export const INSTRUCTION_FILE_NAME = "LOPHN.md";

type Resolved = {
  target: Extract<FileTarget, { kind: "instruction_file" }>;
  document: { id: string; version: string } | null;
};

function join(directory: string, name: string): string {
  return `${directory === "/" ? "" : directory}/${name}`;
}

function report(
  outcome: InstructionsCreated["outcome"],
  over: Partial<InstructionsCreated> = {},
): InstructionsCreated {
  return { outcome, version: null, failure: null, document: null, ...over };
}

function failedWith(error: PortError): InstructionsCreated {
  if (error.code === "conflict") return report("conflict");
  return report("failed", {
    failure: error.code === "unauthorized" ? "forbidden" : error.code,
  });
}

/** 응답이 오지 않은 실패. 쓰기가 일어났는지 모른다. */
function transportLost(error: PortError): boolean {
  return error.code === "unavailable" &&
    error.details?.["reason"] === "transport_failed";
}

export function createInstructions(options: InstructionsOptions): Instructions {
  const hash = options.hash ?? sha256;
  const waits = options.waits ?? 20;
  const waitMs = options.waitMs ?? 500;
  const sleep = options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  // exact 등록 대상과 거기에 이미 연결된 문서. 범위 밖 층·없는 project는 같은 not_found다.
  async function resolve(
    port: InstructionsPort,
    place: InstructionsPlace,
  ): Promise<EditorReply<Resolved>> {
    let target: Resolved["target"];
    if (place.layer === "global") {
      target = {
        kind: "instruction_file",
        instruction_target: "global",
        project: null,
        path: join(options.dataRoot, INSTRUCTION_FILE_NAME),
      };
    } else if (place.layer === "project") {
      const project = await port.project(place.place);
      if (!project.ok) {
        return {
          ok: false,
          code: project.error.code === "unavailable"
            ? "unavailable"
            : "not_found",
        };
      }
      const folder = project.value.folders[0];
      if (project.value.status !== "active" || folder === undefined) {
        return { ok: false, code: "not_found" };
      }
      target = {
        kind: "instruction_file",
        instruction_target: `project:${place.place}`,
        project: place.place,
        path: join(folder.path, INSTRUCTION_FILE_NAME),
      };
    } else {
      return { ok: false, code: "not_found" };
    }
    const documents = await port.placeless();
    if (!documents.ok) return { ok: false, code: "unavailable" };
    const found = documents.value.find((document) =>
      document.file_source?.kind === "instruction_file" &&
      document.file_source.instruction_target === target.instruction_target
    );
    return {
      ok: true,
      value: {
        target,
        document: found === undefined
          ? null
          : { id: found.id, version: found.latest_version },
      },
    };
  }

  return {
    async open(input) {
      const port = options.port();
      if (port === null) return { ok: false, code: "offline" };
      const resolved = await resolve(port, input.target);
      if (!resolved.ok) return resolved;
      return {
        ok: true,
        value: {
          document: resolved.value.document?.id ?? null,
          version: resolved.value.document?.version ?? null,
        },
      };
    },

    async create(input) {
      const port = options.port();
      if (port === null) {
        return { ok: true, value: report("failed", { failure: "offline" }) };
      }
      const resolved = await resolve(port, input.target);
      if (!resolved.ok) return resolved;
      // 이미 연결된 문서가 있으면 첫 저장이 아니다. 그 문서를 일반 편집으로 고친다.
      if (resolved.value.document !== null) {
        return {
          ok: true,
          value: report("conflict", { document: resolved.value.document.id }),
        };
      }
      const written = hash(input.bytes);
      const blob = await port.upload(input.bytes, written);
      if (!blob.ok) return { ok: true, value: failedWith(blob.error) };
      const wrote = await port.write({
        request_key: input.request_key,
        target: resolved.value.target,
        base_hash: null,
        content: { kind: "prepared", blob: blob.value },
      });
      if (!wrote.ok) {
        return {
          ok: true,
          value: transportLost(wrote.error)
            ? report("unknown", { failure: "unknown" })
            : failedWith(wrote.error),
        };
      }
      if (wrote.value.outcome !== "written") {
        return { ok: true, value: report("unknown", { failure: "unknown" }) };
      }
      // 파일은 썼다. documents가 그 파일을 다시 관측해 첫 판을 만들 때까지 연결 문서를 기다린다.
      for (let attempt = 0; attempt < waits; attempt += 1) {
        const again = await resolve(port, input.target);
        if (again.ok && again.value.document !== null) {
          return {
            ok: true,
            value: report("saved", {
              version: again.value.document.version,
              document: again.value.document.id,
            }),
          };
        }
        await sleep(waitMs);
      }
      return { ok: true, value: report("pending") };
    },
  };
}
