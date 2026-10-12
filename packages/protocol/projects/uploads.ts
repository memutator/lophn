import { z } from "zod";
import {
  defineUpload,
  preparedBlobSchema,
  sha256Schema,
} from "../server/mod.ts";

// 한 파일의 상한은 architecture 조절값이다. 도메인 원문 크기 제한이 아니고 blob 준비의
// 1GiB 안에서 정한다.
export const DOCUMENT_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;

// 제출할 파일 하나의 바이트를 core의 blob 준비로 보낸다. 호출자가 아는 hash·크기를
// 입력으로 주고, 준비는 실제 바이트가 이와 같을 때만 성공한다. 준비된 참조는 이어지는
// document.prepare의 파일 입력(content)으로 쓴다. 주체는 요청 credential이다. 앱은 자기 출력의
// 준비 참조를 자기 app credential로 받아야 document.save가 같은 주체로 등록한다(documents#T31).
export const documentUpload = defineUpload({
  resource: "documents",
  method: "upload",
  name: "document.upload",
  input: z.strictObject({
    blob_hash: sha256Schema,
    bytes: z.number().int().min(0).max(DOCUMENT_UPLOAD_MAX_BYTES),
  }),
  output: z.object(preparedBlobSchema.shape),
  actors: ["user", "coding_agent", "app"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
  max_bytes: DOCUMENT_UPLOAD_MAX_BYTES,
});

export const UPLOAD_ROUTES = [documentUpload] as const;
