// annotation의 core 등록. writer가 command를, reader가 read를 가져가고 core 조립이 route handler를 붙인다.
import {
  annotationSend,
  annotationUploadScreenshot,
} from "../../../protocol/apps/annotation.ts";
import {
  defineTxPort,
  type ReaderRegistration,
} from "../../storage/ledger/mod.ts";
import { TicketAnnotationLookup } from "../tickets/ports.ts";
import { ANNOTATION_BLOB_FIELDS, ANNOTATION_BLOB_PURPOSES } from "./blobs.ts";
import { createAnnotationCommands } from "./commands.ts";
import { annotationLookup, createAnnotationReads } from "./reads.ts";
import { annotationSchemaSteps } from "./schema.ts";

const commands = createAnnotationCommands();
const reads = createAnnotationReads();

const annotationDefinitions = {
  schemaSteps: annotationSchemaSteps,
  blobFields: ANNOTATION_BLOB_FIELDS,
  blobPurposes: ANNOTATION_BLOB_PURPOSES,
  commands: [
    commands.persist,
    commands.discard,
    commands.addRefs,
    commands.sweep,
  ],
  reads: [reads.get],
  // handler는 core 조립(wiring/annotations.ts)이 route 이름으로 붙인다.
  memoryRoutes: [annotationSend],
  uploadRoutes: [annotationUploadScreenshot],
  // ticket이 근거 annotation을 같은 transaction에서 읽는다.
  ports: [
    defineTxPort(TicketAnnotationLookup, (tx) => annotationLookup(tx.sql)),
  ],
};

export function createCoreRegistration() {
  return annotationDefinitions;
}

// reader Worker가 read를 다시 조립한다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [reads.get],
    // 같은 port는 tickets 등록이 낸다(reader Worker가 모든 등록의 port를 모든 read에 준다).
    ports: new Map<unknown, unknown>(),
  };
}
