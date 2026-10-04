import { assert, assertEquals } from "@std/assert";
import {
  documentArchived,
  documentCreated,
  documentMoved,
  documentRenamed,
  documentRestored,
  documentSaved,
  documentSourceChanged,
  documentUnarchived,
  documentUpdated,
} from "./document-events.ts";
import {
  basis,
  doc,
  fileSource,
  format,
  hash,
  metadata,
  place,
  previous,
  run,
  version,
} from "./document-fixtures.ts";

Deno.test("documents/versions#R1: the first save emits document and version facts", () => {
  assertEquals(documentCreated.subject.parse(doc), doc);
  assert(
    documentCreated.payload.safeParse({
      place,
      name: "report",
      title: metadata.title,
      file_source: basis.file_source,
      version,
    }).success,
  );
  assert(
    !documentCreated.payload.safeParse({
      place,
      name: null,
      title: metadata.title,
      file_source: null,
      version,
    }).success,
  );
});

Deno.test("documents/versions#R6: a saved version carries content, format and source", () => {
  assert(
    documentSaved.payload.safeParse({
      version,
      previous_version: null,
      content_hash: hash,
      format,
      source: fileSource,
    }).success,
  );
  assert(
    documentSaved.payload.safeParse({
      version,
      previous_version: null,
      content_hash: hash,
      format,
      source: fileSource,
      run,
    }).success,
  );
});

Deno.test("documents/versions#R10: restore names the chosen, previous and new versions", () => {
  assert(
    documentRestored.payload.safeParse({
      restore_version: previous,
      previous_version: version,
      version,
    }).success,
  );
  assert(
    !documentRestored.payload.safeParse({
      restore_version: previous,
      previous_version: null,
      version,
    }).success,
  );
});

Deno.test("documents/versions#R11: archive, source and place events keep their payloads", () => {
  assert(
    documentUpdated.payload.safeParse({
      before_title: "이전",
      title: "이후",
      before_revision: "7",
    }).success,
  );
  assert(
    documentSourceChanged.payload.safeParse({
      before_source: basis.file_source,
      source: null,
      before_revision: "7",
    }).success,
  );
  assert(documentArchived.payload.safeParse({ before_revision: "7" }).success);
  assert(
    documentUnarchived.payload.safeParse({ before_revision: "7" }).success,
  );
  assert(
    documentMoved.payload.safeParse({
      before_place: place,
      before_name: "report",
      place: null,
      name: null,
      before_revision: "7",
    }).success,
  );
  assert(
    !documentMoved.payload.safeParse({
      before_place: place,
      before_name: null,
      place: null,
      name: null,
      before_revision: "7",
    }).success,
  );
  assert(
    documentRenamed.payload.safeParse({
      place,
      before_name: "report",
      name: "weekly",
      before_revision: "7",
    }).success,
  );
});
