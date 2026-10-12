import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type CreateQuestionGroupInput,
  QUESTION_BLOB_FIELDS,
  QUESTION_BLOB_OWNER_KIND,
  QUESTION_TEXT_PURPOSE,
  questionTextBytes,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { RequestContext, Tx } from "../../../../protocol/server/mod.ts";

// 글 값의 blob 증거. core가 같은 UTF-8 bytes로 준비했으므로 같은 글은 항상 같은 hash다.
// 재전송의 지문도 값으로 정해져 준비 참조의 수명과 상관없다.
export type TextBlob = {
  hash: string;
  evidence: {
    preparation: string;
    principal: string;
    purpose: string;
    hash: string;
    size_bytes: number;
  };
};

export function textBlob(ctx: RequestContext, text: string): TextBlob {
  const bytes = questionTextBytes(text);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return {
    hash,
    evidence: {
      preparation: hash,
      principal: ctx.principal,
      purpose: QUESTION_TEXT_PURPOSE,
      hash,
      size_bytes: bytes.length,
    },
  };
}

// 같은 (묶음, field, hash)는 한 번만 등록한다. 서로 다른 선택지·질문의 같은 글은 한 참조다.
// 참조의 owner는 묶음이라 묶음 하나의 글은 owner_key 하나로 모인다.
export function registerTextBlobs(
  tx: Tx,
  group: string,
  seq: string,
  blobs: readonly { field: string; blob: TextBlob }[],
): Result<void> {
  const seen = new Set<string>();
  for (const { field, blob } of blobs) {
    const key = `${field}:${blob.hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const registered = tx.registerBlobRef({
      owner_kind: QUESTION_BLOB_OWNER_KIND,
      owner_key: group,
      field,
      registered_seq: seq,
      source: { kind: "prepared", blob: blob.evidence },
    });
    if (!registered.ok) return err(registered.error);
  }
  return ok(undefined);
}

// 저장되는 모양의 질문 하나. 요청의 글은 blob hash로 바뀌어 있다.
export type StoredQuestionContent = {
  id: string;
  prompt_blob: string;
  reason_blob: string;
  options: unknown[];
  recommendation: unknown;
};

// 저장되는 모양의 묶음 내용. blobs는 묶음의 모든 글이고 등록은 한 transaction에서 한다.
export type StoredGroupContent = {
  questions: StoredQuestionContent[];
  blobs: { field: string; blob: TextBlob }[];
};

export function storedContent(
  ctx: RequestContext,
  input: CreateQuestionGroupInput,
): StoredGroupContent {
  const blobs: StoredGroupContent["blobs"] = [];
  const questions = input.questions.map((question) => {
    const prompt = textBlob(ctx, question.prompt);
    const reason = textBlob(ctx, question.reason);
    blobs.push(
      { field: QUESTION_BLOB_FIELDS.prompt, blob: prompt },
      { field: QUESTION_BLOB_FIELDS.reason, blob: reason },
    );
    const options = question.options.map((option) => {
      const { description, ...rest } = option;
      const blob = textBlob(ctx, description);
      blobs.push({ field: QUESTION_BLOB_FIELDS.optionDescription, blob });
      return { ...rest, description_blob: blob.hash };
    });
    let recommendation: unknown = null;
    if (question.recommendation !== null) {
      const blob = textBlob(ctx, question.recommendation.explanation);
      blobs.push({ field: QUESTION_BLOB_FIELDS.recommendation, blob });
      recommendation = {
        option_key: question.recommendation.option_key,
        explanation_blob: blob.hash,
      };
    }
    return {
      id: question.id,
      prompt_blob: prompt.hash,
      reason_blob: reason.hash,
      options,
      recommendation,
    };
  });
  return { questions, blobs };
}
