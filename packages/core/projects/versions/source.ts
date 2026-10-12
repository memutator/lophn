// `document.set_source`: 문서의 프로젝트 파일 연결을 사람이 명시적으로 걸고 푼다
// (documents/versions#R13). 파일 삭제나 추적 해제만으로는 연결이 사라지지 않고, 연결을 바꾸는
// 길은 이 command뿐이다. core는 파일을 열지 않는다: 경로가 등록 폴더 안인지와 다른 문서가
// 쓰는 경로가 아닌지만 ledger에서 본다. 파일 내용과 최신 판의 대조는 다음 파일 관측이 한다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type Document,
  documentSetSource,
  documentSourceChanged,
  type FileSource,
} from "../../../protocol/projects/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  deepestRegisteredRoot,
  hardExclusion,
  loadProject,
} from "../registry/mod.ts";
import { authorizeDocument } from "./authorization.ts";
import { loadDocument, replaceDocument } from "./store.ts";

function rejected(
  code: "invalid_input" | "not_found" | "conflict" | "forbidden",
  message: string,
): Result<never> {
  return err({ code, message });
}

function sameSource(left: FileSource | null, right: FileSource | null) {
  return JSON.stringify(left) === JSON.stringify(right);
}

// 연결할 project_file의 경로가 그 프로젝트의 등록 폴더 안 일반 경로인지 ledger 값으로만 본다.
function checkLinkTarget(
  tx: Tx,
  source: Extract<FileSource, { kind: "project_file" }>,
  self: string,
): Result<void> {
  const project = loadProject(tx.sql, source.project);
  if (!project.ok) return project;
  // 범위 밖 대상은 없는 것과 같다: 없는 프로젝트와 폴더 밖 경로는 같은 invalid_input이다.
  const unavailable = () =>
    rejected("invalid_input", "file target is not available");
  if (project.value === null || project.value.status !== "active") {
    return unavailable();
  }
  const root = deepestRegisteredRoot(
    source.path,
    project.value.folders.map((folder) => ({
      project: source.project,
      path: folder.path,
    })),
  );
  if (!root.ok || root.value === null || root.value.path === source.path) {
    return unavailable();
  }
  const prefix = root.value.path.endsWith("/")
    ? root.value.path
    : `${root.value.path}/`;
  if (!source.path.startsWith(prefix)) return unavailable();
  if (hardExclusion(source.path.slice(prefix.length)) !== null) {
    return unavailable();
  }
  const taken = tx.sql.get(
    "SELECT id FROM documents WHERE source_path = ? AND id <> ?",
    [source.path, self],
  );
  return taken === undefined
    ? ok(undefined)
    : rejected("conflict", "file is already linked to a document");
}

export function createSourceCommands(): {
  setSource: CommandDefinition<typeof documentSetSource>;
} {
  return {
    setSource: {
      route: documentSetSource,
      handle(tx, ctx: RequestContext, input, compare) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return rejected("forbidden", "source changes are user only");
        }
        const current = loadDocument(tx.sql, input.document);
        if (!current.ok) return current;
        if (current.value === null) {
          return rejected("not_found", "document not found");
        }
        const document = current.value;
        const access = authorizeDocument(
          tx.port,
          ctx,
          documentSetSource.name,
          { kind: "document", document },
        );
        if (!access.ok) return access;
        if (document.revision !== compare.base_revision) {
          return rejected("conflict", "document revision changed");
        }
        const before = document.file_source;
        const source = input.file_source;
        // 지침 파일 연결은 지침 대상(전역·프로젝트)이 정하므로 이 command가 걸거나 풀지 않는다.
        if (
          before?.kind === "instruction_file" ||
          source?.kind === "instruction_file"
        ) {
          return rejected(
            "invalid_input",
            "instruction file links are not set here",
          );
        }
        if (sameSource(before, source)) {
          return rejected("invalid_input", "source does not change");
        }
        if (source !== null) {
          // 보관된 문서는 파일 관측을 받지 않는다. 연결은 되살린 뒤에 건다.
          if (document.status !== "active") {
            return rejected("conflict", "document is archived");
          }
          const target = checkLinkTarget(tx, source, document.id);
          if (!target.ok) return target;
        }
        const seq = tx.emit(documentSourceChanged, document.id, {
          before_source: before,
          source,
          before_revision: document.revision,
        });
        const next: Document = {
          ...document,
          file_source: source,
          revision: seq,
        };
        replaceDocument(tx, next);
        return ok(next);
      },
    },
  };
}
