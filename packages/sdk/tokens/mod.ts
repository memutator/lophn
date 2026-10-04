// 앱이 import하는 고정 token. 값의 정본은 packages/design이고 여기서는 다시 내보내기만 한다(apps/sdk#R20).
export { tokenNames, tokens, vars } from "@lophn/design";
export type {
  Breakpoint,
  SpaceStep,
  StatusTone,
  Theme,
  Themed,
  TokenName,
  Tokens,
  TokenVars,
} from "@lophn/design";
