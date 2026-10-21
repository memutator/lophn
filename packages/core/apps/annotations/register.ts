// annotation의 core 등록. writer가 command를, reader가 read를 가져가고 core 조립이 route handler를 붙인다.
import {
  annotationSend,
  annotationUploadScreenshot,
} from "../../../protocol/apps/annotation.ts";
import { CodingSessionLookup } from "../../../protocol/coding-agent/token.ts";
import {
  type ReaderRegistration,
  snapshotPort,
} from "../../storage/ledger/mod.ts";
import { codingSessionLookup } from "../coding/lookup.ts";
import { ANNOTATION_BLOB_FIELDS, ANNOTATION_BLOB_PURPOSES } from "./blobs.ts";
import { createAnnotationCommands } from "./commands.ts";
import { createAnnotationReads } from "./reads.ts";
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
};

export function createCoreRegistration() {
  return annotationDefinitions;
}

// reader Worker가 read를 다시 조립한다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [reads.get],
    // coding agent의 annotations.get이 자기 앱을 이 port로 찾는다.
    ports: new Map<unknown, unknown>([
      [CodingSessionLookup, snapshotPort((s) => codingSessionLookup(s.sql))],
    ]),
  };
}
