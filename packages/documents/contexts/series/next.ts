// series kind의 pattern에서 멤버·순서·다음 이름을 계산하는 순수 함수(documents/series).
// 파일을 만들거나 예약하거나 저장하지 않는다. 같은 pattern과 같은 경로 목록은 같은 결과를 낸다.
import { err, type Result } from "../../../base/mod.ts";

export type SeriesPart = "n" | "major" | "minor" | "patch";

export type SeriesPattern = {
  text: string;
  // 파일 이름 칸 앞의 literal 폴더 칸들.
  folders: readonly string[];
  // 파일 이름 칸에서 번호 자리 앞뒤의 글자. `*`가 들어 있을 수 있다.
  before: string;
  after: string;
  part: SeriesPart;
  // 부호 있는 정수. 생략은 +1.
  step: number;
  // 1~4. 생략이면 null이고 마지막 멤버 key에서 바꾸는 성분의 글자 수를 따른다.
  width: number | null;
};

export type SeriesMember = {
  path: string;
  // 번호 자리가 잡은 글자. 앞자리 0을 유지한다.
  key: string;
  // key를 "."로 나눈 10진 정수. 순서 비교에 쓴다.
  parts: number[];
};

export type SeriesNext = {
  // 계산 불가면 빈 문자열.
  key: string;
  // 계산 불가면 null. `*`는 그대로 남는다.
  path: string | null;
  // 마지막 멤버의 path. 멤버가 없으면 null.
  from: string | null;
  // path가 있고 `*`가 없으면 true.
  complete: boolean;
  // 계산한 key를 가진 멤버가 이미 있다.
  taken: boolean;
};

// 문법 위반은 invalid_input이다.
export function parsePattern(_text: string): Result<SeriesPattern> {
  return err({ code: "invalid_input", message: "not implemented" });
}

// pattern 전체에 맞는 파일만, key의 숫자를 수로 비교한 자연 순서로 돌려준다.
export function listMembers(
  _pattern: SeriesPattern,
  _paths: readonly string[],
): SeriesMember[] {
  return [];
}

export function nextName(
  _pattern: SeriesPattern,
  _paths: readonly string[],
): SeriesNext {
  return { key: "", path: null, from: null, complete: false, taken: false };
}
