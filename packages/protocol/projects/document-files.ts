import { z } from "zod";
import { blobRefRegistrationSchema } from "../storage/blob.ts";
import { contentFileSchema } from "./versions.ts";

// principal·scope·owner_key·field와 prepared blob TTL은 worker가 신뢰 참조로 검증한다.
// hash만으로는 신규 원문을 받지 않는다.
export const documentFileInputSchema = z.strictObject({
  ...contentFileSchema.shape,
  content: blobRefRegistrationSchema.shape.source,
}).refine(
  (file) =>
    file.content.kind === "prepared"
      ? file.content.blob.purpose === "document_file" &&
        file.content.blob.hash === file.blob_hash &&
        file.content.blob.size_bytes === file.bytes
      : file.content.reference.hash === file.blob_hash,
  { message: "content must match the authenticated blob" },
);
export type DocumentFileInput = z.infer<typeof documentFileInputSchema>;

export const documentFilesInputSchema = z.array(documentFileInputSchema).min(1)
  .refine(
    (files) =>
      files.filter((file) => file.primary).length === 1 &&
      new Set(files.map((file) => file.path)).size === files.length,
    { message: "files need unique paths and exactly one primary" },
  );
