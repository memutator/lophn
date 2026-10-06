import { createAuditOwners } from "./audit-owners.ts";
import { createDocumentsOwner } from "./documents-owner.ts";
import type { RevertOwner } from "./model.ts";

// 제품이 쓰는 owner 목록. 앞선 owner가 event type을 먼저 맡는다. 문서 변경은 documents/versions,
// run·tool·model call·질문·승인 같은 과거 사실은 유지(retained)이고, 어느 owner도 맡지 않는 event는
// 복원 불가로 남는다(model.ts). context·term 보상(lophn-agent#T42)과 앱 복원(lophn-agent#T48)은
// 이 목록에 owner를 더한다.
export function defaultRevertOwners(): RevertOwner[] {
  return [createDocumentsOwner(), ...createAuditOwners()];
}
