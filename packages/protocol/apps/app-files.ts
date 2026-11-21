import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { sha256Schema } from "../base/values.ts";
import { appIdSchema } from "../projects/values.ts";
import {
  APP_FILE_MAX_BYTES,
  APP_FILE_PIECE_MAX_BYTES,
} from "./app-file-values.ts";
import { appToolTargetSchema } from "./calls/call.ts";

export * from "./app-file-values.ts";

// 앱 file은 앱의 data다(앱 data 영역의 `files/`). 지우는 route와 permission이 없다. 앱을 지우면 같이 없어진다.
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const contentType = z.string().min(1).max(127);
const base64 = z
  .string()
  .max(Math.ceil(APP_FILE_PIECE_MAX_BYTES / 3) * 4)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);

export const appFileHandleSchema = z.strictObject({
  file: sha256Schema,
  type: contentType,
  size: z.number().int().nonnegative().max(APP_FILE_MAX_BYTES),
  name: z.string().max(255).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

// 읽는 자리는 그 앱의 지금 file 자리(live)이거나 그 preview의 영역(preview)이다. file은 release에 묶이지 않아 live의 release는
// 보지 않는다. 다른 컴퓨터의 앱(remote)은 그 컴퓨터에 부른다.
const [live, preview] = appToolTargetSchema.options;
const appFileTargetSchema = z.discriminatedUnion("mode", [live, preview]);

// 한 조각을 읽는다. `size`는 file 전체의 크기이고 bytes는 `offset`부터 `length`까지(끝이면 그만큼 적다)다.
export const appFilesRead = defineMemory({
  resource: "app_files",
  method: "read",
  name: "app_files.read",
  input: z.strictObject({
    target: appFileTargetSchema,
    file: sha256Schema,
    offset: count,
    length: z.number().int().min(1).max(APP_FILE_PIECE_MAX_BYTES),
  }),
  output: z.strictObject({
    type: contentType,
    size: count,
    name: z.string().max(255).optional(),
    bytes_base64: base64,
  }),
  actors: ["user"],
  errors: ["invalid_input", "not_found"],
});

// file 하나를 조각으로 넣는다(live 앱만. preview는 stand-in을 쓴다). `offset`은 core가 이미 쥔 bytes와 정확히 같아야 하고
// 아니면 `invalid_input`이다(`details.received`가 쥔 bytes이고 보낸 쪽은 거기서 다시 보낸다). 다 차면 sha256과 크기를 확인해
// 맞지 않으면 쥔 bytes를 버리고 `invalid_input`이다. `have`는 이미 있는 file이라 아무것도 쓰지 않았다는 뜻이다. 빈 조각(`bytes_base64`가 빈 글, `size`가 0이 아닐 때)은 묻기다: 아무것도 쓰지 않고 `have`나 `partial`(`received`는 쥔 bytes)로 답한다.
// 조각 하나의 base64와 그 밖의 칸이 든다. 기본 JSON 한도(256 KiB)보다 크므로 route가 한도를 키운다.
export const APP_FILE_PUT_BODY_MAX_BYTES =
  Math.ceil(APP_FILE_PIECE_MAX_BYTES / 3) * 4 + 4096;

export const appFilesPut = defineMemory({
  body_max_bytes: APP_FILE_PUT_BODY_MAX_BYTES,
  resource: "app_files",
  method: "put",
  name: "app_files.put",
  input: z.strictObject({
    app: appIdSchema,
    file: sha256Schema,
    size: z.number().int().nonnegative().max(APP_FILE_MAX_BYTES),
    type: contentType,
    name: z.string().max(255).optional(),
    offset: count,
    bytes_base64: base64,
  }),
  output: z.strictObject({
    status: z.enum(["stored", "partial", "have"]),
    received: count,
  }),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "unavailable"],
});

export const APP_FILE_ROUTES = [appFilesRead, appFilesPut] as const;

export type AppFilesReadInput = z.infer<typeof appFilesRead.input>;
export type AppFilesPutInput = z.infer<typeof appFilesPut.input>;
