import { assert, assertEquals } from "@std/assert";
import {
  bundledGuideSchema,
  guideGet,
  guideList,
  guideOutline,
  guideRead,
  guideReadResultSchema,
} from "./guides.ts";
import {
  file,
  format,
  guideRef,
  hash,
  meta,
  read,
  section,
} from "./read-fixtures.ts";

Deno.test("documents/outline-and-search#R1 T18: bundled guide manifest is installation-fixed relative and offline read-only", () => {
  const guide = {
    ...guideRef,
    title: "읽기 안내",
    files: [{ ...file, future: true }],
  };
  assert(bundledGuideSchema.safeParse(guide).success);
  assert(
    !guideList.output.safeParse({
      ...meta,
      lophn_version: guideRef.lophn_version,
      guides: [guide, guide],
    }).success,
  );
  assert(
    guideList.output.safeParse({
      ...meta,
      lophn_version: guideRef.lophn_version,
      guides: [guide, { ...guide, title: "다른 안내" }],
    }).success,
  );
  const { title: _title, ...withoutTitle } = guideRef;
  for (const route of [guideGet, guideOutline, guideRead]) {
    assert(
      !route.input.safeParse({ reference: withoutTitle, path: file.path })
        .success,
    );
  }
  assert(
    guideList.output.safeParse({
      ...meta,
      lophn_version: guideRef.lophn_version,
      guides: [guide],
    }).success,
  );
  assert(
    !guideList.output.safeParse({
      ...meta,
      lophn_version: "different",
      guides: [guide],
    }).success,
  );
  assert(
    !bundledGuideSchema.safeParse({
      ...guide,
      files: [{ ...file, path: "/installation/guide.md" }],
    }).success,
  );
  assert(
    !guideGet.input.safeParse({ reference: { ...guideRef, place: "system" } })
      .success,
  );
  for (const route of [guideList, guideGet, guideOutline, guideRead]) {
    assertEquals(route.kind, "worker");
  }
});
Deno.test("documents/outline-and-search#R6 R26 T18: guide section projection needs no Document or Version id", () => {
  const { version: _version, ...guideSection } = section;
  const page = {
    ...meta,
    reference: guideRef,
    path: file.path,
    format,
    module_hash: hash,
    section_status: "whole",
    entries: [guideSection],
    failure_reason: null,
    file: null,
  };
  assert(guideOutline.output.safeParse(page).success);
  const unverified = {
    ...page,
    entries: [],
    section_status: "unverified",
    failure_reason: "extraction failed",
    file: { ...file, reference: guideRef },
  };
  assert(guideOutline.output.safeParse(unverified).success);
  assert(!guideOutline.output.safeParse({ ...unverified, file: null }).success);
  assert(
    !guideOutline.output.safeParse({ ...unverified, failure_reason: null })
      .success,
  );
  assert(
    !guideOutline.output.safeParse({
      ...unverified,
      complete: false,
      next_cursor: "opaque",
    }).success,
  );
  assert(
    !guideOutline.output.safeParse({
      ...unverified,
      file: {
        ...unverified.file,
        reference: { ...guideRef, title: "다른 안내" },
      },
    }).success,
  );
  assert(
    !guideOutline.output.safeParse({
      ...unverified,
      file: { ...unverified.file, path: "other.md" },
    }).success,
  );
  assert(
    !guideOutline.output.safeParse({
      ...page,
      entries: [{ ...guideSection, estimated_tokens: 1 }],
    }).success,
  );
  assert(!guideOutline.output.safeParse({ ...page, complete: false }).success);
  assert(
    guideOutline.input.safeParse({ reference: guideRef, path: file.path })
      .success,
  );
});
Deno.test("documents/outline-and-search#R7 R8 R22 T18: guide read binds same installation hash and file reference", () => {
  const value = {
    ...meta,
    reference: guideRef,
    path: file.path,
    format,
    module_hash: hash,
    section: null,
    section_status: "whole",
    include_children: false,
    ranges: read.ranges,
    text: "안내",
    file: null,
    redacted: false,
    failure_reason: null,
    omission_reason: null,
  };
  assert(guideReadResultSchema.safeParse(value).success);
  const unsupported = {
    ...value,
    section_status: "unsupported",
    ranges: [],
    text: null,
    file: { ...file, reference: guideRef },
  };
  assert(guideReadResultSchema.safeParse(unsupported).success);
  assert(
    !guideReadResultSchema.safeParse({
      ...unsupported,
      complete: false,
      next_cursor: "opaque",
    }).success,
  );
  assert(
    !guideReadResultSchema.safeParse({
      ...unsupported,
      file: {
        ...unsupported.file,
        reference: { ...guideRef, title: "다른 안내" },
      },
    }).success,
  );
  const failed = {
    ...unsupported,
    section_status: "unverified",
    failure_reason: "extraction failed",
  };
  assert(guideReadResultSchema.safeParse(failed).success);
  assert(!guideReadResultSchema.safeParse({ ...failed, file: null }).success);
  assert(
    !guideReadResultSchema.safeParse({ ...failed, failure_reason: null })
      .success,
  );
  assert(
    !guideReadResultSchema.safeParse({
      ...unsupported,
      file: {
        ...unsupported.file,
        reference: { ...guideRef, content_hash: "b".repeat(64) },
      },
    }).success,
  );
  assert(
    !guideReadResultSchema.safeParse({ ...unsupported, file: null }).success,
  );
  assert(
    !guideReadResultSchema.safeParse({ ...value, complete: false }).success,
  );
  assert(
    guideReadResultSchema.safeParse({
      ...value,
      complete: false,
      next_cursor: "guide-line-position",
    }).success,
  );
  assert(
    !guideRead.input.safeParse({ reference: guideRef, path: "../guide.md" })
      .success,
  );
  assert(
    !guideRead.input.safeParse({
      reference: guideRef,
      path: file.path,
      document: "system",
    }).success,
  );
});
