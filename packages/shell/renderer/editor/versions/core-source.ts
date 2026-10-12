// VersionSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output
// schema로 이미 검사했다. 아래 모양은 그 schema(documents.get·history·section_history·diff·
// read, outline.document)에서 이 화면이 읽는 field만 옮긴 것이다. contracts를
// import하면 zod와 core 쪽 graph가 renderer bundle에 들어오므로 type도 들이지 않는다.
// 복원은 renderer allowlist 밖(준비·파일 쓰기)이라 main의 편집 통로로 보낸다.
import type { EditorFilesApi } from "../../../ipc/editor.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import type { CoreCall } from "../../../ipc/core.ts";
import type { EditorSource, SourceResult } from "../source.ts";
import type {
  ChangeRun,
  DocumentFacts,
  SaverKind,
  SectionChange,
  SectionEntry,
  VersionRow,
  VersionSource,
} from "./source.ts";

interface VersionValue {
  id: string;
  number: number;
  files: { path: string; primary: boolean }[] | { hash: string };
  content_hash: string;
  format: { name: string; explicit: boolean };
  saved_by: string;
  saved_at: string;
  run: string | null;
  source: { kind: string } | null;
}

interface DocumentGet {
  document: {
    id: string;
    title: string;
    status: string;
    file_source: { kind: string } | null;
    latest_version: string;
  };
  version: VersionValue;
}

interface HistoryPage {
  versions: VersionValue[];
  complete: boolean;
  next_cursor: string | null;
}

interface Range {
  start_line: number;
  end_line: number;
}

interface DiffPage {
  additions: { range: Range; text: string }[];
  deletions: { range: Range; text: string }[];
  omissions: { version: string; ranges: Range[]; reason: string }[];
  complete: boolean;
  next_cursor: string | null;
}

interface OutlinePage {
  entries: {
    key: string;
    title: string;
    level: number;
    own_ranges: Range[];
    subtree_range: Range;
    body_hash: string;
  }[];
  complete: boolean;
  next_cursor: string | null;
}

interface SectionHistoryPage {
  entries: { version: string; status: SectionChange }[];
  omissions: { version: string }[];
  complete: boolean;
  next_cursor: string | null;
}

/** page를 이어 읽는 상한. 넘으면 읽은 데까지만 쓰고 끝나지 않았다고 밝힌다. */
const PAGE_LIMIT = 200;

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  try {
    const reply = await core.call({ kind, resource, method, body });
    if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
    return { ok: true, value: reply.value as T };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

/** cursor page를 끝까지(또는 상한까지) 모은다. */
async function pages<V extends { next_cursor: string | null }>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: Record<string, unknown>,
  each: (page: V) => void,
): Promise<SourceResult<boolean>> {
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const result: SourceResult<V> = await call<V>(
      core,
      kind,
      resource,
      method,
      cursor === undefined ? body : { ...body, cursor },
    );
    if (!result.ok) return result;
    each(result.value);
    if (result.value.next_cursor === null) return { ok: true, value: true };
    cursor = result.value.next_cursor;
  }
  return { ok: true, value: false };
}

export function saverKind(actor: string): SaverKind {
  const kind = actor.split(":")[0];
  switch (kind) {
    case "user":
    case "agent":
    case "coding_agent":
    case "app":
    case "machine":
      return kind;
    default:
      return "other";
  }
}

function rowOf(value: VersionValue): VersionRow {
  return {
    id: value.id,
    number: value.number,
    savedBy: saverKind(value.saved_by),
    savedAt: Date.parse(value.saved_at),
    run: value.run ?? null,
    fromFile: value.source !== null && value.source.kind !== "app",
    contentHash: value.content_hash,
    restorable: Array.isArray(value.files),
  };
}

function span(range: Range) {
  return { start: range.start_line, end: range.end_line };
}

function run(change: { range: Range; text: string }): ChangeRun {
  return { range: span(change.range), text: change.text };
}

export function coreVersionSource(
  core: CoreSource,
  editor: EditorSource,
  files?: Pick<EditorFilesApi, "restore">,
): VersionSource {
  return {
    async facts(document) {
      const read = await call<DocumentGet>(core, "read", "documents", "get", {
        document,
      });
      if (!read.ok) return read;
      const { document: doc, version } = read.value;
      const primary = Array.isArray(version.files)
        ? version.files.find((file) => file.primary)?.path ?? null
        : null;
      const facts: DocumentFacts = {
        id: doc.id,
        title: doc.title,
        primaryPath: primary,
        linked: doc.file_source !== null,
        archived: doc.status !== "active",
        formatName: version.format.name,
        formatExplicit: version.format.explicit,
        latestVersion: doc.latest_version,
        latestNumber: version.number,
        savedAt: Date.parse(version.saved_at),
        savedBy: saverKind(version.saved_by),
      };
      return { ok: true, value: facts };
    },

    async history(document) {
      const rows: VersionRow[] = [];
      const read = await pages<HistoryPage>(
        core,
        "read",
        "documents",
        "history",
        { document },
        (page) => rows.push(...page.versions.map(rowOf)),
      );
      if (!read.ok) return read;
      rows.sort((left, right) => right.number - left.number);
      return { ok: true, value: rows };
    },

    async text(document, version) {
      const body = await editor.body(document, version, () => {});
      if (body.kind === "text" && body.complete) {
        return { ok: true, value: body.text };
      }
      return {
        ok: false,
        code: body.kind === "failed" ? "unavailable" : body.kind,
      };
    },

    async sections(document, version) {
      const found: SectionEntry[] = [];
      const read = await pages<OutlinePage>(
        core,
        "worker",
        "outline",
        "document",
        { reference: { document, version, section: null }, depth: 6 },
        (page) => {
          for (const entry of page.entries) {
            if (entry.level < 1) continue;
            found.push({
              key: entry.key,
              title: entry.title,
              level: entry.level,
              ownRanges: entry.own_ranges.map(span),
              subtree: span(entry.subtree_range),
              bodyHash: entry.body_hash,
            });
          }
        },
      );
      return read.ok ? { ok: true, value: found } : read;
    },

    async diff(document, before, after) {
      const additions: ChangeRun[] = [];
      const deletions: ChangeRun[] = [];
      const omissions: {
        version: string;
        ranges: { start: number; end: number }[];
        reason: string;
      }[] = [];
      const read = await pages<DiffPage>(
        core,
        "worker",
        "documents",
        "diff",
        { document, before, after, section: null },
        (page) => {
          additions.push(...page.additions.map(run));
          deletions.push(...page.deletions.map(run));
          omissions.push(
            ...page.omissions.map((item) => ({
              version: item.version,
              ranges: item.ranges.map(span),
              reason: item.reason,
            })),
          );
        },
      );
      if (!read.ok) return read;
      return {
        ok: true,
        value: { additions, deletions, omissions, complete: read.value },
      };
    },

    async sectionHistory(document, section) {
      const rows: { version: string; status: SectionChange }[] = [];
      const omitted: string[] = [];
      const read = await pages<SectionHistoryPage>(
        core,
        "worker",
        "documents",
        "section_history",
        { document, section },
        (page) => {
          rows.push(
            ...page.entries.map((entry) => ({
              version: entry.version,
              status: entry.status,
            })),
          );
          omitted.push(...page.omissions.map((item) => item.version));
        },
      );
      return read.ok ? { ok: true, value: { rows, omitted } } : read;
    },

    async restore(document, version, base) {
      if (!files) return { ok: false, code: "unavailable" };
      const reply = await files.restore({
        document,
        version,
        base_version: base,
        request_key: `restore-${crypto.randomUUID()}`,
      });
      return reply.ok ? reply : { ok: false, code: reply.code };
    },
  };
}
