// documents/file-tracking#R7: 문서 revision을 바꾸는 이동·이름 변경·제목 변경 event도 관측 근거를 다시
// 맞추는 신호다. 근거의 document_revision이 낡으면 파일 관측의 저장이 conflict라서, 이 event를
// 놓치면 이름을 바꾼 문서의 파일 수정이 새 판이 되지 못했다(flow E2E가 찾았다).
import { assertEquals } from "@std/assert";
import { isDocumentsFeedEvent } from "./documents-events.ts";

Deno.test("documents/file-tracking#R7: 문서 revision을 바꾸는 event는 관측 근거를 맞추는 신호다", () => {
  for (
    const type of [
      "DocumentCreated",
      "DocumentSaved",
      "DocumentSourceChanged",
      "DocumentArchived",
      "DocumentUnarchived",
      "DocumentRestored",
      "DocumentMoved",
      "DocumentRenamed",
      "DocumentUpdated",
    ]
  ) {
    assertEquals(isDocumentsFeedEvent(type), true, type);
  }
  // 관측과 무관한 event는 신호가 아니다.
  assertEquals(isDocumentsFeedEvent("TermProposed"), false);
  assertEquals(isDocumentsFeedEvent("SavedViewCreated"), false);
});
