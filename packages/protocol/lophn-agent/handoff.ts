import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { transferAttachmentSchema } from "./calls.ts";

// session이 남기는 handoff note다. 글은 agent가 쓰고(언제 쓸지는 지침이 정한다), program은 사실(기계, project의 기계를 건너는 id,
// branch와 commit, 시각)만 붙인다. note는 `computers` 폴더의 자기 하위 폴더에 session마다 file 하나로 놓여 다른 기계로 간다
// (`noteFilePath`, `remote/carry.ts`). private인 workspace는 남기지 않는다.

// note 글의 UTF-8 byte 상한.
export const HANDOFF_TEXT_MAX_BYTES = 32 * 1024;
// 쓴 기계는 이보다 옛 자기 note file을 지우고, 읽는 기계는 이보다 옛 note를 내지 않는다.
export const HANDOFF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// `machines/<mch>/notes/<ses>.json`. 다른 기계가 쓴 file이라 읽는 쪽은 path의 기계·session과 같은지 보고 글 칸을 다시 줄인다.
export const handoffFileSchema = z.object({
  format: z.literal(1),
  machine: idSchema("mch"),
  session: idSchema("ses"),
  identity: idSchema("pri"),
  agent: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  text: z.string(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  attachments: z.array(transferAttachmentSchema).max(32).optional(),
  written_at: atSchema,
});
export type HandoffFile = z.infer<typeof handoffFileSchema>;

// 부른 agent session의 note를 쓴다(다시 쓰면 바꾼다). session은 부른 자격에서 정하고 입력으로 받지 않는다.
export const handoffWrite = defineMemory({
  resource: "handoff",
  method: "write",
  name: "handoff.write",
  input: z.strictObject({
    text: z.string().min(1),
    attachments: z.array(transferAttachmentSchema).max(32).optional(),
  }),
  output: z.strictObject({
    identity: idSchema("pri"),
    branch: z.string().nullable(),
    commit: z.string().nullable(),
    written_at: atSchema,
  }),
  actors: ["agent"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 다른 기계가 남긴 note 하나. `project`는 같은 기계를 건너는 id를 가진 이 기계의 project이고, `computer`는 명단의 그 컴퓨터 이름이다.
export const handoffNoteSchema = z.strictObject({
  machine: idSchema("mch"),
  computer: z.string(),
  session: idSchema("ses"),
  project: idSchema("prj"),
  agent_name: z.string(),
  text: z.string(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  attachments: z.array(transferAttachmentSchema).max(32).optional(),
  written_at: atSchema,
});
export type HandoffNote = z.infer<typeof handoffNoteSchema>;

// 이 기계의 사람이 읽는 다른 기계의 note. 새것부터다. 기기(폰, 다른 컴퓨터)와 agent는 부르지 못한다.
export const handoffList = defineMemory({
  resource: "handoff",
  method: "list",
  name: "handoff.list",
  input: z.strictObject({ project: idSchema("prj").optional() }),
  output: z.strictObject({ notes: z.array(handoffNoteSchema) }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

export const HANDOFF_ROUTES = [handoffWrite, handoffList] as const;
