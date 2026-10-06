// ContextsSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output
// schema로 이미 검사했다. 아래 모양은 그 schema(context.list·get·watch·export, outline.context,
// term.list·define, documents.get)에서 이 화면이 읽는 field만 옮긴 것이다.
import type { CoreSource } from "../../connection/connection.ts";
import { newId } from "../model.ts";
import type {
  ContextsSource,
  Focus,
  FocusItem,
  FocusRow,
  FocusTarget,
  Meaning,
  MeaningEvidence,
  Perspective,
  SectionStatus,
  SourceResult,
} from "./source.ts";
import { EVIDENCE_LIMIT } from "./model.ts";

interface ContextValue {
  id: string;
  title: string;
  purpose: string;
  items: unknown[];
  revision: string;
  status: "active" | "archived";
}

interface OutlineEntry {
  kind: "document" | "app_command";
  perspective: Perspective;
  reason: string;
  title: string;
  readable: boolean;
  target: FocusTarget;
  version?: string | null;
  section_status?: SectionStatus;
}

interface OutlinePage {
  entries: OutlineEntry[];
  complete: boolean;
  next_cursor: string | null;
}

interface TermValue {
  id: string;
  name: string;
  definition: string | null;
  evidence: {
    document: string;
    version: string;
    section: string | null;
    start_line: number | null;
    end_line: number | null;
  }[];
  revision: string;
}

interface TermPage {
  definitions: TermValue[];
  candidates: TermValue[];
  complete: boolean;
  next_cursor: string | null;
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보이고 부분이라고 알린다. */
const PAGE_LIMIT = 20;

async function call<T>(
  core: CoreSource,
  kind: "read" | "command" | "worker",
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  const reply = await core.call({ kind, resource, method, body });
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
  return { ok: true, value: reply.value as T };
}

async function command<T>(
  core: CoreSource,
  resource: string,
  method: string,
  input: unknown,
  compare: unknown,
): Promise<SourceResult<T>> {
  return await call<T>(core, "command", resource, method, {
    input,
    idempotency_key: `${resource}-${method}-${crypto.randomUUID()}`,
    compare,
    prepared: [],
  });
}

function rowOf(value: ContextValue): FocusRow {
  return {
    id: value.id,
    title: value.title,
    purpose: value.purpose,
    items: value.items.length,
    archived: value.status === "archived",
    revision: value.revision,
  };
}

function itemOf(entry: OutlineEntry): FocusItem {
  return {
    perspective: entry.perspective,
    target: entry.target,
    reason: entry.reason,
    title: entry.title,
    readable: entry.readable,
    version: entry.kind === "document" ? entry.version ?? null : null,
    sectionStatus: entry.kind === "document"
      ? entry.section_status ?? null
      : null,
  };
}

function meaningOf(
  value: TermValue,
  titles: ReadonlyMap<string, string | null>,
): Meaning {
  return {
    id: value.id,
    name: value.name,
    definition: value.definition,
    evidence: value.evidence.map((item): MeaningEvidence => ({
      document: item.document,
      title: titles.get(item.document) ?? null,
      version: item.version,
      section: item.section,
      startLine: item.start_line,
      endLine: item.end_line,
    })),
    revision: value.revision,
  };
}

export function coreContextsSource(
  core: CoreSource,
  idOf: (prefix: string) => string = (prefix) => newId(prefix),
): ContextsSource {
  // 근거 문서 제목. 화면이 보이는 근거(뜻마다 최대 5개)의 문서만 읽는다.
  const titleOf = async (
    document: string,
    version: string,
  ): Promise<string | null> => {
    const result = await call<{ document: { title: string } }>(
      core,
      "read",
      "documents",
      "get",
      { document, version },
    );
    return result.ok ? result.value.document.title : null;
  };

  return {
    async list(status) {
      const rows: FocusRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result = await call<
          { contexts: ContextValue[]; next_cursor: string | null }
        >(core, "read", "contexts", "list", {
          status,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!result.ok) return result;
        rows.push(...result.value.contexts.map(rowOf));
        if (result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      return { ok: true, value: rows };
    },

    async focus(id) {
      const got = await call<{ context: ContextValue }>(
        core,
        "read",
        "contexts",
        "get",
        { context: id },
      );
      if (!got.ok) return got;
      const items: FocusItem[] = [];
      let cursor: string | undefined;
      let complete = false;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result: SourceResult<OutlinePage> = await call<OutlinePage>(
          core,
          "worker",
          "outline",
          "context",
          { context: id, ...(cursor === undefined ? {} : { cursor }) },
        );
        if (!result.ok) return result;
        items.push(...result.value.entries.map(itemOf));
        if (result.value.complete || result.value.next_cursor === null) {
          complete = true;
          break;
        }
        cursor = result.value.next_cursor;
      }
      const context = got.value.context;
      const focus: Focus = {
        ...rowOf(context),
        items,
        partial: !complete,
      };
      return { ok: true, value: focus };
    },

    async watch(id) {
      const result = await call<{
        changes: {
          target: { document: string; section: string | null };
          change_kind: "content_changed" | "section_added" | "section_missing";
          before_version: string | null;
          after_version: string;
        }[];
        unverified: {
          target: { document: string; section: string | null };
          before_version: string | null;
          after_version: string;
          reason: string;
        }[];
      }>(core, "read", "contexts", "watch", { context: id });
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          changes: result.value.changes.map((change) => ({
            target: {
              kind: "document",
              document: change.target.document,
              section: change.target.section,
            },
            kind: change.change_kind,
            beforeVersion: change.before_version,
            afterVersion: change.after_version,
          })),
          unverified: result.value.unverified.map((row) => ({
            target: {
              kind: "document",
              document: row.target.document,
              section: row.target.section,
            },
            beforeVersion: row.before_version,
            afterVersion: row.after_version,
            reason: row.reason,
          })),
        },
      };
    },

    async setArchived(focus, archived) {
      const result = await command<{ revision: string }>(
        core,
        "contexts",
        archived ? "archive" : "unarchive",
        { context: focus.id },
        { base_revision: focus.revision },
      );
      return result.ok
        ? { ok: true, value: { revision: result.value.revision } }
        : result;
    },

    async meanings(focus) {
      const definitions: TermValue[] = [];
      const candidates: TermValue[] = [];
      let cursor: string | undefined;
      let complete = false;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result: SourceResult<TermPage> = await call<TermPage>(
          core,
          "read",
          "terms",
          "list",
          { context: focus, ...(cursor === undefined ? {} : { cursor }) },
        );
        if (!result.ok) return result;
        definitions.push(...result.value.definitions);
        candidates.push(...result.value.candidates);
        if (result.value.complete || result.value.next_cursor === null) {
          complete = true;
          break;
        }
        cursor = result.value.next_cursor;
      }
      const wanted = new Map<string, string>();
      for (const term of [...definitions, ...candidates]) {
        for (const item of term.evidence.slice(0, EVIDENCE_LIMIT)) {
          if (!wanted.has(item.document)) {
            wanted.set(item.document, item.version);
          }
        }
      }
      const titles = new Map<string, string | null>();
      await Promise.all(
        [...wanted].map(async ([document, version]) => {
          titles.set(document, await titleOf(document, version));
        }),
      );
      return {
        ok: true,
        value: {
          definitions: definitions.map((term) => meaningOf(term, titles)),
          candidates: candidates.map((term) => meaningOf(term, titles)),
          partial: !complete,
        },
      };
    },

    async define(input) {
      const result = input.term === undefined
        ? await command<TermValue>(
          core,
          "terms",
          "define",
          {
            id: idOf("trm"),
            context: input.focus,
            name: input.name,
            definition: input.definition,
          },
          {},
        )
        : await command<TermValue>(
          core,
          "terms",
          "define",
          {
            term: input.term.id,
            name: input.name,
            definition: input.definition,
          },
          { base_revision: input.term.revision },
        );
      if (!result.ok) return result;
      const titles = new Map(
        (input.term?.evidence ?? []).map((item) => [item.document, item.title]),
      );
      return { ok: true, value: meaningOf(result.value, titles) };
    },

    async exportFocus(id) {
      const result = await call<{
        context: { title: string; purpose: string };
        items: {
          perspective: Perspective;
          reason: string;
          target: FocusTarget;
          fixed_version: string | null;
          section_status: SectionStatus | null;
        }[];
        glossary: { name: string; definition: string }[];
      }>(core, "read", "contexts", "export", { context: id });
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          title: result.value.context.title,
          purpose: result.value.context.purpose,
          items: result.value.items.map((item) => ({
            perspective: item.perspective,
            target: item.target,
            reason: item.reason,
            fixedVersion: item.fixed_version,
            sectionStatus: item.section_status,
          })),
          glossary: result.value.glossary,
        },
      };
    },
  };
}
