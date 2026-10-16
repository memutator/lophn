import type { SqlParams, SqlRow } from "../../../../protocol/server/mod.ts";

// handoff는 call로 바뀌어 지워졌다. 이 file에는 tickets가 아직 쓰는 채택 질문 읽기 하나만 남았다.
// tickets가 그 import를 끊으면 이 폴더를 지운다.

type Lookup = {
  sql: {
    get: (query: string, params: SqlParams) => SqlRow | undefined;
    all: (query: string, params: SqlParams) => SqlRow[];
  };
};

// 채택 질문의 답. 질문은 answered이고 고른 선택지의 adoption이 이 고정 판과 같아야 한다.
// 다른 판의 채택 답이나 최신 주소는 거절한다. 선택지·답의 원본은 questions 표이고
// 질문이 답으로 닫혔는지는 질문이 든 묶음(question_groups)의 상태가 정한다.
export function adoptionOf(
  lookup: Lookup,
  question: string,
): { document: string; version: string; section: string | null } | undefined {
  const row = lookup.sql.get(
    `select g.status as status, q.answer as answer, q.options as options
     from questions q join question_groups g on g.id = q."group"
     where q.id = ?`,
    [question],
  );
  if (row === undefined || row["status"] !== "answered") return undefined;
  if (row["answer"] === null) return undefined;
  const answer = JSON.parse(String(row["answer"])) as {
    kind?: string;
    option_key?: string | null;
  };
  if (answer.kind !== "option" || typeof answer.option_key !== "string") {
    return undefined;
  }
  const options = JSON.parse(String(row["options"])) as {
    key: string;
    adoption:
      | { document: string; version: string; section: string | null }
      | null;
  }[];
  const chosen = options.find((option) => option.key === answer.option_key);
  return chosen?.adoption ?? undefined;
}
