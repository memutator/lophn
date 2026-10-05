import { err, ok, type Result } from "../../base/mod.ts";
import {
  QUESTION_BLOB_FIELDS,
  QUESTION_BLOB_OWNER_KIND,
  QUESTION_TEXT_MAX_BYTES,
  questionText,
  questionTextInputSchema,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type ApiReadDefinition,
  parseActor,
} from "../../contracts/platform/mod.ts";
import {
  type MessageBodyEnvironment,
  readBodyBytes,
} from "../conversation/mod.ts";
import { visibleAssignment } from "./reads.ts";
import { loadQuestion, loadRunRef, type QuestionRow } from "./model.ts";

// ReadQuestionText. 메시지 본문 읽기(ReadMessageBody)와 같은 길이다: 참조 행 판정은
// ledger snapshot에서 짧게 하고, blob 바이트는 그 뒤에 읽는다. 글은 준비 단계에서 이미
// redaction을 거쳤다. 질문을 읽을 수 있는 쪽(user·machine·coding_agent, 그 assignment의
// agent)만 읽고, 그 밖은 없는 질문과 똑같이 not_found다. 참조가 없거나 바이트를 읽지
// 못하거나 hash가 다르면 일부만 돌려주지 않고 unavailable이다.

export type QuestionTextEnvironment = MessageBodyEnvironment;

type Need = { field: string; hash: string };

type Found = {
  row: QuestionRow;
  sizes: Map<string, number>;
  withHumanText: boolean;
  asOf: string;
};

const UNAVAILABLE = "question text is not available";

function absent(): Result<never> {
  return err({ code: "not_found", message: "question not found" });
}

function unavailable(): Result<never> {
  return err({ code: "unavailable", message: UNAVAILABLE });
}

const key = (need: Need) => `${need.field}:${need.hash}`;

// 이 질문의 글 blob. 사람이 남긴 글(자유 답·취소 이유)은 coding_agent에게 싣지 않는다.
function needsOf(row: QuestionRow, withHumanText: boolean): Need[] {
  const needs: Need[] = [
    { field: QUESTION_BLOB_FIELDS.prompt, hash: row.prompt_blob },
    { field: QUESTION_BLOB_FIELDS.reason, hash: row.reason_blob },
  ];
  for (
    const option of JSON.parse(row.options) as { description_blob: string }[]
  ) {
    needs.push({
      field: QUESTION_BLOB_FIELDS.optionDescription,
      hash: option.description_blob,
    });
  }
  if (row.recommendation !== null) {
    needs.push({
      field: QUESTION_BLOB_FIELDS.recommendation,
      hash: (JSON.parse(row.recommendation) as { explanation_blob: string })
        .explanation_blob,
    });
  }
  if (withHumanText) {
    const answer = row.answer === null ? null : JSON.parse(row.answer) as {
      kind: string;
      text_blob: string | null;
    };
    if (answer !== null && answer.text_blob !== null) {
      needs.push({
        field: QUESTION_BLOB_FIELDS.answer,
        hash: answer.text_blob,
      });
    }
    if (row.closed_reason_blob !== null) {
      needs.push({
        field: QUESTION_BLOB_FIELDS.closed,
        hash: row.closed_reason_blob,
      });
    }
  }
  return needs;
}

export function questionTextRead(
  environment: QuestionTextEnvironment,
): ApiReadDefinition<typeof questionText> {
  return {
    route: questionText,
    async handle(ctx, input) {
      const parsed = questionTextInputSchema.safeParse(input);
      if (!parsed.success) {
        return err({ code: "invalid_input", message: "invalid read input" });
      }
      const id = parsed.data.question;
      const scope = visibleAssignment(ctx);
      if (scope === undefined) return absent();
      const withHumanText = parseActor(ctx.actor)?.kind !== "coding_agent";
      const found = environment.snapshot<Found | undefined>((sql, asOfSeq) => {
        const lookup = { sql };
        const row = loadQuestion(lookup, id);
        if (row === undefined) return ok(undefined);
        if (scope !== null) {
          const run = loadRunRef(lookup, row.run);
          if (run === undefined || run.assignment !== scope) {
            return ok(undefined);
          }
        }
        const sizes = new Map<string, number>();
        for (const need of needsOf(row, withHumanText)) {
          const ref = sql.get(
            `select size_bytes from blob_refs
             where owner_kind = ? and owner_key = ? and field = ? and hash = ?`,
            [QUESTION_BLOB_OWNER_KIND, row.id, need.field, need.hash],
          );
          const size = ref?.["size_bytes"];
          if (typeof size !== "bigint" && typeof size !== "number") {
            return unavailable();
          }
          sizes.set(key(need), Number(size));
        }
        return ok({ row, sizes, withHumanText, asOf: asOfSeq });
      });
      if (!found.ok) return found;
      if (found.value === undefined) return absent();
      const { row, sizes, withHumanText: human, asOf } = found.value;
      const texts = new Map<string, string>();
      for (const need of needsOf(row, human)) {
        if (texts.has(key(need))) continue;
        const size = sizes.get(key(need))!;
        if (size < 1 || size > QUESTION_TEXT_MAX_BYTES) return unavailable();
        const bytes = await readBodyBytes(environment, need.hash, size);
        if (!bytes.ok) return unavailable();
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.value);
        } catch {
          return unavailable();
        }
        texts.set(key(need), text);
      }
      const textOf = (field: string, hash: string) =>
        texts.get(key({ field, hash }))!;
      const answer = row.answer === null
        ? null
        : JSON.parse(row.answer) as { text_blob: string | null };
      const recommendation = row.recommendation === null ? null : JSON.parse(
        row.recommendation,
      ) as { option_key: string | null; explanation_blob: string };
      return ok({
        question: row.id,
        prompt: textOf(QUESTION_BLOB_FIELDS.prompt, row.prompt_blob),
        reason: textOf(QUESTION_BLOB_FIELDS.reason, row.reason_blob),
        options: (JSON.parse(row.options) as {
          key: string;
          description_blob: string;
        }[]).map((option) => ({
          key: option.key,
          description: textOf(
            QUESTION_BLOB_FIELDS.optionDescription,
            option.description_blob,
          ),
        })),
        recommendation: recommendation === null ? null : {
          option_key: recommendation.option_key,
          explanation: textOf(
            QUESTION_BLOB_FIELDS.recommendation,
            recommendation.explanation_blob,
          ),
        },
        answer_text: human && answer !== null && answer.text_blob !== null
          ? textOf(QUESTION_BLOB_FIELDS.answer, answer.text_blob)
          : null,
        closed_reason_text: human && row.closed_reason_blob !== null
          ? textOf(QUESTION_BLOB_FIELDS.closed, row.closed_reason_blob)
          : null,
        as_of_seq: asOf,
        next_cursor: null,
      });
    },
  };
}
