// documents/formats: 저장 준비 경로가 쓰는 format 정본(declaration·module hash).
// 전체 format 구현(guest 계산, module 묶음, runner client)은 core 밖의 제한된
// runner에서 돈다(adapters·check·modules·runner·guest는 이 경계 밖에 산다).
// core가 여는 내장 format read(declaration·module_hash)는 T4 registry 계약대로
// declaration 모듈만 graph에 있어도 된다(Q10).
export { BUILTIN_MODULE_HASH } from "./guest/module-hash.ts";
export {
  declarationJson,
  formatDeclaration,
  formatDeclarations,
  formatForMediaType,
  MODULE_HASH_PLACEHOLDER,
} from "./model.ts";
export {
  CHECK_SKIPPED_CODE,
  type OverLimitOutcome,
  overLimitOutcome,
} from "./check-limit.ts";
