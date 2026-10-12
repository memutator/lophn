// 지침 파일([Instructions])을 같은 편집기로 여는 경계. renderer는 층(전역·project·app)과
// 그 자리 id만 보낸다. exact 등록 경로·instruction target 이름은 main이 resolve하고 renderer에는
// 문서 id만 돌려준다. 파일이 아직 없으면 문서도 없고, 사람의 첫 저장이 파일을 만든다.
import { z } from "zod";

import { EDITOR_MAX_BYTES } from "./editor.ts";
import type { CreateReport, EditorReply } from "./editor.ts";

export const INSTRUCTIONS_OPEN_CHANNEL = "shell:instructions-open";
export const INSTRUCTIONS_CREATE_CHANNEL = "shell:instructions-create";

const requestKey = z.string().regex(/^[A-Za-z0-9_-]{16,120}$/);

export const instructionsPlaceSchema = z.discriminatedUnion("layer", [
  z.strictObject({ layer: z.literal("global") }),
  z.strictObject({
    layer: z.literal("project"),
    place: z.string().regex(/^prj_[0-9a-z]{26}$/),
  }),
  z.strictObject({
    layer: z.literal("app"),
    place: z.string().regex(/^app_[0-9a-z]{26}$/),
  }),
]);

export const instructionsOpenSchema = z.strictObject({
  target: instructionsPlaceSchema,
});

export const instructionsCreateSchema = z.strictObject({
  target: instructionsPlaceSchema,
  request_key: requestKey,
  bytes: z.instanceof(Uint8Array).refine((bytes) =>
    bytes.byteLength <= EDITOR_MAX_BYTES
  ),
});

export type InstructionsPlace =
  | { readonly layer: "global" }
  | { readonly layer: "project"; readonly place: string }
  | { readonly layer: "app"; readonly place: string };

/** 열린 결과. 파일에 연결된 문서가 없으면 둘 다 null이다(첫 저장 전). */
export interface InstructionsOpened {
  readonly document: string | null;
  /** 그 문서의 지금 확정된 판. */
  readonly version: string | null;
}

/** 첫 저장 결과. 파일 쓰기와 판 확정을 따로 알린다(pending: 파일은 썼고 판은 관측을 기다림). */
export interface InstructionsCreated extends CreateReport {
  readonly document: string | null;
}

export interface InstructionsApi {
  open(input: { target: InstructionsPlace }): Promise<
    EditorReply<InstructionsOpened>
  >;
  create(
    input: {
      target: InstructionsPlace;
      request_key: string;
      bytes: Uint8Array;
    },
  ): Promise<EditorReply<InstructionsCreated>>;
}
