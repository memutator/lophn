import type { Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../server/identity.ts";
import { definePort, type PortKey } from "../base/ports.ts";
import { type SecretDestination, type SecretPurpose } from "./secrets.ts";

// 앱 사용의 현재 grant 판정. apps가 구현하고 platform secret.send·store-refresh가 부른다.
// 현재 grant·release·process가 이 이름·purpose·목적지를 허용할 때만 ok, 아니면 forbidden이다.
type SecretAllowanceRequest = {
  context: AuthenticatedContext;
  name: string;
  purpose: SecretPurpose;
  destination: SecretDestination | null;
};
export type SecretAllowanceCheck = (
  request: SecretAllowanceRequest,
) => Result<void>;
export const SecretAllowance: PortKey<SecretAllowanceCheck> = definePort<
  SecretAllowanceCheck
>("SecretAllowance");

// context의 process가 지금 살아 있는 같은 감독 generation인지. 끝났거나 모르면 false다.
export type ProcessLivenessCheck = (context: AuthenticatedContext) => boolean;
