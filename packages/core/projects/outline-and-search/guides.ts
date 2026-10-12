// 설치 사용 안내 읽기 handler(`/v1/guides/list·get·outline·read`, documents/versions
// #R17). 안내는 사용자 Document가 아니라서 ledger 표·derived store를 읽지 않는다.
// 설치 manifest(port)가 안내와 파일 bytes를 주고, 추출 결과(section)는 extractor port가
// 요청마다 같은 format 추출 규약으로 낸다. 목차 자르기·본문 조각·cursor·redaction은
// 문서 outline·읽기와 같은 코드(outline-support)다. 이 모듈은 ledger에 아무것도 쓰지 않고
// 사용자 Document·place·tracking을 만들지 않는다. 설치 판 밖 참조는 없는 것과 같다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  BundledGuide,
  ContentFile,
  FormatRef,
  GuideReference,
} from "../../../protocol/projects/mod.ts";
import {
  DOCUMENT_OUTLINE_DEPTH,
  READ_CODEPOINT_BUDGET,
} from "../../../protocol/projects/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import {
  decodeOutlineCursor,
  encodeOutlineCursor,
  estimatedTokens,
  lineCount,
} from "./model.ts";
import {
  cutOutline,
  readTextWindow,
  sectionStatusOf,
  selectBodyLines,
} from "./outline-support.ts";

const DOCUMENT_BUDGET = 2000;
// 한 page에 담는 안내 수. 안내 목록 한 장은 작지만 JSON 상한을 넘지 않게 자른다.
export const GUIDE_LIST_LIMIT = 30;

type LineRange = { start_line: number; end_line: number };

// 설치 manifest의 읽기 전용 port. documents/versions의 createGuideCatalog가 구현한다.
export type GuideCatalogPort = {
  installed(): Result<{
    lophn_version: string;
    guides: BundledGuide[];
    basis: string;
  }>;
  file(
    guide: BundledGuide,
    path: string,
  ): Result<{ file: ContentFile; bytes: Uint8Array }>;
};

export type GuideSectionRecord = {
  key: string;
  title: string;
  parent: string | null;
  position: number;
  level: number;
  anchor: string | null;
  own_ranges: LineRange[];
  subtree_range: LineRange;
  characters: number;
  body_hash: string;
};

// format 추출 결과. 제품 조립이 format 정본의 추출을 부른다(runner를 거치지 않는 같은
// 규약의 직접 추출이다: 설치 안내는 신뢰한 설치 bytes다).
export type GuideExtraction = {
  format: FormatRef;
  extraction:
    | {
      status: "ready";
      text: string;
      text_hash: string;
      sections: GuideSectionRecord[];
    }
    | { status: "unsupported" }
    | { status: "failed"; failure_reason: string };
};

export type GuideExtractor = (
  file: { path: string; media_type: string; bytes: Uint8Array },
  contentHash: string,
) => GuideExtraction;

export type GuideRedactor = (
  source: { concern: string; revision: string; scope: string },
  mediaType: string,
  text: string,
) => string | null;

export type GuideHandlerDeps = {
  catalog: GuideCatalogPort;
  extract: GuideExtractor;
  // 읽은 ledger snapshot의 seq. 안내 자체는 ledger 기준이 아니라 읽기 공통 필드로만 싣는다.
  asOfSeq: string;
  redactor?: GuideRedactor;
};

export type GuideInstalledFile = ContentFile & {
  reference: GuideReference;
};

export type GuideOutlineEntry = GuideSectionRecord & {
  estimated_tokens: number;
  children_count: number;
  hidden_children_count: number;
};

export type GuideListInput = { cursor?: string };
export type GuideGetInput = { reference: GuideReference };
export type GuideOutlineInput = {
  reference: GuideReference;
  path: string;
  depth?: number;
  estimated_token_budget?: number;
  cursor?: string;
};
export type GuideReadInput = {
  reference: GuideReference;
  path: string;
  section?: string | null;
  include_children?: boolean;
  ranges?: LineRange[];
  max_codepoints?: number;
  cursor?: string;
};

export type GuideHandlers = {
  list(ctx: RequestContext, input: GuideListInput): Result<unknown>;
  get(ctx: RequestContext, input: GuideGetInput): Result<unknown>;
  outline(ctx: RequestContext, input: GuideOutlineInput): Result<unknown>;
  read(ctx: RequestContext, input: GuideReadInput): Result<unknown>;
};

function notFound(): Result<never> {
  return err({ code: "not_found", message: "guide does not resolve" });
}

function referenceOf(guide: BundledGuide): GuideReference {
  return {
    lophn_version: guide.lophn_version,
    title: guide.title,
    content_hash: guide.content_hash,
  };
}

// 참조는 현재 설치 manifest의 안내와 정확히 같아야 한다. 다른 설치 판·없는 제목·다른
// hash는 같은 not_found다.
function resolve(
  deps: GuideHandlerDeps,
  reference: GuideReference,
): Result<{ guide: BundledGuide; basis: string }> {
  const installed = deps.catalog.installed();
  if (!installed.ok) return installed;
  const guide = installed.value.guides.find((item) =>
    item.lophn_version === reference.lophn_version &&
    item.title === reference.title &&
    item.content_hash === reference.content_hash
  );
  if (guide === undefined) return notFound();
  return ok({ guide, basis: installed.value.basis });
}

type Resolved = {
  guide: BundledGuide;
  basis: string;
  file: ContentFile;
  bytes: Uint8Array;
  extracted: GuideExtraction;
};

// 안내의 한 파일을 실제 bytes와 대조해 읽고 section을 추출한다.
function load(
  deps: GuideHandlerDeps,
  reference: GuideReference,
  path: string,
): Result<Resolved> {
  const resolved = resolve(deps, reference);
  if (!resolved.ok) return resolved;
  const read = deps.catalog.file(resolved.value.guide, path);
  if (!read.ok) return read;
  const extracted = deps.extract(
    { path, media_type: read.value.file.media_type, bytes: read.value.bytes },
    resolved.value.guide.content_hash,
  );
  return ok({
    guide: resolved.value.guide,
    basis: resolved.value.basis,
    file: read.value.file,
    bytes: read.value.bytes,
    extracted,
  });
}

function fileReference(
  guide: BundledGuide,
  file: ContentFile,
): GuideInstalledFile {
  return { reference: referenceOf(guide), ...file };
}

function childrenCount(
  sections: readonly GuideSectionRecord[],
  key: string,
): number {
  return sections.filter((section) => section.parent === key).length;
}

// 추출을 읽을 수 없을 때 section_status와 이유. 문서 outline·읽기와 같은 매핑이다.
function fallbackOf(
  extraction: Exclude<GuideExtraction["extraction"], { status: "ready" }>,
): { status: string; failure_reason: string | null } {
  return sectionStatusOf({
    status: extraction.status,
    failure_reason: extraction.status === "failed"
      ? extraction.failure_reason
      : null,
  }) ?? { status: "unverified", failure_reason: "extraction failed" };
}

export function createGuideHandlers(deps: GuideHandlerDeps): GuideHandlers {
  return {
    list(ctx, input) {
      const installed = deps.catalog.installed();
      if (!installed.ok) return installed;
      const basis = {
        topic: "guide.list",
        basis_seq: installed.value.basis,
        sort: "manifest",
        conditions: {},
        credential: ctx.credential_ref,
      };
      const from = input.cursor === undefined
        ? ok({ offset: 0 })
        : decodeOutlineCursor(input.cursor, basis);
      if (!from.ok) return from;
      const guides = installed.value.guides.slice(
        from.value.offset,
        from.value.offset + GUIDE_LIST_LIMIT,
      );
      const end = from.value.offset + guides.length;
      const complete = end >= installed.value.guides.length;
      return ok({
        lophn_version: installed.value.lophn_version,
        guides,
        as_of_seq: deps.asOfSeq,
        next_cursor: complete
          ? null
          : encodeOutlineCursor({ ...basis, versions: [] }, end),
        complete,
      });
    },
    get(_ctx, input) {
      const resolved = resolve(deps, input.reference);
      if (!resolved.ok) return resolved;
      // 안내의 모든 파일을 실제 packaged bytes와 대조한다. 어긋나면 unavailable이다.
      for (const file of resolved.value.guide.files) {
        const checked = deps.catalog.file(resolved.value.guide, file.path);
        if (!checked.ok) return checked;
      }
      return ok({
        guide: resolved.value.guide,
        as_of_seq: deps.asOfSeq,
        next_cursor: null,
      });
    },
    outline(ctx, input) {
      const loaded = load(deps, input.reference, input.path);
      if (!loaded.ok) return loaded;
      const { guide, extracted } = loaded.value;
      const depth = input.depth ?? DOCUMENT_OUTLINE_DEPTH;
      const budget = input.estimated_token_budget ?? DOCUMENT_BUDGET;
      const base = {
        reference: referenceOf(guide),
        path: input.path,
        format: extracted.format,
        module_hash: extracted.format.module_hash,
        file: fileReference(guide, loaded.value.file),
        as_of_seq: deps.asOfSeq,
      };
      const extraction = extracted.extraction;
      if (extraction.status !== "ready") {
        // 추출 실패·미지원. entries 없이 원문 파일 참조(fallback 근거)만 낸다.
        const term = fallbackOf(extraction);
        return ok({
          ...base,
          section_status: term.status,
          failure_reason: term.failure_reason,
          entries: [],
          next_cursor: null,
          complete: true,
        });
      }
      const sections = extraction.sections;
      const all: GuideOutlineEntry[] = sections.map((section) => ({
        ...section,
        estimated_tokens: estimatedTokens(section.characters),
        children_count: childrenCount(sections, section.key),
        hidden_children_count: 0,
      }));
      const basis = {
        topic: "guide.outline",
        basis_seq: loaded.value.basis,
        sort: "position",
        conditions: {
          reference: referenceOf(guide),
          path: input.path,
          depth,
          budget,
        },
        credential: ctx.credential_ref,
      };
      const from = input.cursor === undefined
        ? ok({ offset: 0 })
        : decodeOutlineCursor(input.cursor, basis);
      if (!from.ok) return from;
      const cut = cutOutline(all, depth, budget, {
        offset: from.value.offset,
        atLeastOne: true,
      });
      return ok({
        ...base,
        section_status: "whole",
        failure_reason: null,
        entries: cut.entries,
        next_cursor: cut.complete ? null : encodeOutlineCursor(
          { ...basis, versions: [] },
          from.value.offset + cut.entries.length,
        ),
        complete: cut.complete,
      });
    },
    read(_ctx, input) {
      const loaded = load(deps, input.reference, input.path);
      if (!loaded.ok) return loaded;
      const { guide, extracted } = loaded.value;
      const section = input.section ?? null;
      const includeChildren = input.include_children ?? false;
      const ranges = input.ranges ?? [];
      const base = {
        reference: referenceOf(guide),
        path: input.path,
        format: extracted.format,
        module_hash: extracted.format.module_hash,
        section,
        include_children: includeChildren,
        file: fileReference(guide, loaded.value.file),
        as_of_seq: deps.asOfSeq,
      };
      const nothing = {
        ranges: [],
        text: null,
        redacted: false,
        omission_reason: null,
        complete: true,
        next_cursor: null,
      };
      const extraction = extracted.extraction;
      if (extraction.status !== "ready") {
        const term = fallbackOf(extraction);
        return ok({
          ...base,
          ...nothing,
          section_status: term.status,
          failure_reason: term.failure_reason,
        });
      }
      const target = section === null
        ? undefined
        : extraction.sections.find((item) => item.key === section);
      // 성공 추출에 key가 없으면 missing이다.
      if (section !== null && target === undefined) {
        return ok({
          ...base,
          ...nothing,
          section_status: "missing",
          failure_reason: null,
        });
      }
      const lines = extraction.text.split("\n");
      const total = lineCount(extraction.text);
      const selected = selectBodyLines(
        target === undefined
          ? null
          : includeChildren
          ? [target.subtree_range]
          : target.own_ranges,
        ranges,
        total,
      );
      const window = readTextWindow({
        lines,
        selected,
        binding: {
          ver:
            `guide:${guide.lophn_version}:${guide.content_hash}:${input.path}`,
          module_hash: extracted.format.module_hash,
          section,
          include_children: includeChildren,
          ranges,
          text_hash: extraction.text_hash,
        },
        cursor: input.cursor,
        budget: input.max_codepoints ?? READ_CODEPOINT_BUDGET,
        redactor: deps.redactor,
        redactionSource: {
          concern: "documents",
          revision: guide.content_hash,
          scope: "guide",
        },
      });
      if (!window.ok) return window;
      return ok({
        ...base,
        ...window.value,
        section_status: section === null ? "whole" : "found",
        failure_reason: null,
      });
    },
  };
}
