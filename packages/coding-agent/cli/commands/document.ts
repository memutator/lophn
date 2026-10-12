// read·document command의 route 표다. read는 고정 판 본문,
// document는 list·history·diff다. save는 파일 준비 뒤 document.save 접수라
// 나중에 채우는 자리다(지금은 표에 이름만 올라온다).
import {
  cliDocumentDiffSchema,
  cliDocumentHistorySchema,
  cliDocumentListSchema,
  cliReadSchema,
} from "../../../protocol/coding-agent/mod.ts";
import {
  documentDiff,
  documentHistory,
  documentList,
  documentRead,
} from "../../../protocol/projects/mod.ts";
import type { CommandEntry } from "./types.ts";

export const READ_COMMANDS: readonly CommandEntry[] = [
  {
    name: "read",
    input: cliReadSchema,
    monoRoute: documentRead,
  },
];

export const DOCUMENT_COMMANDS: readonly CommandEntry[] = [
  {
    name: "document list",
    input: cliDocumentListSchema,
    monoRoute: documentList,
  },
  {
    name: "document history",
    input: cliDocumentHistorySchema,
    monoRoute: documentHistory,
  },
  {
    name: "document diff",
    input: cliDocumentDiffSchema,
    monoRoute: documentDiff,
  },
];
