// contexts 화면 테스트의 ContextsSource. 부른 순서와 입력을 남기고 미리 정한 값을 돌려준다.
import type {
  ContextsSource,
  Focus,
  FocusExport,
  FocusRow,
  FocusWatch,
  Meaning,
  Meanings,
  SourceResult,
} from "../source.ts";

export interface Call {
  readonly method: keyof ContextsSource;
  readonly args: readonly unknown[];
}

export const DOC = "doc_1";

export const FOCUS: Focus = {
  id: "ctx_1",
  title: "Grocery budget",
  purpose: "Keep the monthly food spending under the plan.",
  revision: "7",
  archived: false,
  partial: false,
  items: [
    {
      perspective: "basis",
      target: { kind: "document", document: DOC, section: null },
      reason: "The plan we agreed on.",
      title: "Budget plan",
      readable: true,
      version: "ver_2",
      sectionStatus: "whole",
    },
    {
      perspective: "basis",
      target: { kind: "document", document: "doc_2", section: "limits" },
      reason: "Where the monthly limit is written.",
      title: "House rules",
      readable: false,
      version: "ver_5",
      sectionStatus: "missing",
    },
    {
      perspective: "watch",
      target: { kind: "document", document: "doc_3", section: null },
      reason: "Prices change every week.",
      title: "Price list",
      readable: true,
      version: "ver_9",
      sectionStatus: "whole",
    },
    {
      perspective: "watch",
      target: { kind: "document", document: "doc_4", section: "totals" },
      reason: "The totals we compare against.",
      title: "Receipts",
      readable: false,
      version: "ver_12",
      sectionStatus: "missing",
    },
    {
      perspective: "watch",
      target: { kind: "document", document: "doc_5", section: "notes" },
      reason: "Notes from the shop.",
      title: "Shop notes",
      readable: true,
      version: "ver_21",
      sectionStatus: "found",
    },
    {
      perspective: "watch",
      target: { kind: "app_command", app: "app_1", command: "list_items" },
      reason: "What is in the pantry.",
      title: "Pantry/list_items",
      readable: true,
      version: null,
      sectionStatus: null,
    },
  ],
};

export const WATCH: FocusWatch = {
  changes: [
    {
      target: { kind: "document", document: "doc_4", section: "totals" },
      kind: "section_missing",
      beforeVersion: "ver_11",
      afterVersion: "ver_12",
    },
    {
      target: { kind: "document", document: "doc_3", section: null },
      kind: "content_changed",
      beforeVersion: "ver_8",
      afterVersion: "ver_9",
    },
  ],
  unverified: [{
    target: { kind: "document", document: "doc_5", section: "notes" },
    beforeVersion: "ver_20",
    afterVersion: "ver_21",
    reason: "format module changed",
  }],
};

function evidence(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    document: `doc_${index + 1}`,
    title: index === 0 ? "Budget plan" : null,
    version: `ver_${index + 1}`,
    section: index === 0 ? "food" : null,
    startLine: index === 1 ? 3 : null,
    endLine: index === 1 ? 4 : null,
  }));
}

export const CANDIDATE: Meaning = {
  id: "trm_2",
  name: "staples",
  definition: null,
  evidence: evidence(6),
  revision: "4",
};

export const MEANINGS: Meanings = {
  definitions: [{
    id: "trm_1",
    name: "eating out",
    definition: "Any meal we pay someone else to cook.",
    evidence: evidence(1),
    revision: "3",
  }],
  candidates: [CANDIDATE],
  partial: false,
};

export const EXPORTED: FocusExport = {
  title: FOCUS.title,
  purpose: FOCUS.purpose,
  items: [
    {
      perspective: "basis",
      target: { kind: "document", document: DOC, section: null },
      reason: "The plan we agreed on.",
      fixedVersion: "ver_2",
      sectionStatus: "whole",
    },
    {
      perspective: "watch",
      target: { kind: "app_command", app: "app_1", command: "list_items" },
      reason: "What is in the pantry.",
      fixedVersion: null,
      sectionStatus: null,
    },
  ],
  glossary: [{
    name: "eating out",
    definition: "Any meal we pay someone else to cook.",
  }],
};

export interface FakeData {
  rows?: readonly FocusRow[];
  focus?: SourceResult<Focus>;
  watch?: SourceResult<FocusWatch>;
  meanings?: SourceResult<Meanings>;
  define?: SourceResult<Meaning>;
  archived?: SourceResult<{ revision: string }>;
  exported?: SourceResult<FocusExport>;
}

function ok<T>(value: T): SourceResult<T> {
  return { ok: true, value };
}

export function fakeContexts(data: FakeData = {}): {
  source: ContextsSource;
  of: (method: keyof ContextsSource) => Call[];
} {
  const calls: Call[] = [];
  const log = <T>(method: keyof ContextsSource, args: unknown[], value: T) => {
    calls.push({ method, args });
    return Promise.resolve(value);
  };
  const row: FocusRow = {
    id: FOCUS.id,
    title: FOCUS.title,
    purpose: FOCUS.purpose,
    items: FOCUS.items.length,
    archived: false,
    revision: FOCUS.revision,
  };
  const source: ContextsSource = {
    list: (status) => log("list", [status], ok(data.rows ?? [row])),
    focus: (id) => log("focus", [id], data.focus ?? ok(FOCUS)),
    watch: (id) => log("watch", [id], data.watch ?? ok(WATCH)),
    setArchived: (focus, archived) =>
      log(
        "setArchived",
        [focus, archived],
        data.archived ?? ok({ revision: "8" }),
      ),
    meanings: (focus) =>
      log("meanings", [focus], data.meanings ?? ok(MEANINGS)),
    define: (input) =>
      log(
        "define",
        [input],
        data.define ?? ok({
          id: input.term?.id ?? "trm_9",
          name: input.name,
          definition: input.definition,
          evidence: input.term?.evidence ?? [],
          revision: "10",
        }),
      ),
    exportFocus: (id) =>
      log("exportFocus", [id], data.exported ?? ok(EXPORTED)),
  };
  return {
    source,
    of: (method) => calls.filter((call) => call.method === method),
  };
}
