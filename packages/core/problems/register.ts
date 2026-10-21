import type {
  CommandDefinition,
  EventVisibilityDefinition,
  ReadDefinition,
  SchemaStep,
} from "../../protocol/server/mod.ts";
import type { EventDefinition } from "../../protocol/base/mod.ts";
import type {
  BlobFieldDefinition,
  defineBlobPurpose,
} from "../../protocol/storage/mod.ts";
import type { KindLaunchSpec } from "../../protocol/supervision/mod.ts";
import type {
  ReaderRegistration,
  TxPortRegistration,
} from "../storage/ledger/mod.ts";
import { testsPart } from "./tests/register.ts";

// leaf가 자기 register.ts에서 내는 등록 조각이다. 칸은 모두 선택이다.
export type ProblemsPart = {
  schema?: readonly SchemaStep[];
  blobFields?: readonly BlobFieldDefinition[];
  blobPurposes?: readonly ReturnType<typeof defineBlobPurpose>[];
  commands?: readonly CommandDefinition[];
  reads?: readonly ReadDefinition[];
  ports?: readonly TxPortRegistration[];
  workers?: readonly KindLaunchSpec[];
  events?: readonly EventDefinition[];
  visibility?: readonly EventVisibilityDefinition<EventDefinition>[];
  // reader Worker에 붙는 read.
  readerReads?: readonly ReadDefinition[];
};

// owner definitions만 내보낸다. port 구현과 writer 조립은 core가 맡는다.
export const problemsTestDefinitions = testsPart;

// reader Worker가 이 모듈을 import해 read를 reader 풀에 붙인다(#142).
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [...(testsPart.readerReads ?? [])],
    ports: new Map<unknown, unknown>(),
  };
}
