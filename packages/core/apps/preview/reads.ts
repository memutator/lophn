// `/previews/{start,get,stop}`의 core 등록. ledger snapshot 없이 supervisor 통로와 core의 disposable
// 영역을 쓰는 API read(ApiReadDefinition)이고, 입력을 route schema로 검사한 뒤 service에 넘긴다.
import { err } from "../../../base/mod.ts";
import {
  previewsGet,
  previewsGetInputSchema,
  previewsStart,
  previewsStartInputSchema,
  previewsStop,
  previewsStopInputSchema,
} from "../../../protocol/apps/mod.ts";
import type { ApiReadDefinition } from "../../../protocol/server/mod.ts";
import type { PreviewService } from "./service.ts";

const INVALID = err({
  code: "invalid_input" as const,
  message: "invalid read input",
});

// service 하나를 가리키는 getter를 받는다. core는 service를 supervisor 통로가 생긴 뒤에 만들므로
// 등록은 기동 초기에, 실제 service는 나중에 붙일 수 있다.
export function createPreviewReads(
  service: () => PreviewService,
): readonly ApiReadDefinition[] {
  const start: ApiReadDefinition<typeof previewsStart> = {
    route: previewsStart,
    handle(ctx, input) {
      const parsed = previewsStartInputSchema.safeParse(input);
      return parsed.success ? service().start(ctx, parsed.data) : INVALID;
    },
  };
  const get: ApiReadDefinition<typeof previewsGet> = {
    route: previewsGet,
    handle(ctx, input) {
      const parsed = previewsGetInputSchema.safeParse(input);
      return parsed.success ? service().get(ctx, parsed.data) : INVALID;
    },
  };
  const stop: ApiReadDefinition<typeof previewsStop> = {
    route: previewsStop,
    handle(ctx, input) {
      const parsed = previewsStopInputSchema.safeParse(input);
      return parsed.success ? service().stop(ctx, parsed.data) : INVALID;
    },
  };
  return [start, get, stop] as unknown as readonly ApiReadDefinition[];
}
