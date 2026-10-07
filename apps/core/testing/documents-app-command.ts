// context 항목에 앱 command를 담는 시험용 documents 등록이다. 제품 등록은 앱 command 판정이 없어 앱 항목을
// 만들지 못하므로(fail-closed) 앱 항목이 필요한 시험이 이 module을 team module로 건넨다. 그 밖은 제품
// documents 등록과 같다. 시험 전용이고 제품 조립이 부르지 않는다.
import {
  createLedgerRegistration as createProductRegistration,
  type DocumentsEnvironment,
} from "../documents.ts";

export * from "../documents.ts";

export function createLedgerRegistration(environment?: DocumentsEnvironment) {
  return createProductRegistration({
    ...environment,
    contextAppCommand: () => true,
  });
}
