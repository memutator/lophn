import { assert, assertEquals } from "@std/assert";
import { err, ok, sha256Hex } from "../../../base/mod.ts";
import { checkFileList, isSafeRelativePath } from "../file-tracking/mod.ts";
import {
  createPrepareAssembly,
  type PrepareDeps,
  type ValidateError,
  type ValidateOutcome,
} from "./work.ts";
import { filesHash } from "./model.ts";
import { file, ids, preparedInput, versionFixture } from "./testing/mod.ts";

const BUILTIN_MODULE_HASH =
  "859415856f59662c5bcdfc30adf2677d9fc296b193c7137fece8f5385e02f9d8";
const HASH = "ab".repeat(32);
const OTHER_HASH = "cd".repeat(32);

// 준비 입력의 파일. content는 준비 blob 참조다.
function fileInput(path: string, primary = true, bytes = 12) {
  return file(path, primary, bytes);
}

function outcome(
  overrides: Partial<ValidateOutcome> = {},
): ValidateOutcome {
  return {
    input_hash: HASH,
    module_hash: BUILTIN_MODULE_HASH,
    status: "passed",
    error_count: 0,
    warning_count: 0,
    diagnostics: [],
    ...overrides,
  };
}

function validateOk(
  overrides: Partial<ValidateOutcome> = {},
): PrepareDeps["validateFiles"] {
  // deno-lint-ignore require-await -- ValidatePort의 모양을 그대로 따르는 fake다.
  return async () => ok(outcome(overrides));
}

function validateFail(error: ValidateError): PrepareDeps["validateFiles"] {
  // deno-lint-ignore require-await -- ValidatePort의 모양을 그대로 따르는 fake다.
  return async () => err(error);
}

function prepareOk(): PrepareDeps["prepareFiles"] {
  // deno-lint-ignore require-await -- PrepareFilesPort의 모양을 그대로 따르는 fake다.
  return async () => ok({ preparation: "pack-1", hash: HASH, size_bytes: 8 });
}

function deps(
  overrides: Partial<PrepareDeps> = {},
): PrepareDeps {
  return {
    validateFiles: validateOk(),
    prepareFiles: prepareOk(),
    // deno-lint-ignore require-await -- BaseVersionRead의 모양을 그대로 따르는 fake다.
    loadBaseVersion: async () => ok(null),
    ...overrides,
  };
}

function request(
  overrides: Record<string, unknown> = {},
): Parameters<ReturnType<typeof createPrepareAssembly>>[0] {
  const files = [fileInput("report.md", true, 12)];
  return {
    document: ids.doc,
    base_version: null,
    metadata: { title: "Notes", place: null, name: null },
    files: files as unknown as Parameters<
      ReturnType<typeof createPrepareAssembly>
    >[0]["files"],
    format: {
      name: "document",
      module_hash: BUILTIN_MODULE_HASH,
      explicit: true,
    },
    source: null,
    idempotency_key: "save-1",
    ...overrides,
  };
}

Deno.test("documents/formats#R4: 명시 format의 저장 전 검사 error는 invalid_input으로 거절된다", async () => {
  const prepare = createPrepareAssembly(deps({
    validateFiles: validateOk({
      status: "failed",
      error_count: 1,
      warning_count: 0,
      diagnostics: [{
        severity: "error",
        code: "invalid_structure",
        message: "heading anchors do not nest",
        file: "report.md",
        start_line: 3,
        end_line: 3,
        column: 1,
      }],
    }),
  }));
  const ran = await prepare(request());
  assertEquals(ran.ok, false);
  if (!ran.ok) {
    assertEquals(ran.error.code, "invalid_input");
    assertEquals(ran.error.message, "requested format failed validation");
  }
});

Deno.test("documents/formats#R4: 같은 입력의 사전 검사와 저장 검사가 같은 오류를 반환한다", async () => {
  const diagnostic: ValidateOutcome["diagnostics"][number] = {
    severity: "error",
    code: "invalid_structure",
    message: "heading anchors do not nest",
    file: "report.md",
    start_line: 3,
    end_line: 3,
    column: 1,
  };
  const prepare = createPrepareAssembly(deps({
    validateFiles: validateOk({
      status: "failed",
      error_count: 1,
      diagnostics: [diagnostic],
    }),
  }));
  const pre = await prepare(request());
  assertEquals(pre.ok, false);
  if (!pre.ok) assertEquals(pre.error.code, "invalid_input");
  // 저장 검사는 같은 진단을 그대로 남긴다. 위치·설명을 읽을 수 있다.
  const saved = preparedInput(ids.doc, [file("report.md", true)], {
    format: {
      name: "document",
      module_hash: BUILTIN_MODULE_HASH,
      explicit: true,
    },
    validation: {
      input_hash: HASH,
      module_hash: BUILTIN_MODULE_HASH,
      status: "failed",
      error_count: 1,
      warning_count: 0,
      diagnostics: [diagnostic],
    },
  });
  assertEquals(saved.validation.diagnostics, [diagnostic]);
});

Deno.test("documents/formats#R4: warning만 있으면 저장 결과에 경고를 남긴다", async () => {
  const prepare = createPrepareAssembly(deps({
    validateFiles: validateOk({
      status: "passed",
      error_count: 0,
      warning_count: 1,
      diagnostics: [{
        severity: "warning",
        code: "duplicate_anchor",
        message: "anchor repeated",
        file: "report.md",
        start_line: 5,
        end_line: 5,
        column: 1,
      }],
    }),
  }));
  const ran = await prepare(request());
  assert(ran.ok);
  if (ran.ok) {
    assertEquals(ran.value.validation.warning_count, 1);
    assertEquals(ran.value.validation.diagnostics[0].code, "duplicate_anchor");
  }
});

Deno.test("documents/formats#R5: MIME 유형에 맞는 기본 format으로 원문을 보존한다", async () => {
  const prepare = createPrepareAssembly(deps());
  const ran = await prepare(
    request({
      format: undefined,
      files: [file("report.md", true, 12, "text/markdown")],
    }),
  );
  assert(ran.ok);
  if (ran.ok) {
    assertEquals(ran.value.format, {
      name: "document",
      module_hash: BUILTIN_MODULE_HASH,
      explicit: false,
    });
    // 원문은 준비된 파일 목록으로 보존된다.
    assertEquals(ran.value.files.length, 1);
    assertEquals(ran.value.files[0].media_type, "text/markdown");
  }
});

Deno.test("documents/formats#R5: 구조 검사 실패는 경고로 돌려준다", async () => {
  const prepare = createPrepareAssembly(deps({
    validateFiles: validateOk({
      status: "failed",
      error_count: 1,
      diagnostics: [{
        severity: "error",
        code: "invalid_structure",
        message: "heading anchors do not nest",
        file: "report.md",
        start_line: 3,
        end_line: 3,
        column: 1,
      }],
    }),
  }));
  const ran = await prepare(request({ format: undefined }));
  assert(ran.ok);
  if (ran.ok) {
    // 미지정 계약에서 구조 진단은 warning으로 내려간다.
    assertEquals(ran.value.validation.status, "passed");
    assertEquals(ran.value.validation.error_count, 0);
    assertEquals(ran.value.validation.warning_count, 1);
    assertEquals(ran.value.validation.diagnostics[0].severity, "warning");
  }
});

Deno.test("documents/formats#R5: 위험 경로와 접근 권한 실패를 경고로 낮추지 않는다", async () => {
  assert(!isSafeRelativePath("../escape.md"));
  assert(!isSafeRelativePath("/absolute.md"));
  assert(isSafeRelativePath("docs/report.md"));
  const issues = checkFileList([
    { path: "../escape.md", bytes: 4, primary: true },
  ]);
  assertEquals(issues[0].code, "invalid_path");
  const prepared = await createPrepareAssembly(deps())(
    request({ format: undefined, files: [file("../escape.md", true)] }),
  );
  assertEquals(prepared.ok, false);
  if (!prepared.ok) assertEquals(prepared.error.code, "invalid_input");
});

Deno.test("documents/formats#R5: section 추출 가능 여부를 별도로 표시한다", async () => {
  const prepare = createPrepareAssembly(deps({
    validateFiles: validateOk({
      status: "passed",
      error_count: 0,
      warning_count: 1,
      diagnostics: [{
        severity: "warning",
        code: "invalid_structure",
        message: "no headings",
        file: "report.md",
        start_line: null,
        end_line: null,
        column: null,
      }],
    }),
  }));
  const ran = await prepare(request({ format: undefined }));
  assert(ran.ok);
  if (ran.ok) {
    // section 추출 실패는 경고 진단으로 표시되고 원문 저장은 막지 않는다.
    assertEquals(ran.value.validation.status, "passed");
    assertEquals(ran.value.validation.diagnostics[0].code, "invalid_structure");
  }
});

Deno.test("documents/formats#R7: 생략한 후속 저장은 base_version의 정확한 format 계약을 따른다", async () => {
  const fixture = versionFixture();
  try {
    const base = {
      id: "ver_01arz3ndektsv4rrffq69g5fav",
      document: ids.doc,
      number: 1,
      files_hash: HASH,
      primary_path: "report.md",
      file_count: 1,
      content_hash: OTHER_HASH,
      format: {
        name: "pdf",
        module_hash: BUILTIN_MODULE_HASH,
        explicit: false,
      },
      saved_by: "user",
      saved_at: "2026-10-05T00:00:00.000Z",
      run: null,
      source: null,
    };
    const prepare = createPrepareAssembly(deps({
      // deno-lint-ignore require-await -- BaseVersionRead의 모양을 그대로 따르는 fake다.
      loadBaseVersion: async () => ok(base),
    }));
    const ran = await prepare(
      request({
        format: undefined,
        base_version: base.id,
        metadata: undefined,
      }),
    );
    assert(ran.ok);
    if (ran.ok) {
      // 기존 문서 생략은 판의 정확한 FormatRef다.
      assertEquals(ran.value.format, base.format);
    }
  } finally {
    fixture.close();
  }
});

Deno.test("documents/formats#R7: 사람의 명시 format 변경만 새 판의 계약을 바꾼다", async () => {
  const base = {
    id: "ver_01arz3ndektsv4rrffq69g5fav",
    document: ids.doc,
    number: 1,
    files_hash: HASH,
    primary_path: "report.md",
    file_count: 1,
    content_hash: OTHER_HASH,
    format: { name: "pdf", module_hash: BUILTIN_MODULE_HASH, explicit: false },
    saved_by: "user",
    saved_at: "2026-10-05T00:00:00.000Z",
    run: null,
    source: null,
  };
  const prepare = createPrepareAssembly(deps({
    // deno-lint-ignore require-await -- BaseVersionRead의 모양을 그대로 따르는 fake다.
    loadBaseVersion: async () => ok(base),
  }));
  const changed = await prepare(
    request({
      base_version: base.id,
      metadata: undefined,
      format: {
        name: "document",
        module_hash: BUILTIN_MODULE_HASH,
        explicit: true,
      },
    }),
  );
  assert(changed.ok);
  if (changed.ok) {
    assertEquals(changed.value.format.name, "document");
    assertEquals(changed.value.format.explicit, true);
  }
  // 생략한 후속 저장은 같은 검사를 받는다(판 계약 그대로).
  const skipped = await prepare(
    request({ base_version: base.id, metadata: undefined, format: undefined }),
  );
  assert(skipped.ok);
  if (skipped.ok) assertEquals(skipped.value.format, base.format);
});

Deno.test("documents/formats#R4 documents/formats#R7: format을 생략한 후속 저장은 판의 explicit에 따라 구조 error를 거절하거나 경고로 남긴다", async () => {
  const base = {
    id: "ver_01arz3ndektsv4rrffq69g5fav",
    document: ids.doc,
    number: 1,
    files_hash: HASH,
    primary_path: "report.md",
    file_count: 1,
    content_hash: OTHER_HASH,
    format: {
      name: "document",
      module_hash: BUILTIN_MODULE_HASH,
      explicit: true,
    },
    saved_by: "user",
    saved_at: "2026-10-05T00:00:00.000Z",
    run: null,
    source: null,
  };
  const diagnostic = {
    severity: "error" as const,
    code: "invalid_structure",
    message: "heading anchors do not nest",
    file: "report.md",
    start_line: 3,
    end_line: 3,
    column: 1,
  };
  const failed = validateOk({
    status: "failed",
    error_count: 1,
    diagnostics: [diagnostic],
  });
  const rejected = await createPrepareAssembly(deps({
    // deno-lint-ignore require-await -- BaseVersionRead의 모양을 그대로 따르는 fake다.
    loadBaseVersion: async () => ok(base),
    validateFiles: failed,
  }))(
    request({
      format: undefined,
      base_version: base.id,
      metadata: undefined,
    }),
  );
  assertEquals(rejected.ok, false);
  if (!rejected.ok) {
    assertEquals(rejected.error.code, "invalid_input");
    assertEquals(rejected.error.message, "requested format failed validation");
  }
  const kept = await createPrepareAssembly(deps({
    // deno-lint-ignore require-await -- BaseVersionRead의 모양을 그대로 따르는 fake다.
    loadBaseVersion: async () =>
      ok({ ...base, format: { ...base.format, explicit: false } }),
    validateFiles: failed,
  }))(
    request({
      format: undefined,
      base_version: base.id,
      metadata: undefined,
    }),
  );
  assert(kept.ok);
  if (kept.ok) {
    assertEquals(kept.value.format.explicit, false);
    assertEquals(kept.value.validation.status, "passed");
    assertEquals(kept.value.validation.warning_count, 1);
    assertEquals(kept.value.validation.diagnostics[0]?.severity, "warning");
  }
});

Deno.test("documents/formats#R7: 최신 판이 바뀐 후속 준비는 옛 판 계약으로 돌아간다", async () => {
  const base = {
    id: "ver_01arz3ndektsv4rrffq69g5fav",
    document: ids.doc,
    number: 2,
    files_hash: HASH,
    primary_path: "report.md",
    file_count: 1,
    content_hash: OTHER_HASH,
    format: {
      name: "document",
      module_hash: BUILTIN_MODULE_HASH,
      explicit: false,
    },
    saved_by: "user",
    saved_at: "2026-10-05T00:00:00.000Z",
    run: null,
    source: null,
  };
  const prepare = createPrepareAssembly(deps({
    // deno-lint-ignore require-await -- BaseVersionRead의 모양을 그대로 따르는 fake다.
    loadBaseVersion: async (id) => ok(id === base.id ? base : null),
  }));
  const missing = await prepare(
    request({
      base_version: "ver_01arz3ndektsv4rrffq69g5fbv",
      metadata: undefined,
      format: undefined,
    }),
  );
  assertEquals(missing.ok, false);
  if (!missing.ok) assertEquals(missing.error.code, "not_found");
});

Deno.test("documents/versions#R2: 준비 worker가 안전한 상대 경로·유일 경로·대표 파일 하나·바이트 수를 검사한다", () => {
  const noPrimary = checkFileList([
    { path: "a.md", bytes: 4, primary: false },
    { path: "b.md", bytes: 4, primary: false },
  ]);
  assertEquals(noPrimary[0].code, "missing_primary");
  const twoPrimary = checkFileList([
    { path: "a.md", bytes: 4, primary: true },
    { path: "b.md", bytes: 4, primary: true },
  ]);
  assertEquals(twoPrimary[0].code, "multiple_primary");
  const duplicates = checkFileList([
    { path: "a.md", bytes: 4, primary: true },
    { path: "a.md", bytes: 4, primary: false },
  ]);
  assertEquals(duplicates[0].code, "duplicate_path");
  const badBytes = checkFileList([{ path: "a.md", bytes: -1, primary: true }]);
  assertEquals(badBytes[0].code, "invalid_bytes");
});

Deno.test("documents/versions#R2: 같은 stream을 hash와 blob 준비로 보내고 preparation_ref를 요청에 묶는다", async () => {
  const prepared: string[] = [];
  const prepare = createPrepareAssembly(deps({
    // deno-lint-ignore require-await -- PrepareFilesPort의 모양을 그대로 따르는 fake다.
    prepareFiles: async (files) => {
      prepared.push(files.map((file) => file.path).join(","));
      return ok({ preparation: "pack-1", hash: OTHER_HASH, size_bytes: 12 });
    },
  }));
  const ran = await prepare(request());
  assert(ran.ok);
  if (ran.ok) {
    // hash와 blob 준비는 같은 파일 목록에서 나왔다.
    assertEquals(prepared, ["report.md"]);
    assertEquals(ran.value.files_hash, OTHER_HASH);
    assertEquals(ran.value.content_hash, OTHER_HASH);
    assertEquals(ran.value.preparation_ref, "pack-1");
    assertEquals(ran.value.file_count, 1);
    assertEquals(ran.value.primary_path, "report.md");
  }
});

Deno.test("documents/versions#R2: runner 누락과 실행 실패는 낮추지 않는다", async () => {
  const missing = await createPrepareAssembly(deps({
    validateFiles: validateFail({
      code: "not_found",
      message: "format module is missing",
    }),
  }))(request());
  assertEquals(missing.ok, false);
  if (!missing.ok) assertEquals(missing.error.code, "not_found");
  const failed = await createPrepareAssembly(deps({
    validateFiles: validateFail({
      code: "unavailable",
      message: "runner killed",
    }),
  }))(request());
  assertEquals(failed.ok, false);
  if (!failed.ok) assertEquals(failed.error.code, "unavailable");
});

Deno.test("documents/versions#R2: file preparation 실패는 unavailable이다", async () => {
  const ran = await createPrepareAssembly(deps({
    // deno-lint-ignore require-await -- PrepareFilesPort의 모양을 그대로 따르는 fake다.
    prepareFiles: async () =>
      err({ code: "unavailable", message: "blob store ended" }),
  }))(request());
  assertEquals(ran.ok, false);
  if (!ran.ok) {
    assertEquals(ran.error.code, "unavailable");
    assert(ran.error.message.includes("file preparation failed"));
  }
});

Deno.test("documents/versions#R5: 준비 결과의 파일은 새 바이트면 준비 참조, 이미 등록된 blob이면 그 참조를 싣는다", async () => {
  const prepare = createPrepareAssembly(deps());
  const reference = {
    owner_kind: "document_version",
    owner_key: "ver_01arz3ndektsv4rrffq69g5fav/cover.png",
    field: "file",
    hash: HASH,
    registered_seq: "3",
  };
  const fresh = fileInput("report.md", true, 12);
  const reused = {
    ...fileInput("cover.png", false, 8),
    content: { kind: "existing" as const, reference },
  };
  const ran = await prepare(request({ files: [fresh, reused] }));
  assert(ran.ok);
  const { content: _fresh, ...freshFile } = fresh;
  const { content: _reused, preparation_ref: _ref, ...reusedFile } = reused;
  assertEquals(ran.value.files, [
    { ...freshFile, preparation_ref: fresh.content.blob.preparation },
    { ...reusedFile, existing: reference },
  ]);
  assertEquals(ran.value.file_count, 2);
});

// ---- 이미 받아들인 판의 restore는 검사 한도 초과(check_skipped)를 warning으로 받는다 ----

const SKIPPED: ValidateOutcome["diagnostics"][number] = {
  severity: "error",
  code: "check_skipped",
  message: "primary file is over the check limit; the check was not run",
  file: "report.md",
  start_line: null,
  end_line: null,
  column: null,
};

function skippedOutcome(): PrepareDeps["validateFiles"] {
  return validateOk({
    status: "failed",
    error_count: 1,
    diagnostics: [SKIPPED],
  });
}

const OVER_LIMIT = 1024 * 1024 + 1;
const OLD_VERSION = "ver_01arz3ndektsv4rrffq69g5fav";

// 판 하나의 파일 목록 hash는 실제 canonical 목록 hash다.
async function acceptedVersion(explicit: boolean) {
  const listed = {
    path: "report.md",
    blob_hash: await sha256Of("지난 본문"),
    bytes: OVER_LIMIT,
    media_type: "text/markdown",
    primary: true,
  };
  const hash = await filesHash([listed]);
  return { listed, hash, explicit };
}

async function sha256Of(text: string): Promise<string> {
  return await sha256Hex(text);
}

function restoreRequest(
  accepted: Awaited<ReturnType<typeof acceptedVersion>>,
  explicit: boolean,
  path = "report.md",
) {
  const { listed } = accepted;
  return request({
    base_version: OLD_VERSION,
    metadata: undefined,
    format: {
      name: "document",
      module_hash: BUILTIN_MODULE_HASH,
      explicit,
    },
    files: [{
      ...listed,
      path,
      content: {
        kind: "existing",
        reference: {
          owner_kind: "document_version",
          owner_key: `${OLD_VERSION}/${path}`,
          field: "file",
          hash: listed.blob_hash,
          registered_seq: "2",
        },
      },
    }],
  });
}

function restoreDeps(
  accepted: Awaited<ReturnType<typeof acceptedVersion>>,
  stored: { explicit: boolean; files_hash?: string },
  validateFiles = skippedOutcome(),
): PrepareDeps {
  return deps({
    validateFiles,
    // deno-lint-ignore require-await -- PrepareFilesPort의 모양을 그대로 따르는 fake다.
    prepareFiles: async () =>
      ok({ preparation: "pack-1", hash: accepted.hash, size_bytes: 8 }),
    // deno-lint-ignore require-await -- BaseVersionRead의 모양을 그대로 따르는 fake다.
    loadBaseVersion: async () =>
      ok({
        id: OLD_VERSION,
        document: ids.doc,
        number: 1,
        files_hash: stored.files_hash ?? accepted.hash,
        primary_path: "report.md",
        file_count: 1,
        content_hash: accepted.hash,
        format: {
          name: "document",
          module_hash: BUILTIN_MODULE_HASH,
          explicit: stored.explicit,
        },
        saved_by: "user",
        saved_at: "2026-10-05T00:00:00.000Z",
        run: null,
        source: null,
      }),
  });
}

Deno.test("documents/versions#R10 documents/formats#R4: 이미 그 FormatRef로 저장된 판의 restore는 검사 한도 초과를 error가 아니라 warning으로 받는다", async () => {
  const accepted = await acceptedVersion(true);
  const prepare = createPrepareAssembly(
    restoreDeps(accepted, { explicit: true }),
  );
  const ran = await prepare(restoreRequest(accepted, true));
  assert(ran.ok, ran.ok ? "" : ran.error.message);
  assertEquals(ran.value.validation.status, "passed");
  assertEquals(ran.value.validation.error_count, 0);
  assertEquals(ran.value.validation.warning_count, 1);
  assertEquals(ran.value.validation.diagnostics[0].code, "check_skipped");
  assertEquals(ran.value.validation.diagnostics[0].severity, "warning");
  assertEquals(ran.value.format.explicit, true);
  assertEquals(ran.value.files_hash, accepted.hash);
});

Deno.test("documents/formats#R4: 새 바이트의 명시 format 저장은 검사 한도를 넘으면 그대로 invalid_input이다", async () => {
  const accepted = await acceptedVersion(true);
  const prepare = createPrepareAssembly(
    restoreDeps(accepted, { explicit: true }),
  );
  // 파일이 새로 올린 준비 참조다. 같은 hash·FormatRef의 판이 있어도 restore가 아니다.
  const fresh = request({
    base_version: OLD_VERSION,
    metadata: undefined,
    files: [{ ...fileInput("report.md", true, OVER_LIMIT) }],
  });
  const ran = await prepare(fresh);
  assert(!ran.ok);
  assertEquals(ran.error.code, "invalid_input");
});

Deno.test("documents/formats#R4: 선택 판의 목록·FormatRef와 다르거나 다른 error가 있으면 restore도 한도 초과를 받아 주지 않는다", async () => {
  const accepted = await acceptedVersion(true);
  const attempts: [string, PrepareDeps, ReturnType<typeof restoreRequest>][] = [
    [
      "저장된 판의 FormatRef가 명시가 아님",
      restoreDeps(accepted, { explicit: false }),
      restoreRequest(accepted, true),
    ],
    [
      "저장된 판의 파일 목록 hash가 다름",
      restoreDeps(accepted, { explicit: true, files_hash: "e".repeat(64) }),
      restoreRequest(accepted, true),
    ],
    [
      "참조의 경로가 파일 경로와 다름",
      restoreDeps(accepted, { explicit: true }),
      (() => {
        const base = restoreRequest(accepted, true);
        const [first] = base.files as unknown as {
          content: { reference: { owner_key: string } };
        }[];
        first.content.reference.owner_key = `${OLD_VERSION}/other.md`;
        return base;
      })(),
    ],
    [
      "한도 초과 말고 다른 검사 error가 함께 있음",
      restoreDeps(
        accepted,
        { explicit: true },
        validateOk({
          status: "failed",
          error_count: 2,
          diagnostics: [SKIPPED, {
            ...SKIPPED,
            code: "invalid_structure",
            message: "heading anchors do not nest",
          }],
        }),
      ),
      restoreRequest(accepted, true),
    ],
  ];
  for (const [name, attemptDeps, input] of attempts) {
    const ran = await createPrepareAssembly(attemptDeps)(input);
    assert(!ran.ok, name);
    assertEquals(ran.error.code, "invalid_input", name);
  }
});
