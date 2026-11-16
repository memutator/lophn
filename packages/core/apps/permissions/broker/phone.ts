// broker `/_lophn/broker/phone/request`. 앱 backend가 사람의 폰에 묻는다. 선언∩grant의 `phone.use`를 capability마다 요청마다
// 검사한 뒤 core의 `app_phone.request`를 그 자식의 app credential로 부른다. 어느 폰에 묻고 kind 입력·출력이 맞는지는 core가 본다.
import { type Result } from "../../../../base/mod.ts";
import {
  type PhoneCapability,
  brokerPhoneInputSchema,
} from "../../../../protocol/apps/phone-request.ts";
import {
  type BrokerAccess,
  currentAccess,
  invalid,
  liveOnly,
  phoneGranted,
  refuse,
} from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

// core의 `app_phone.request`를 그 자식의 app credential로 부르는 포트다. 조립이 잇는다.
export interface PhoneRequestPort {
  request(
    child: BrokerChild,
    input: { capability: PhoneCapability; input: unknown },
  ): Promise<Result<unknown>>;
}

export type PhoneService = {
  request(child: BrokerChild, body: unknown): Promise<Result<unknown>>;
};

export function createPhoneService(deps: {
  access: BrokerAccess;
  core: PhoneRequestPort;
}): PhoneService {
  return {
    async request(child, body) {
      const parsed = brokerPhoneInputSchema.safeParse(body);
      if (!parsed.success) return invalid("phone request input is invalid");
      const { capability, input } = parsed.data;
      const refused = liveOnly(child, "phone.use", { capability });
      if (refused) return refused;
      const access = await currentAccess(deps.access, child);
      if (!access.ok) return access;
      if (access.value === null || !phoneGranted(access.value, capability)) {
        return refuse("phone.use", { capability });
      }
      return deps.core.request(child, { capability, input });
    },
  };
}
