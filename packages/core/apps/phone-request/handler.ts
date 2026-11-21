// `app_phone.request`. 앱 backend가 사람의 기준 폰에 묻는다. 권한(`phone.use` grant)은 broker가 요청마다 판정했고, 여기서는
// 그 앱이 살아 있는지, 입력이 kind에 맞는지 본 뒤 폰에 묻고 폰의 답이 kind의 출력에 맞는지 본다. 기록·banner는 없다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { PhoneCapability } from "../../../protocol/apps/phone-request.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  type BackendCapability,
  capabilityFrom,
  PHONE_KINDS,
} from "../../../protocol/phone/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";

export type PhoneRequestDeps = {
  // 그 앱이 있고 active인가. null이면 없는 앱이다.
  appStatus(app: string): "active" | "archived" | null;
  // 부를 때 읽는다. 기준 폰을 찾고 그 기기에 묻는다.
  phone(): {
    primary(): Promise<Result<string | null>>;
    call(request: {
      device: string;
      kind: string;
      input: unknown;
      deadline_ms: number;
    }): Promise<Result<unknown>>;
  };
};

export function phoneRequestHandler(deps: PhoneRequestDeps): MemoryHandler {
  return async (ctx, body) => {
    const actor = parseActor(ctx.actor);
    if (actor?.kind !== "app") {
      return err({ code: "forbidden", message: "only an app asks the phone" });
    }
    const status = deps.appStatus(actor.id);
    if (status === null) {
      return err({ code: "not_found", message: "app not found" });
    }
    if (status !== "active") {
      return err({ code: "conflict", message: "app is archived" });
    }
    const { capability, input } = body as {
      capability: PhoneCapability;
      input: unknown;
    };
    // 화면만 쓰는 기능은 폰에 묻지 않는다(화면은 폰 host에 직접 묻는다).
    if (!capabilityFrom(capability, "backend")) {
      return err({
        code: "invalid_input",
        message: `${capability} is only for phone screens`,
      });
    }
    const kind = PHONE_KINDS[capability as BackendCapability];
    const parsed = kind.input.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: `${capability} input is invalid`,
      });
    }
    const link = deps.phone();
    const primary = await link.primary();
    if (!primary.ok) return primary;
    if (primary.value === null) {
      return err({
        code: "unavailable",
        message: "no phone is paired",
        details: { reason: "no_phone" },
      });
    }
    const answered = await link.call({
      device: primary.value,
      kind: capability,
      input: parsed.data,
      deadline_ms: kind.deadline_ms,
    });
    if (!answered.ok) return answered;
    const value = kind.output.safeParse(answered.value);
    if (!value.success) {
      return err({
        code: "unavailable",
        message: `the phone answered ${capability} badly`,
      });
    }
    return ok({ value: value.data });
  };
}
