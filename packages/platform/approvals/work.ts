// approval 설명의 준비(platform/approvals#R1, R2, R14).
// command 밖에서 한다. 본문이 공백뿐이거나 secret 모양이면 준비하지 않는다.
// redaction은 platform/redaction의 credential 판정을 쓴다. 화면 배치는 shell이 맡는다.

import { err, ok, type Result } from "../../base/mod.ts";
import { sha256Hex } from "../../base/mod.ts";
import type { PreparedBlob } from "../../contracts/platform/mod.ts";
import { matchCredential } from "../redaction/mod.ts";
import { descriptionPresent } from "./model.ts";

export const APPROVAL_TEXT_PURPOSE = "approval_text";

export type ApprovalText = {
  blob: PreparedBlob;
  // 준비 단계에서 확인한 본문. command는 이 글의 공백과 hash만 다시 본다.
  text: string;
};

export type TextPreparer = {
  // 본문을 blob으로 준비하고 그 참조를 돌려준다. hash는 본문 sha256과 같다.
  prepare(text: string, principal: string): Promise<Result<PreparedBlob>>;
};

// 필수 설명 하나의 준비. 공백뿐이면 준비하지 않는다(R1).
export async function prepareDescription(
  preparer: TextPreparer,
  text: string,
  principal: string,
): Promise<Result<ApprovalText>> {
  if (!descriptionPresent(text)) {
    return err({ code: "invalid_input", message: "설명이 비어 있다" });
  }
  // secret 원문은 설명에 넣지 않는다(domain model ApprovalAction).
  if (matchCredential(text) !== undefined) {
    return err({
      code: "invalid_input",
      message: "설명에 secret 모양이 있다",
    });
  }
  const prepared = await preparer.prepare(text, principal);
  if (!prepared.ok) return prepared;
  const hash = await sha256Hex(text);
  if (prepared.value.hash !== hash) {
    return err({
      code: "invalid_input",
      message: "준비한 blob hash가 본문과 다르다",
    });
  }
  return ok({ blob: prepared.value, text });
}

// 거절·취소·만료 이유. 거절은 이유 없이도 된다(R14). 있으면 같은 검사를 거친다.
export async function prepareClosedReason(
  preparer: TextPreparer,
  text: string | undefined,
  principal: string,
): Promise<Result<ApprovalText | undefined>> {
  if (text === undefined) return ok(undefined);
  return await prepareDescription(preparer, text, principal);
}
