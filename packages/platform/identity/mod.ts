export {
  authorize,
  authorizeConditions,
  CONDITION_TARGET_KEYS,
  conditionsMatch,
  type CredentialTarget,
  intersectScope,
  operationCeiling,
  type OperationPolicy,
  scopeWithin,
  TARGET_AUTHORIZATION_UNAVAILABLE,
} from "./model.ts";
export {
  constantTimeDigestEqual,
  type CredentialIssue,
  CredentialRegistry,
  type CredentialRegistryOptions,
  type CurrentCredential,
} from "./registry.ts";
export { identityCurrentRead } from "./reads.ts";
export { confirmationBinding } from "./confirmation-binding.ts";
export {
  ConfirmationRegistry,
  type ConfirmationBinding,
  type ConfirmationRegistryOptions,
  type ConfirmationUse,
} from "./confirmation.ts";
export {
  confirmationBridge,
  type ConfirmationBridge,
  disconnectedConfirmationBridge,
} from "./confirmation-bridge.ts";
export { consumeRouteConfirmation } from "./confirmation-route.ts";
