// contexts 화면이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은
// core-source.ts만 안다. 모양은 contracts(context·term·outline.context·context.watch·
// context.export)에서 이 화면이 쓰는 field만 옮긴 것이다.
import type { SectionStatus, SourceResult } from "../source.ts";

export type { SectionStatus, SourceResult };

/** 기준·참고·watch. 화면 이름은 Baseline·Reference·Follow changes다(wording#R13). */
export type Perspective = "basis" | "reference" | "watch";

export const PERSPECTIVES: readonly Perspective[] = [
  "basis",
  "reference",
  "watch",
];

export type DocumentTarget = {
  readonly kind: "document";
  readonly document: string;
  readonly section: string | null;
};

export type FocusTarget =
  | DocumentTarget
  | {
    readonly kind: "app_command";
    readonly app: string;
    readonly command: string;
  };

/** Focus 목록의 한 줄. 사람이 지은 이름과 목적이다. */
export interface FocusRow {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly items: number;
  readonly archived: boolean;
  readonly revision: string;
}

export interface FocusItem {
  readonly perspective: Perspective;
  readonly target: FocusTarget;
  /** 항목을 고른 이유. */
  readonly reason: string;
  /** 문서 제목이나 앱 자료 이름. 읽을 수 없으면 빈 글일 수 있다. */
  readonly title: string;
  readonly readable: boolean;
  /** 문서 항목이 지금 따르는 고정 판. 없으면 null이다. */
  readonly version: string | null;
  /** 문서 항목의 section 상태. 앱 항목은 null이다. */
  readonly sectionStatus: SectionStatus | null;
}

export interface Focus {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly revision: string;
  readonly archived: boolean;
  readonly items: readonly FocusItem[];
  /** 항목을 끝까지 읽지 못했다. */
  readonly partial: boolean;
}

export type ConfirmedChange =
  | "content_changed"
  | "section_added"
  | "section_missing";

export interface WatchChange {
  readonly target: DocumentTarget;
  readonly kind: ConfirmedChange;
  readonly beforeVersion: string | null;
  readonly afterVersion: string;
}

export interface WatchUnverified {
  readonly target: DocumentTarget;
  readonly beforeVersion: string | null;
  readonly afterVersion: string;
  readonly reason: string;
}

/** 확인된 변화(최근 것부터)와 지금 미확인인 것. 둘은 섞이지 않는다. */
export interface FocusWatch {
  readonly changes: readonly WatchChange[];
  readonly unverified: readonly WatchUnverified[];
}

export interface MeaningEvidence {
  readonly document: string;
  /** 문서 제목. 읽지 못하면 null이다. */
  readonly title: string | null;
  readonly version: string;
  readonly section: string | null;
  readonly startLine: number | null;
  readonly endLine: number | null;
}

export interface Meaning {
  readonly id: string;
  readonly name: string;
  /** 사람이 정한 뜻. 후보는 null이다. */
  readonly definition: string | null;
  readonly evidence: readonly MeaningEvidence[];
  readonly revision: string;
}

export interface Meanings {
  readonly definitions: readonly Meaning[];
  readonly candidates: readonly Meaning[];
  /** 정의를 첫 page까지만 읽었다. */
  readonly partial: boolean;
}

export interface MeaningInput {
  readonly focus: string;
  /** 정할 후보나 고칠 정의. 새 뜻이면 없다. */
  readonly term?: Meaning;
  readonly name: string;
  readonly definition: string;
}

export interface FocusExportItem {
  readonly perspective: Perspective;
  readonly target: FocusTarget;
  readonly reason: string;
  readonly fixedVersion: string | null;
  readonly sectionStatus: SectionStatus | null;
}

/** 사람이 저장하는 export. contract는 JSON만 주고 Markdown은 화면이 그린다. */
export interface FocusExport {
  readonly title: string;
  readonly purpose: string;
  readonly items: readonly FocusExportItem[];
  readonly glossary: readonly { name: string; definition: string }[];
}

export interface ContextsSource {
  list(status: "active" | "all"): Promise<SourceResult<readonly FocusRow[]>>;
  focus(id: string): Promise<SourceResult<Focus>>;
  watch(id: string): Promise<SourceResult<FocusWatch>>;
  setArchived(
    focus: { readonly id: string; readonly revision: string },
    archived: boolean,
  ): Promise<SourceResult<{ readonly revision: string }>>;
  meanings(focus: string): Promise<SourceResult<Meanings>>;
  define(input: MeaningInput): Promise<SourceResult<Meaning>>;
  exportFocus(id: string): Promise<SourceResult<FocusExport>>;
}
