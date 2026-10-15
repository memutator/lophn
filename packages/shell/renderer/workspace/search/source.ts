// project 키워드 검색 통로. core를 직접 부르지 않고 화면이 주입한 통로만 쓴다.
import type { ReadResult } from "../source.ts";

/** 일치한 줄 하나. `start`·`end`는 `text` 안의 위치다. */
export interface FileMatch {
  /** 파일이 속한 등록 폴더(절대 경로). */
  readonly folder: string;
  /** 그 폴더 기준 상대 경로. */
  readonly path: string;
  readonly line: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface FileSearchInput {
  readonly project: string;
  readonly query: string;
  /** 등록 폴더나 그 하위 폴더 하나(절대 경로). 없으면 모든 폴더다. */
  readonly folder?: string;
}

export interface FileSearchSource {
  /** 경로 순, 다음 줄 순으로 돌려준다. */
  search(input: FileSearchInput): Promise<ReadResult<readonly FileMatch[]>>;
}
