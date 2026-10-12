import { sectionHeading } from "./model.ts";

// lophn의 사용 안내 답(roles/lophn#R17). 순수 함수다. 사람이 물은 기능·절의 기존 동봉 안내로
// 답하고, 재사용할 답이 없거나 안내가 바뀐 경우에만 사용 안내 문서의 새 version을 요청한다.
// 같은 질문은 같은 근거로 같은 답을 받는다. 제품 사용법이 아닌 질문은 이 경로의 밖이다.

export type GuideText = {
  title: string;
  lophn_version: string;
  content_hash: string;
  text: string;
};

export type GuideAsk = {
  // 동봉 안내의 제목(기능 이름). 대소문자는 구별하지 않는다.
  feature: string;
  // `## ` 절 제목. 없으면 안내 전체다.
  section?: string;
  // 제품 사용법에 대한 질문인지.
  product_usage: boolean;
};

export type GuideAnswer =
  | {
    kind: "existing";
    title: string;
    section: string | null;
    text: string;
    lophn_version: string;
    content_hash: string;
  }
  | {
    kind: "needs_new_version";
    reason: "no_reusable_answer" | "changed";
  }
  | { kind: "out_of_scope" };

// `## 절` 하나의 글. 다음 `## ` 앞까지다. 없는 절은 undefined다.
export function sectionText(text: string, heading: string): string | undefined {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => sectionHeading(line) === heading);
  if (start < 0) return undefined;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (sectionHeading(lines[index]!) !== undefined) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

export function answerFromGuides(input: {
  guides: readonly GuideText[];
  ask: GuideAsk;
  // 이전에 이 기능으로 답한 근거. 지금 안내와 판·hash가 다르면 안내가 바뀐 것이다.
  prior?: { lophn_version: string; content_hash: string } | null;
}): GuideAnswer {
  if (!input.ask.product_usage) return { kind: "out_of_scope" };
  const wanted = input.ask.feature.trim().toLowerCase();
  const guide = input.guides.find((candidate) =>
    candidate.title.trim().toLowerCase() === wanted
  );
  if (guide === undefined) {
    return { kind: "needs_new_version", reason: "no_reusable_answer" };
  }
  const prior = input.prior ?? null;
  if (
    prior !== null &&
    (prior.lophn_version !== guide.lophn_version ||
      prior.content_hash !== guide.content_hash)
  ) {
    return { kind: "needs_new_version", reason: "changed" };
  }
  const section = input.ask.section ?? null;
  const text = section === null ? guide.text : sectionText(guide.text, section);
  if (text === undefined) {
    return { kind: "needs_new_version", reason: "no_reusable_answer" };
  }
  return {
    kind: "existing",
    title: guide.title,
    section,
    text,
    lophn_version: guide.lophn_version,
    content_hash: guide.content_hash,
  };
}
