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
export { type CredentialIssue, CredentialRegistry } from "./registry.ts";
export { confirmationBinding } from "./confirmation-binding.ts";
export { ConfirmationRegistry, type ConfirmationUse } from "./confirmation.ts";
export {
  type ConfirmationBridge,
  confirmationBridge,
  type RouteConfirmation,
  routeConfirmation,
} from "./confirmation-bridge.ts";
export { consumeRouteConfirmation } from "./confirmation-route.ts";
export {
  type AppCredentialIssuer,
  createAppCredentialIssuer,
} from "./app-credential.ts";
