import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  QUESTION_BLOB_FIELDS,
  QUESTION_BLOB_OWNER_KIND,
  QUESTION_TEXT_MAX_BYTES,
  questionText,
  questionTextInputSchema,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { ApiReadDefinition } from "../../../../protocol/server/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import {
  type MessageBodyEnvironment,
  readBodyBytes,
} from "../../session/mod.ts";
import { visibleAssignment } from "./reads.ts";
import { loadGroup, loadRunRef, type QuestionGroup } from "./model.ts";

// ReadQuestionText. 메시지 본문 읽기(ReadMessageBody)와 같은 길이다: 참조 행 판정은
// ledger snapshot에서 짧게 하고, blob 바이트는 그 뒤에 읽는다. 글은 준비 단계에서 이미
// redaction을 거쳤다. 묶음을 읽을 수 있는 쪽(user·machine·coding_agent, 그 assignment의
// agent)만 읽고, 그 밖은 없는 묶음과 똑같이 not_found다. 참조가 없거나 바이트를 읽지
// 못하거나 hash가 다르면 일부만 돌려주지 않고 unavailable이다.

export type QuestionTextEnvironment = MessageBodyEnvironment;

type Need = { field: string; hash: string };

type Found = {
  group: QuestionGroup;
  sizes: Map<string, number>;
  withHumanText: boolean;
  asOf: string;
};

const UNAVAILABLE = "question text is not available";

function absent(): Result<never> {
  return err({ code: "not_found", message: "question group not found" });
}

function unavailable(): Result<never> {
  return err({ code: "unavailable", message: UNAVAILABLE });
}

const key = (need: Need) => `${need.field}:${need.hash}`;

// 이 묶음의 글 blob. 사람이 남긴 글(자유 답·취소 이유)은 coding_agent에게 싣지 않는다.
function needsOf(group: QuestionGroup, withHumanText: boolean): Need[] {
  const needs: Need[] = [];
  for (const question of group.questions) {
    needs.push(
      { field: QUESTION_BLOB_FIELDS.prompt, hash: question.prompt_blob },
      { field: QUESTION_BLOB_FIELDS.reason, hash: question.reason_blob },
    );
    for (
      const option of JSON.parse(question.options) as {
        description_blob: string;
      }[]
    ) {
      needs.push({
        field: QUESTION_BLOB_FIELDS.optionDescription,
        hash: option.description_blob,
      });
    }
    if (question.recommendation !== null) {
      needs.push({
        field: QUESTION_BLOB_FIELDS.recommendation,
        hash: (JSON.parse(question.recommendation) as {
          explanation_blob: string;
        }).explanation_blob,
      });
    }
    if (withHumanText && question.answer !== null) {
      const answer = JSON.parse(question.answer) as {
        text_blob: string | null;
      };
      if (answer.text_blob !== null) {
        needs.push({
          field: QUESTION_BLOB_FIELDS.answer,
          hash: answer.text_blob,
        });
      }
    }
  }
  if (withHumanText && group.closed_reason_blob !== null) {
    needs.push({
      field: QUESTION_BLOB_FIELDS.closed,
      hash: group.closed_reason_blob,
    });
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
      const id = parsed.data.group;
      const scope = visibleAssignment(ctx);
      if (scope === undefined) return absent();
      const withHumanText = parseActor(ctx.actor)?.kind !== "coding_agent";
      const found = environment.snapshot<Found | undefined>((sql, asOfSeq) => {
        const lookup = { sql };
        const group = loadGroup(lookup, id);
        if (group === undefined) return ok(undefined);
        if (scope !== null) {
          const run = loadRunRef(lookup, group.run);
          if (run === undefined || run.assignment !== scope) {
            return ok(undefined);
          }
        }
        const sizes = new Map<string, number>();
        for (const need of needsOf(group, withHumanText)) {
          const ref = sql.get(
            `select size_bytes from blob_refs
             where owner_kind = ? and owner_key = ? and field = ? and hash = ?`,
            [QUESTION_BLOB_OWNER_KIND, group.id, need.field, need.hash],
          );
          const size = ref?.["size_bytes"];
          if (typeof size !== "bigint" && typeof size !== "number") {
            return unavailable();
          }
          sizes.set(key(need), Number(size));
        }
        return ok({ group, sizes, withHumanText, asOf: asOfSeq });
      });
      if (!found.ok) return found;
      if (found.value === undefined) return absent();
      const { group, sizes, withHumanText: human, asOf } = found.value;
      const texts = new Map<string, string>();
      for (const need of needsOf(group, human)) {
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
      return ok({
        group: group.id,
        questions: group.questions.map((question) => {
          const answer = question.answer === null
            ? null
            : JSON.parse(question.answer) as { text_blob: string | null };
          const recommendation = question.recommendation === null
            ? null
            : JSON.parse(question.recommendation) as {
              option_key: string | null;
              explanation_blob: string;
            };
          return {
            question: question.id,
            prompt: textOf(QUESTION_BLOB_FIELDS.prompt, question.prompt_blob),
            reason: textOf(QUESTION_BLOB_FIELDS.reason, question.reason_blob),
            options: (JSON.parse(question.options) as {
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
          };
        }),
        closed_reason_text: human && group.closed_reason_blob !== null
          ? textOf(QUESTION_BLOB_FIELDS.closed, group.closed_reason_blob)
          : null,
        as_of_seq: asOf,
        next_cursor: null,
      });
    },
  };
}
