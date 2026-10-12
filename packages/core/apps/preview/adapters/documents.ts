// 문서 저장 대역(apps/preview#R4). 실제 documents 저장과 version 생성 없이 같은 규칙(기대 version
// 충돌, 같은 재전송 key는 같은 결과)을 메모리에서 지킨다. 앱 쪽 대역은
// packages/sdk/cap-save의 createSaveStandIn이고, 이 대역은 broker 통로로 직접 온 요청을 같은 규칙으로
// 받는 server 쪽이다. 저장한 version은 preview 종료와 함께 사라진다.
import { err, ok } from "../../../../base/mod.ts";
import {
  brokerDocumentSaveInputSchema,
  type brokerDocumentSaveOutputSchema,
} from "../../../../protocol/apps/mod.ts";
import type { z } from "zod";
import type { DocumentSaveService } from "../../permissions/mod.ts";
import type { PreviewScope } from "../model.ts";
import { invalid, refuse, standInOnly } from "./refusal.ts";

type SaveOutput = z.infer<typeof brokerDocumentSaveOutputSchema>;

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

// preview 안에서만 뜻이 있는 version ID다. 형식만 documents의 `ver_`와 같다.
function versionId(counter: number): string {
  let rest = counter;
  let tail = "";
  while (tail.length < 26) {
    tail = ALPHABET[rest % 32] + tail;
    rest = Math.floor(rest / 32);
  }
  return `ver_${tail}`;
}

export type PreviewDocumentsService = DocumentSaveService & {
  readonly versions: ReadonlyMap<string, readonly string[]>;
};

export function createPreviewDocumentsService(
  scope: Pick<PreviewScope, "documents">,
): PreviewDocumentsService {
  const versions = new Map<string, string[]>();
  const retries = new Map<string, SaveOutput>();
  let counter = 0;
  return {
    versions,
    save(child, body) {
      const parsed = brokerDocumentSaveInputSchema.safeParse(body);
      if (!parsed.success) {
        return Promise.resolve(invalid("document save input is invalid"));
      }
      const input = parsed.data;
      const refused = standInOnly(child, "document.save", { key: input.key });
      if (refused) return Promise.resolve(refused);
      if (!scope.documents.includes(input.key)) {
        return Promise.resolve(refuse("document.save", { key: input.key }));
      }
      const retry = `${input.key}\u0000${input.idempotency_key}`;
      const known = retries.get(retry);
      if (known) return Promise.resolve(ok(known));
      const kept = versions.get(input.key) ?? [];
      if (input.base_version !== (kept.at(-1) ?? null)) {
        return Promise.resolve(err({
          code: "conflict",
          message: "base_version is not the latest version of this document",
        }));
      }
      counter += 1;
      const version = versionId(counter);
      versions.set(input.key, [...kept, version]);
      const result: SaveOutput = { saved: true, version };
      retries.set(retry, result);
      return Promise.resolve(ok(result));
    },
  };
}
