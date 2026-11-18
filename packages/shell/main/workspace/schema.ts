// workspace layout(`workspace-layout.ts`)이 같이 쓰는 값 schema: 탭, 정수 rectangle, desk key.
import { z } from "zod";

import { type LayoutTab, tabKindOf } from "./kinds/registry.ts";
import { idOf } from "./kinds/values.ts";

// default 자리의 key. workflow 이름은 slug라 `_`로 시작할 수 없어 겹치지 않는다. renderer shell/desk-model.ts의 기본 desk key와 짝이다.
export const DEFAULT_DESK = "_default";

// 탭 값은 등록된 kind의 schema가 정한다(kinds/registry.ts). tagged union이고 preview(mode)는 복원 파일에서
// 제외된다. 등록되지 않은 kind는 이 schema가 거절하고, workspace-layout의 parseWorkspaceLayoutFile이 먼저 그런 탭을 건너뛴다.
// `machine`(탭이 보는 기계 `mch_`)은 kind마다가 아니라 탭 공통 칸이다: 이 칸만 떼어 검사하고 나머지를 kind의 schema에 준다.
// 없으면 그 workspace의 기계다(이 컴퓨터의 workspace면 이 컴퓨터).
type StoredTab = LayoutTab & { machine?: string | undefined };

export const layoutTabSchema: z.ZodType<StoredTab> = z
  .unknown()
  .transform((value, ctx) => {
    const kind = tabKindOf((value as { kind?: unknown } | null)?.kind);
    if (kind === undefined) {
      ctx.addIssue({ code: "custom", message: "unknown tab kind" });
      return z.NEVER;
    }
    const { machine, ...rest } = value as { machine?: unknown };
    if (machine !== undefined && idOf("mch", machine) === null) {
      ctx.addIssue({ code: "custom", message: "invalid tab machine" });
      return z.NEVER;
    }
    const parsed = kind.layout.safeParse(rest);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: "invalid tab value" });
      return z.NEVER;
    }
    return {
      ...(parsed.data as LayoutTab),
      ...(machine === undefined ? {} : { machine: machine as string }),
    };
  }) as unknown as z.ZodType<StoredTab>;

export type { LayoutTab };

// 정수 rectangle. floated 탭의 rect와 detached 창 bounds가 같이 쓴다. 과도한 크기는 받지 않는다.
export const windowBounds = z.strictObject({
  x: z.number().int().min(-32768).max(32768),
  y: z.number().int().min(-32768).max(32768),
  width: z.number().int().min(1).max(32768),
  height: z.number().int().min(1).max(32768),
});

export type WindowBounds = z.infer<typeof windowBounds>;

// 자리 key. workflow 이름이거나 DEFAULT_DESK다.
export const deskKey = z
  .string()
  .min(1)
  .max(200)
  .refine((key) => ![...key].some((ch) => ch <= "\u001f" || ch === "\u007f"), {
    message: "desk key has a control character",
  });
