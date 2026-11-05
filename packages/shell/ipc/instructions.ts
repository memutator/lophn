// 지침 파일([Instructions])을 같은 편집기로 여는 경계. renderer는 층(전역·project)과
// 그 자리 id만 보낸다. exact 등록 경로·instruction target 이름은 main이 resolve하고 renderer에는
// 문서 id만 돌려준다. 파일이 아직 없으면 문서도 없고, 사람의 첫 저장이 파일을 만든다.
import { z } from "zod";

export const INSTRUCTIONS_OPEN_CHANNEL = "shell:instructions-open";

const instructionsWorkspaceSchema = z.discriminatedUnion("layer", [
  z.strictObject({ layer: z.literal("global") }),
  z.strictObject({
    layer: z.literal("project"),
    workspace: z.string().regex(/^prj_[0-9a-z]{26}$/),
  }),
]);

export const instructionsOpenSchema = z.strictObject({
  target: instructionsWorkspaceSchema,
});

export type InstructionsWorkspace =
  | { readonly layer: "global" }
  | { readonly layer: "project"; readonly workspace: string };

/** renderer가 구별하는 실패. 경로·OS 오류 원문은 싣지 않는다. */
type EditorFailure =
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "unavailable"
  | "offline"
  | "unsupported"
  | "too_large"
  | "unknown_session";

export type EditorReply<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: EditorFailure };

/** 열린 결과. 파일에 연결된 문서가 없으면 document와 version이 null이다(첫 저장 전). */
interface InstructionsOpened {
  /** 지침 파일의 절대 경로. 편집기가 이 경로로 연다. */
  readonly path: string;
  readonly document: string | null;
  /** 그 문서의 지금 확정된 판. */
  readonly version: string | null;
}

export interface InstructionsApi {
  open(input: {
    target: InstructionsWorkspace;
  }): Promise<EditorReply<InstructionsOpened>>;
}
