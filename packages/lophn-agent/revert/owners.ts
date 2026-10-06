import { createAuditOwners } from "./audit-owners.ts";
import { createContextOwner } from "./context-owner.ts";
import { createDocumentsOwner } from "./documents-owner.ts";
import { createTermOwner } from "./term-owner.ts";
import type { RevertOwner } from "./model.ts";

// 제품이 쓰는 owner 목록. 앞선 owner가 event type을 먼저 맡는다. 문서 변경은 documents/versions,
// context·용어 후보 변경은 documents/contexts·terms가 선언한 보상 command로 되돌리고, run·tool·model
// call·질문·승인 같은 과거 사실은 유지(retained)이며, 어느 owner도 맡지 않는 event는 복원 불가로
// 남는다(model.ts). 앱 복원(lophn-agent#T48)은 이 목록에 owner를 더한다.
export function defaultRevertOwners(): RevertOwner[] {
  return [
    createDocumentsOwner(),
    createContextOwner(),
    createTermOwner(),
    ...createAuditOwners(),
  ];
}
