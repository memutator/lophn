// 문서 읽기와 편집기가 읽는 통로. documents의 문서·판, outline·본문
// 단계 읽기에서 화면이 쓰는 것만 담는다. core를 직접
// 부르지 않고 화면이 주입한 통로만 쓴다. 저장은 이 통로에 없다.
export type SourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };

/** 문서 머리·탭이 보이는 것. */
export interface DocumentInfo {
  readonly id: string;
  readonly title: string;
  /** 탭 제목. 주 파일의 이름이다. */
  readonly fileName: string;
  /** tooltip의 상대 경로. 파일이 묶음 blob이면 null이다. */
  readonly path: string | null;
  /** 지금 보는 판. 본문·outline 읽기를 이 판에 고정한다. */
  readonly version: string;
  readonly versionNumber: number;
  /** 판을 저장한 시각(ms). */
  readonly savedAt: number;
}

/** 본문 읽기 상태. 글이 없는 이유는 documents가 준 것만 구별한다. */
export type BodyState =
  | { readonly kind: "loading" }
  | { readonly kind: "text"; readonly text: string; readonly complete: boolean }
  | { readonly kind: "hidden" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "failed" };

/** outline의 절 하나. line은 제목 줄(1부터)이다. */
export interface OutlineSection {
  readonly key: string;
  readonly title: string;
  readonly level: number;
  readonly line: number;
}

export interface EditorSource {
  document(id: string): Promise<SourceResult<DocumentInfo>>;
  /** 고정 판의 본문을 page마다 이어 읽는다. page가 올 때마다 onPage를 부른다. */
  body(
    document: string,
    version: string,
    onPage: (state: BodyState) => void,
  ): Promise<BodyState>;
  outline(
    document: string,
    version: string,
  ): Promise<SourceResult<readonly OutlineSection[]>>;
}
