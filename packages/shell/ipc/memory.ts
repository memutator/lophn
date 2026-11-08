// memory 파일([Memory])을 같은 편집기로 여는 경계. 지침([Instructions])과 같은 길이다: renderer는 어느 memory인지
// (workspace 또는 agent)만 보내고 경로는 main이 풀어 돌려준다. 파일이 없으면 빈 buffer로 열려 첫 저장이 만들고, 폴더는 연 쪽(main)이 만든다.
import { z } from "zod";

import type { EditorReply } from "./instructions.ts";

export const MEMORY_OPEN_CHANNEL = "shell:memory-open";

const memoryTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("home") }),
  z.strictObject({
    kind: z.literal("project"),
    workspace: z.string().regex(/^prj_[0-9a-z]{26}$/),
  }),
  z.strictObject({
    kind: z.literal("app"),
    workspace: z.string().regex(/^app_[0-9a-z]{26}$/),
  }),
  z.strictObject({
    kind: z.literal("agent"),
    agent: z.string().regex(/^agt_[0-9a-z]{26}$/),
  }),
]);

export const memoryOpenSchema = z.strictObject({ target: memoryTargetSchema });

/** workspace memory(Home, project, 앱)이거나 사람이 만든 agent의 memory. */
export type MemoryTarget =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly workspace: string }
  | { readonly kind: "app"; readonly workspace: string }
  | { readonly kind: "agent"; readonly agent: string };

export interface MemoryApi {
  open(input: {
    target: MemoryTarget;
  }): Promise<EditorReply<{ readonly path: string }>>;
}
