// 화면이 source(core 통로)에서 받는 결과. 실패는 오류 code만 담는다.
export type SourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };
