// broker `/_lophn/broker/documents/save`. 앱은 선언한 자기 앱 문서 key와 정확한 사람 grant가 모두
// 있을 때만 저장한다(apps/permissions#R13). 저장 대상은 항상 (그 자식의 앱 자리, key)이고, 본문이
// 다른 앱 자리를 가리킬 방법은 없다. 같은 key로 다시 저장하면 같은 문서의 새 version으로 이어지는
// 일은 documents/versions가 (앱 자리, key)와 재전송 key로 처리한다(apps/blueprint#R13).
import type { Result } from "../../../base/mod.ts";
import {
  brokerDocumentSaveInputSchema,
  type brokerDocumentSaveOutputSchema,
} from "../../../contracts/apps/mod.ts";
import type { z } from "zod";
import {
  type BrokerAccess,
  currentAccess,
  documentGranted,
  invalid,
  liveOnly,
  refuse,
} from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

export type DocumentSaveOutput = z.infer<typeof brokerDocumentSaveOutputSchema>;

// documents 저장 contract(`/v1/documents/save`)를 감싼 포트다. app·release는 인증 근거이고
// 앱 본문의 주장이 아니다.
export type DocumentsSaveRequest = {
  app: string;
  release: string;
  place: { kind: "app"; app: string };
  key: string;
  baseVersion: string | null;
  idempotencyKey: string;
};

export interface DocumentsSave {
  save(request: DocumentsSaveRequest): Promise<Result<DocumentSaveOutput>>;
}

export type DocumentSaveService = {
  save(
    child: BrokerChild,
    body: unknown,
  ): Promise<Result<DocumentSaveOutput>>;
};

export function createDocumentSaveService(deps: {
  access: BrokerAccess;
  documents: DocumentsSave;
}): DocumentSaveService {
  return {
    async save(child, body) {
      const parsed = brokerDocumentSaveInputSchema.safeParse(body);
      if (!parsed.success) return invalid("document save input is invalid");
      const input = parsed.data;
      const refused = liveOnly(child, "document.save", { key: input.key });
      if (refused) return refused;
      const access = await currentAccess(deps.access, child);
      if (!access.ok) return access;
      // 선언한 문서이면서 active grant가 있어야 한다. 어느 쪽이 빠졌는지는 알리지 않는다.
      if (access.value === null || !documentGranted(access.value, input.key)) {
        return refuse("document.save", { key: input.key });
      }
      return await deps.documents.save({
        app: child.app,
        release: access.value.release,
        place: { kind: "app", app: child.app },
        key: input.key,
        baseVersion: input.base_version,
        idempotencyKey: input.idempotency_key,
      });
    },
  };
}
