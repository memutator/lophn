// annotation 표 읽기. command와 read와 lookup이 같이 쓴다.
import type {
  AnnotationBatch,
  AnnotationRead,
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

function readOf(row: Record<string, unknown>, root: string | null) {
  const hash = row["screenshot_hash"];
  return {
    id: String(row["id"]),
    batch: String(row["batch"]),
    app: String(row["app"]),
    n: Number(row["n"]),
    kind: String(row["kind"]),
    note: String(row["note"]),
    screenshot: hash === null
      ? null
      : { hash: String(hash), size_bytes: Number(row["screenshot_size"]) },
    component: row["component"] === null ? null : String(row["component"]),
    source: row["source_file"] === null ? null : {
      file: String(row["source_file"]),
      line: Number(row["source_line"]),
    },
    element: json(row["element"]),
    rect: json(row["rect"]),
    view: json(row["view"]),
    release: String(row["release"]),
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
    const row = sql.get("SELECT * FROM annotations WHERE id = ?", [id]);
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
      app: String(row["app"]),
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
