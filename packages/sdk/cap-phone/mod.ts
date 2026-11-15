export { createPhoneClient, getLocation } from "./phone.ts";
export type {
  LocationAccuracy,
  LocationOptions,
  PhoneClient,
  PhoneClientDeps,
  PhoneLocation,
} from "./phone.ts";
export { CapabilityError } from "./errors.ts";
export type { CapabilityErrorCode } from "./errors.ts";
export { checkDeclaration, REQUIRED_PERMISSIONS } from "./declaration.ts";
export type { DeclarationCheck, DeclarationLike } from "./declaration.ts";
export { CAP_HOST } from "./host.ts";
export type {
  BrokerResponse,
  CallContext,
  CapHost,
  RuntimeMode,
} from "./host.ts";
