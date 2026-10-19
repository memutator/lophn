// annotation 표 읽기. command와 read와 lookup이 같이 쓴다.
import type {
  AnnotationBatch,
  AnnotationRead,
  AnnotationTarget,
} from "../../../protocol/apps/annotation.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { objectPathFor } from "../../storage/blobs/mod.ts";

type Query = Pick<Sql, "get" | "all">;

const json = <T>(value: unknown): T => JSON.parse(String(value)) as T;

// ledger 파일이 있는 폴더가 data root다. blob store가 그 아래에 있다.
function dataRootOf(sql: Query): string | null {
  const file = sql.get(
    "SELECT file FROM pragma_database_list WHERE name = 'main'",
    [],
  )?.["file"];
  return typeof file === "string" && file.includes("/")
    ? file.slice(0, file.lastIndexOf("/"))
    : null;
}

// 묶음 행에서 target을 읽는다. 표의 CHECK가 칸 조합을 지킨다.
function targetOf(row: Record<string, unknown>): AnnotationTarget {
  return row["target_kind"] === "app"
    ? { kind: "app", app: String(row["app"]) as never }
    : {
      kind: "artifact",
      project: String(row["project"]) as never,
      name: row["artifact"] === null ? null : String(row["artifact"]),
    };
}

function readOf(row: Record<string, unknown>, root: string | null) {
  const hash = row["screenshot_hash"];
  return {
    id: String(row["id"]),
    batch: String(row["batch"]),
    target: targetOf(row),
    n: Number(row["n"]),
    kind: String(row["kind"]),
    note: String(row["note"]),
    screenshot: hash === null
      ? null
      : { hash: String(hash), size_bytes: Number(row["screenshot_size"]) },
    component: row["component"] === null ? null : String(row["component"]),
    element: json(row["element"]),
    rect: json(row["rect"]),
    view: json(row["view"]),
    release: row["release"] === null ? null : String(row["release"]),
    screenshot_path: hash === null || root === null
      ? null
      : objectPathFor(root, String(hash)),
  } as AnnotationRead;
}

// ids 순서대로 읽는다. 지워졌거나 없는 id는 건너뛴다.
export function loadAnnotations(
  sql: Query,
  ids: readonly string[],
): AnnotationRead[] {
  const root = dataRootOf(sql);
  return ids.flatMap((id) => {
    const row = sql.get(
      `SELECT a.*, b.target_kind, b.app, b.project, b.artifact
       FROM annotations a JOIN annotation_batches b ON b.id = a.batch
       WHERE a.id = ?`,
      [id],
    );
    return row === undefined ? [] : [readOf(row, root)];
  });
}

export function loadBatch(
  sql: Query,
  id: string,
): { batch: AnnotationBatch; annotations: AnnotationRead[] } | null {
  const row = sql.get("SELECT * FROM annotation_batches WHERE id = ?", [id]);
  if (row === undefined) return null;
  const ids = sql.all("SELECT id FROM annotations WHERE batch = ? ORDER BY n", [
    id,
  ]).map((item) => String(item["id"]));
  return {
    batch: {
      id,
      target: targetOf(row),
      sent_at: String(row["sent_at"]),
      sent_by: String(row["sent_by"]),
      annotations: ids,
    } as AnnotationBatch,
    annotations: loadAnnotations(sql, ids),
  };
}

// blob 참조의 registered_seq. 이 기록은 event를 남기지 않으므로 지금까지의 마지막 seq를 쓴다.
export function headSeq(sql: Query): string {
  const row = sql.get("SELECT COALESCE(MAX(seq), 0) AS head FROM events", []);
  return String(row?.["head"] ?? 0);
}
