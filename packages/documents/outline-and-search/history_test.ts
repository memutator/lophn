// documents/outline-and-search#R19·R20·R21: section 이력과 두 판의 줄 diff. ledger는 실제 versions
// 표와 save command로 판을 쌓고, derived store는 실제 파일 SQLite에 추출 결과를 심는다. 판의
// 바이트·content hash·section body hash는 모두 실제 sha256이다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, sha256Hex } from "../../base/mod.ts";
import {
  diffPageSchema,
  sectionHistoryPageSchema,
} from "../../contracts/documents/mod.ts";
import { BUILTIN_MODULE_HASH } from "../formats/mod.ts";
import { createVersionCommands, filesHash } from "../versions/mod.ts";
import { keep, userContext, versionFixture } from "../versions/testing/mod.ts";
import { openDerived, openDerivedRead } from "./adapters/store.ts";
import { type ExtractionRecord, recordExtraction } from "./extraction.ts";
import {
  createHistoryHandlers,
  type DiffInput,
  type HistoryHandlerDeps,
  SECTION_HISTORY_PAGE,
} from "./history-reads.ts";
import { OMISSION_UNSUPPORTED, OMISSION_UNVERIFIED } from "./work.ts";

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const OTHER = "doc_01arz3ndektsv4rrffq69g5faw";
const ABSENT = "doc_01arz3ndektsv4rrffq69g5fb9";
const FORMAT = {
  name: "document",
  module_hash: BUILTIN_MODULE_HASH,
  explicit: false,
};
const commands = createVersionCommands();
const encoder = new TextEncoder();
const CTX = {
  principal: "person",
  actor: "user" as const,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "current",
};

// `## 이름` 제목마다 section을 만든다. 본문은 제목 다음 줄부터 다음 제목 앞 줄까지고
// body_hash는 그 본문의 실제 sha256이다(제목 줄은 own_ranges에 없다).
async function sectionsOf(
  text: string,
): Promise<ExtractionRecord["extraction"]["sections"]> {
  const lines = text.split("\n");
  const heads: { key: string; line: number }[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith("## ")) {
      heads.push({ key: line.slice(3), line: index + 1 });
    }
  });
  const sections: NonNullable<ExtractionRecord["extraction"]["sections"]> = [];
  for (let index = 0; index < heads.length; index++) {
    const head = heads[index];
    const end = (heads[index + 1]?.line ?? lines.length + 1) - 1;
    const body = lines.slice(head.line, end).join("\n");
    sections.push({
      key: head.key,
      title: head.key,
      parent: null,
      position: index,
      level: 2,
      anchor: null,
      own_ranges: [{ start_line: head.line + 1, end_line: end }],
      subtree_range: { start_line: head.line, end_line: end },
      characters: [...body].length,
      body_hash: await sha256Hex(body),
    });
  }
  return sections;
}

function open() {
  const fixture = versionFixture();
  const directory = fixture.path.slice(0, fixture.path.lastIndexOf("/"));
  const path = `${directory}/documents.sqlite`;
  const writer = openDerived(path);
  assert(writer.ok);
  const reader = openDerivedRead(path);
  assert(reader.ok);
  let seq = 0;
  const subject = {
    fixture,
    writer: writer.value,
    derived: reader.value,
    // 판 하나를 실제 save로 쌓는다. 같은 바이트의 파일 하나(plan.md)다.
    async save(
      text: string,
      options: { document?: string; base?: string | null } = {},
    ): Promise<{ version: string; content_hash: string; text: string }> {
      const document = options.document ?? DOC;
      const bytes = encoder.encode(text);
      const files = [{
        path: "plan.md",
        blob_hash: await sha256Hex(bytes),
        bytes: bytes.length,
        media_type: "text/markdown",
        primary: true,
      }];
      const hash = await filesHash(files);
      seq += 1;
      const base = options.base ?? null;
      const prepared = {
        document,
        base_version: base,
        files_hash: hash,
        file_count: 1,
        primary_path: "plan.md",
        content_hash: hash,
        preparation_ref: `prep-${seq}`,
        idempotency_key: `save-${seq}`,
        ...(base === null
          ? { metadata: { title: "계획서", place: null, name: null } }
          : {}),
        format: FORMAT,
        validation: {
          input_hash: hash,
          module_hash: BUILTIN_MODULE_HASH,
          status: "passed",
          error_count: 0,
          warning_count: 0,
          diagnostics: [],
        },
        source: null,
        files: files.map((file) => ({
          ...file,
          preparation_ref: `prep-file-${seq}`,
        })),
      };
      const saved = keep(
        fixture.transaction((tx) =>
          commands.save.handle(tx, userContext(), prepared as never, {
            base_version: base,
          })
        ),
      );
      return { version: saved.version, content_hash: hash, text };
    },
    // 그 판의 추출 결과를 derived store에 심는다.
    async extract(
      document: string,
      saved: { version: string; content_hash: string; text: string },
      status: ExtractionRecord["extraction"]["status"] = "ready",
    ) {
      const record: ExtractionRecord = {
        document,
        version: saved.version,
        content_hash: saved.content_hash,
        module_hash: BUILTIN_MODULE_HASH,
        extraction: status === "ready"
          ? {
            status,
            title: "계획서",
            text: saved.text,
            text_hash: await sha256Hex(saved.text),
            sections: await sectionsOf(saved.text),
          }
          : status === "failed"
          ? { status, failure_reason: "module crashed" }
          : { status },
      };
      const written = recordExtraction(subject.writer, record, "1");
      assert(written.ok);
    },
    // 판을 쌓고 곧바로 추출까지 끝낸다.
    async both(
      text: string,
      options: { document?: string; base?: string | null } = {},
    ) {
      const saved = await subject.save(text, options);
      await subject.extract(options.document ?? DOC, saved);
      return saved;
    },
    deps(extra: Partial<HistoryHandlerDeps> = {}): HistoryHandlerDeps {
      const snapshot = fixture.snapshot();
      return { read: subject.derived, snapshot, ports: snapshot, ...extra };
    },
    handlers(extra: Partial<HistoryHandlerDeps> = {}) {
      return createHistoryHandlers(subject.deps(extra));
    },
    close() {
      subject.writer.close();
      fixture.close();
    },
  };
  return subject;
}

function planText(plan: string, overview = "그대로 두는 개요"): string {
  return `# 계획서\n\n## 개요\n${overview}\n\n## 계획\n${plan}\n`;
}

Deno.test("documents/outline-and-search#R19: section 이력은 같은 key의 추가·본문 수정·변경 없음·소실을 판마다 낸다", async () => {
  const subject = open();
  try {
    const one = await subject.both(planText("처음 계획"));
    const two = await subject.both(planText("고친 계획"), {
      base: one.version,
    });
    // 세 번째 판은 개요만 고친다. 계획 section은 그대로다.
    const three = await subject.both(planText("고친 계획", "개요를 고침"), {
      base: two.version,
    });
    const four = await subject.both("# 계획서\n\n## 개요\n개요를 고침\n", {
      base: three.version,
    });
    const page = keep(
      subject.handlers().sectionHistory(CTX, {
        document: DOC,
        section: "계획",
      }),
    );
    assertEquals(
      page.entries.map((entry) => [entry.version, entry.status]),
      [
        [one.version, "added"],
        [two.version, "modified"],
        [three.version, "unchanged"],
        [four.version, "missing"],
      ],
    );
    assertEquals(page.omissions, []);
    assertEquals(page.complete, true);
    assertEquals(page.next_cursor, null);
    // 수정 행은 직전 판과 그 판의 body_hash를 가진다.
    const modified = page.entries[1];
    assertEquals(modified.before?.version, one.version);
    assertEquals(modified.after.version, two.version);
    assert(modified.before?.body_hash !== modified.after.body_hash);
    assertEquals(modified.before?.module_hash, BUILTIN_MODULE_HASH);
    // 소실 행은 앞 판의 hash와 비어 있는 뒤 판을 가진다.
    assertEquals(page.entries[3].after.body_hash, null);
    // 첫 판의 추가는 앞 판이 없다.
    assertEquals(page.entries[0].before, null);
    assert(sectionHistoryPageSchema.safeParse(page).success);
    // 바뀌지 않은 section은 추가 뒤 변경 없음뿐이다.
    const overview = keep(
      subject.handlers().sectionHistory(CTX, {
        document: DOC,
        section: "개요",
      }),
    );
    assertEquals(
      overview.entries.map((entry) => entry.status),
      ["added", "unchanged", "modified", "unchanged"],
    );
  } finally {
    subject.close();
  }
});

Deno.test("documents/outline-and-search#R19: 이름을 바꾸면 옛 key 소실과 새 key 추가고 같은 본문이어도 대응하지 않는다", async () => {
  const subject = open();
  try {
    const one = await subject.both("# 계획서\n\n## 옛 이름\n같은 본문\n");
    const two = await subject.both("# 계획서\n\n## 새 이름\n같은 본문\n", {
      base: one.version,
    });
    const handlers = subject.handlers();
    const old = keep(
      handlers.sectionHistory(CTX, { document: DOC, section: "옛 이름" }),
    );
    assertEquals(
      old.entries.map((entry) => [entry.version, entry.status]),
      [[one.version, "added"], [two.version, "missing"]],
    );
    const renamed = keep(
      handlers.sectionHistory(CTX, { document: DOC, section: "새 이름" }),
    );
    assertEquals(
      renamed.entries.map((entry) => [entry.version, entry.status]),
      [[two.version, "added"]],
    );
    // 새 key의 추가 행은 옛 key의 판을 앞으로 가리키지 않는다.
    assertEquals(renamed.entries[0].before, null);
    // 어느 판에도 없는 key는 행도 누락도 없다.
    const never = keep(
      handlers.sectionHistory(CTX, { document: DOC, section: "없는 이름" }),
    );
    assertEquals(never.entries, []);
    assertEquals(never.omissions, []);
  } finally {
    subject.close();
  }
});

Deno.test("documents/outline-and-search#R20: 이력을 중간 판부터 잘라도 첫 행은 직전 판과 비교한다", async () => {
  const subject = open();
  try {
    const one = await subject.both(planText("하나"));
    const two = await subject.both(planText("둘"), { base: one.version });
    const three = await subject.both(planText("셋"), { base: two.version });
    const four = await subject.both(planText("셋", "\n"), {
      base: three.version,
    });
    const cropped = keep(
      subject.handlers().sectionHistory(CTX, {
        document: DOC,
        section: "계획",
        from: three.version,
      }),
    );
    assertEquals(
      cropped.entries.map((entry) => [entry.version, entry.status]),
      [[three.version, "modified"], [four.version, "unchanged"]],
    );
    // 첫 행의 앞 판은 조회 시작보다 앞선 판이다.
    assertEquals(cropped.entries[0].before?.version, two.version);
    assert(sectionHistoryPageSchema.safeParse(cropped).success);
    // to로 끝을 자르면 그 뒤 판은 오지 않는다.
    const head = keep(
      subject.handlers().sectionHistory(CTX, {
        document: DOC,
        section: "계획",
        to: two.version,
      }),
    );
    assertEquals(head.entries.map((entry) => entry.version), [
      one.version,
      two.version,
    ]);
    // from이 to보다 뒤면 거절한다.
    const reversed = subject.handlers().sectionHistory(CTX, {
      document: DOC,
      section: "계획",
      from: three.version,
      to: one.version,
    });
    assert(!reversed.ok);
    assertEquals(reversed.error.code, "invalid_input");
  } finally {
    subject.close();
  }
});

Deno.test("documents/outline-and-search#R20: 판이 많으면 page 경계에서도 다음 page 첫 행이 직전 판과 비교된다", async () => {
  const subject = open();
  try {
    let base: string | null = null;
    const versions: string[] = [];
    const total = SECTION_HISTORY_PAGE + 3;
    for (let index = 0; index < total; index++) {
      const saved: { version: string; content_hash: string; text: string } =
        await subject.both(
          planText(`계획 ${index}`),
          { base },
        );
      versions.push(saved.version);
      base = saved.version;
    }
    const handlers = subject.handlers();
    const first = keep(
      handlers.sectionHistory(CTX, { document: DOC, section: "계획" }),
    );
    assertEquals(first.entries.length, SECTION_HISTORY_PAGE);
    assertEquals(first.complete, false);
    assert(first.next_cursor !== null);
    const second = keep(handlers.sectionHistory(CTX, {
      document: DOC,
      section: "계획",
      cursor: first.next_cursor,
    }));
    assertEquals(
      second.entries.map((entry) => entry.version),
      versions.slice(SECTION_HISTORY_PAGE),
    );
    assertEquals(second.entries[0].status, "modified");
    assertEquals(
      second.entries[0].before?.version,
      versions[SECTION_HISTORY_PAGE - 1],
    );
    assertEquals(second.complete, true);
    // 다른 조건의 cursor는 쓰지 못한다.
    const other = handlers.sectionHistory(CTX, {
      document: DOC,
      section: "개요",
      cursor: first.next_cursor,
    });
    assert(!other.ok);
    assertEquals(other.error.code, "invalid_input");
  } finally {
    subject.close();
  }
});

Deno.test("documents/outline-and-search#R22: 확인하지 못한 판은 section을 추정하지 않고 누락으로 밝힌다(검사 한도를 넘은 큰 판 포함)", async () => {
  const subject = open();
  try {
    const one = await subject.both(planText("하나"));
    // 검사 한도(1 MiB)를 넘는 실제 큰 본문. consumer는 이런 판을 확인하지 못한 판으로 남긴다.
    const big = planText(`${"가".repeat(1_100_000)}`);
    const two = await subject.save(big, { base: one.version });
    await subject.extract(DOC, two, "unverified");
    const three = await subject.both(planText("셋"), { base: two.version });
    const four = await subject.save(planText("넷"), { base: three.version });
    await subject.extract(DOC, four, "unsupported");
    const five = await subject.save(planText("다섯"), { base: four.version });
    await subject.extract(DOC, five, "failed");
    const six = await subject.save(planText("여섯"), { base: five.version });
    // six는 추출 기록이 아예 없다(consumer 지연).
    const page = keep(
      subject.handlers().sectionHistory(CTX, {
        document: DOC,
        section: "계획",
      }),
    );
    // 앞뒤가 모두 확인된 비교만 행이 되고 나머지는 판마다 이유와 함께 누락이다.
    assertEquals(
      page.entries.map((entry) => [entry.version, entry.status]),
      [[one.version, "added"]],
    );
    const reasons = new Map(
      page.omissions.map((item) => [item.version, item.reason]),
    );
    assertEquals(reasons.get(two.version), OMISSION_UNVERIFIED);
    assertEquals(reasons.get(four.version), OMISSION_UNSUPPORTED);
    assertEquals(reasons.get(five.version), "module crashed");
    assertEquals(reasons.get(six.version), OMISSION_UNVERIFIED);
    assertEquals(reasons.has(three.version), false);
    assert(
      page.omissions.every((item) =>
        item.section === "계획" && item.ranges.length === 0
      ),
    );
    assert(sectionHistoryPageSchema.safeParse(page).success);
  } finally {
    subject.close();
  }
});

Deno.test("documents/outline-and-search#R22: 판의 내용 hash와 맞지 않는 낡은 derived 결과는 쓰지 않는다", async () => {
  const subject = open();
  try {
    const one = await subject.save(planText("하나"));
    // 다른 내용의 hash로 심은 추출(복원 뒤 낡은 derived)은 이 판의 구조가 아니다.
    const stale = recordExtraction(subject.writer, {
      document: DOC,
      version: one.version,
      content_hash: await sha256Hex("다른 판"),
      module_hash: BUILTIN_MODULE_HASH,
      extraction: {
        status: "ready",
        title: "계획서",
        text: one.text,
        text_hash: await sha256Hex(one.text),
        sections: await sectionsOf(one.text),
      },
    }, "1");
    assert(stale.ok);
    const page = keep(
      subject.handlers().sectionHistory(CTX, {
        document: DOC,
        section: "계획",
      }),
    );
    assertEquals(page.entries, []);
    assertEquals(page.omissions.map((item) => item.reason), [
      OMISSION_UNVERIFIED,
    ]);
  } finally {
    subject.close();
  }
});

Deno.test("documents/outline-and-search#R19: 권한 밖 문서와 없는 문서와 다른 문서의 판은 같은 not_found다", async () => {
  const subject = open();
  try {
    const one = await subject.both(planText("하나"));
    // 권한이 없는 다른 문서도 ledger에 있다.
    const foreign = await subject.both(planText("남의 글"), {
      document: OTHER,
    });
    subject.fixture.use((_ctx, _operation, target) =>
      String((target as { document?: string }).document) === DOC
        ? ok(undefined)
        : err({ code: "forbidden", message: "no" })
    );
    const handlers = subject.handlers();
    const answers = [
      handlers.sectionHistory(CTX, { document: OTHER, section: "계획" }),
      handlers.sectionHistory(CTX, { document: ABSENT, section: "계획" }),
      handlers.sectionHistory(CTX, {
        document: DOC,
        section: "계획",
        from: foreign.version,
      }),
      handlers.diff(CTX, {
        document: OTHER,
        before: foreign.version,
        after: foreign.version,
      }),
      handlers.diff(CTX, {
        document: ABSENT,
        before: one.version,
        after: one.version,
      }),
      handlers.diff(CTX, {
        document: DOC,
        before: foreign.version,
        after: one.version,
      }),
    ];
    for (const answer of answers) {
      assert(!answer.ok);
      assertEquals(answer.error.code, "not_found");
    }
    assertEquals(
      new Set(answers.map((answer) => !answer.ok && answer.error.message)).size,
      1,
    );
  } finally {
    subject.close();
  }
});

Deno.test("documents/outline-and-search#R21: 두 판 전체 diff는 추가·삭제 줄을 각 판의 줄 번호로 낸다", async () => {
  const subject = open();
  try {
    const one = await subject.both(
      "# 계획서\n\n## 개요\n옛 줄\n그대로\n\n## 계획\n지울 줄\n",
    );
    const two = await subject.both(
      "# 계획서\n\n## 개요\n새 줄\n그대로\n\n## 계획\n지울 줄\n끝에 붙인 줄\n둘째로 붙인 줄\n",
      {
        base: one.version,
      },
    );
    const page = keep(
      subject.handlers().diff(CTX, {
        document: DOC,
        before: one.version,
        after: two.version,
      }),
    );
    assertEquals(page.deletions, [{
      range: { start_line: 4, end_line: 4 },
      text: "옛 줄",
    }]);
    assertEquals(page.additions, [
      { range: { start_line: 4, end_line: 4 }, text: "새 줄" },
      {
        range: { start_line: 9, end_line: 10 },
        text: "끝에 붙인 줄\n둘째로 붙인 줄",
      },
    ]);
    // 줄 끝에 붙은 개행 때문에 마지막 빈 줄이 하나 같이 달라진다.
    assertEquals(page.omissions, []);
    assertEquals(page.complete, true);
    assertEquals(page.section, null);
    assertEquals(page.before.version, one.version);
    assertEquals(page.after.version, two.version);
    assertEquals(page.after.module_hash, BUILTIN_MODULE_HASH);
    assert(diffPageSchema.safeParse(page).success);
    // 같은 판끼리는 바뀐 것이 없다.
    const same = keep(
      subject.handlers().diff(CTX, {
        document: DOC,
        before: two.version,
        after: two.version,
      }),
    );
    assertEquals([same.additions, same.deletions, same.complete], [
      [],
      [],
      true,
    ]);
  } finally {
    subject.close();
  }
});

Deno.test("documents/outline-and-search#R21: 선택한 section의 diff는 그 section 줄만 비교하고 없는 쪽은 비어 있는 것으로 둔다", async () => {
  const subject = open();
  try {
    const one = await subject.both(
      "# 계획서\n\n## 개요\n개요 줄\n\n## 계획\n하나\n둘\n셋\n",
    );
    const two = await subject.both(
      "# 계획서\n\n## 개요\n개요 줄 수정\n\n## 계획\n하나\n둘 수정\n셋\n\n## 부록\n새 section 줄\n",
      {
        base: one.version,
      },
    );
    const handlers = subject.handlers();
    const plan = keep(handlers.diff(CTX, {
      document: DOC,
      before: one.version,
      after: two.version,
      section: "계획",
    }));
    // 개요의 수정은 이 section의 diff가 아니다.
    assertEquals(plan.deletions, [{
      range: { start_line: 8, end_line: 8 },
      text: "둘",
    }]);
    assertEquals(plan.additions, [{
      range: { start_line: 8, end_line: 8 },
      text: "둘 수정",
    }]);
    assertEquals(plan.section, "계획");
    assert(diffPageSchema.safeParse(plan).success);
    // 뒤 판에서 생긴 section은 앞쪽이 비어 있어 모든 줄이 추가다.
    const added = keep(handlers.diff(CTX, {
      document: DOC,
      before: one.version,
      after: two.version,
      section: "부록",
    }));
    assertEquals(added.deletions, []);
    // 본문 줄과 파일 끝의 빈 줄이 이 section의 줄이다.
    assertEquals(added.additions, [{
      range: { start_line: 12, end_line: 13 },
      text: "새 section 줄\n",
    }]);
    // 두 판 어디에도 없는 section은 비교할 수 없는 주소다.
    const absent = handlers.diff(CTX, {
      document: DOC,
      before: one.version,
      after: two.version,
      section: "없음",
    });
    assert(!absent.ok);
    assertEquals(absent.error.code, "not_found");
  } finally {
    subject.close();
  }
});

Deno.test("documents/outline-and-search#R21: 원문을 복원할 수 없는 판과 구간은 비교하지 않고 누락으로 표시한다", async () => {
  const subject = open();
  try {
    const one = await subject.both(planText("하나"));
    const unverified = await subject.save(planText("둘"), {
      base: one.version,
    });
    await subject.extract(DOC, unverified, "unverified");
    const failed = await subject.save(planText("셋"), {
      base: unverified.version,
    });
    await subject.extract(DOC, failed, "failed");
    const handlers = subject.handlers();
    const missing = keep(handlers.diff(CTX, {
      document: DOC,
      before: one.version,
      after: unverified.version,
    }));
    // 없는 본문을 빈 본문으로 꾸며 모든 줄을 삭제로 만들지 않는다.
    assertEquals([missing.additions, missing.deletions], [[], []]);
    assertEquals(missing.omissions, [{
      version: unverified.version,
      section: null,
      ranges: [],
      reason: OMISSION_UNVERIFIED,
    }]);
    const both = keep(handlers.diff(CTX, {
      document: DOC,
      before: unverified.version,
      after: failed.version,
      section: "계획",
    }));
    assertEquals(
      both.omissions.map((item) => [item.version, item.reason]),
      [[unverified.version, OMISSION_UNVERIFIED], [
        failed.version,
        "module crashed",
      ]],
    );
    assert(diffPageSchema.safeParse(both).success);
    // 본문 밖을 가리키는 section 범위는 그 줄만 누락이고 나머지는 비교한다.
    const base = await subject.save(planText("범위 시험"), {
      base: failed.version,
    });
    const text = base.text;
    const written = recordExtraction(subject.writer, {
      document: DOC,
      version: base.version,
      content_hash: base.content_hash,
      module_hash: BUILTIN_MODULE_HASH,
      extraction: {
        status: "ready",
        title: "계획서",
        text,
        text_hash: await sha256Hex(text),
        sections: [{
          key: "넘침",
          title: "넘침",
          parent: null,
          position: 0,
          level: 2,
          anchor: null,
          own_ranges: [{ start_line: 5, end_line: 9 }],
          subtree_range: { start_line: 5, end_line: 9 },
          characters: 1,
          body_hash: await sha256Hex("x"),
        }],
      },
    }, "1");
    assert(written.ok);
    const lines = text.split("\n").length;
    const over = keep(handlers.diff(CTX, {
      document: DOC,
      before: base.version,
      after: base.version,
      section: "넘침",
    }));
    assertEquals(over.omissions.length, 2);
    for (const item of over.omissions) {
      assertEquals(item.reason, "text range is not restorable");
      assertEquals(item.ranges, [{ start_line: lines + 1, end_line: 9 }]);
    }
  } finally {
    subject.close();
  }
});

function manyLines(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index}`).join(
    "\n",
  );
}

Deno.test("documents/outline-and-search#R21: 변경이 많으면 변경 block 단위로 끊어 cursor로 이어 읽고 겹침과 누락이 없다", async () => {
  const subject = open();
  try {
    // 줄마다 긴 본문을 1,500줄 쌓고 다섯 줄에 하나씩 고쳐 한 응답 예산(12,000 codepoint)을
    // 여러 번 넘긴다. 변경은 줄마다 떨어진 block이고 계산 한도(편집 거리 1,024) 안이다.
    const before = manyLines("가".repeat(40), 1500);
    const after = before.split("\n").map((line, index) =>
      index % 5 === 0 ? `${line} 수정` : line
    ).join("\n");
    const one = await subject.both(before);
    const two = await subject.both(after, { base: one.version });
    const handlers = subject.handlers();
    const input: DiffInput = {
      document: DOC,
      before: one.version,
      after: two.version,
    };
    const deleted: number[] = [];
    const added: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = keep(
        handlers.diff(CTX, { ...input, ...(cursor ? { cursor } : {}) }),
      );
      assert(diffPageSchema.safeParse(page).success, `page ${pages}`);
      for (const change of page.deletions) {
        for (
          let line = change.range.start_line;
          line <= change.range.end_line;
          line++
        ) deleted.push(line);
      }
      for (const change of page.additions) {
        for (
          let line = change.range.start_line;
          line <= change.range.end_line;
          line++
        ) added.push(line);
      }
      cursor = page.next_cursor ?? undefined;
      pages += 1;
      assert(pages < 200);
    } while (cursor !== undefined);
    assert(pages > 1);
    const expected = Array.from({ length: 300 }, (_, index) => index * 5 + 1);
    assertEquals(deleted, expected);
    assertEquals(added, expected);
    // 다른 판 쌍에는 그 cursor를 쓰지 못한다.
    const first = keep(handlers.diff(CTX, input));
    assert(first.next_cursor !== null);
    const crossed = handlers.diff(CTX, {
      document: DOC,
      before: one.version,
      after: one.version,
      cursor: first.next_cursor,
    });
    assert(!crossed.ok);
    assertEquals(crossed.error.code, "invalid_input");
  } finally {
    subject.close();
  }
});

Deno.test("documents/outline-and-search#R21: 한 응답 예산보다 긴 한 줄은 싣지 않고 그 줄만 누락으로 표시한다", async () => {
  const subject = open();
  try {
    const one = await subject.both(`머리\n${"가".repeat(13000)}\n꼬리`);
    const two = await subject.both(`머리\n${"나".repeat(13000)}\n꼬리\n붙임`, {
      base: one.version,
    });
    const page = keep(
      subject.handlers().diff(CTX, {
        document: DOC,
        before: one.version,
        after: two.version,
      }),
    );
    assertEquals(page.deletions, []);
    assertEquals(page.additions, [{
      range: { start_line: 4, end_line: 4 },
      text: "붙임",
    }]);
    assertEquals(
      page.omissions.map((item) => [item.version, item.ranges, item.reason]),
      [
        [
          one.version,
          [{ start_line: 2, end_line: 2 }],
          "line exceeds 12000 codepoints",
        ],
        [
          two.version,
          [{ start_line: 2, end_line: 2 }],
          "line exceeds 12000 codepoints",
        ],
      ],
    );
    assert(diffPageSchema.safeParse(page).success);
  } finally {
    subject.close();
  }
});

Deno.test("documents/outline-and-search#R21: diff 본문은 redaction을 거치고 안전화를 못 한 줄은 싣지 않고 누락으로 밝힌다", async () => {
  const subject = open();
  try {
    const one = await subject.both("# 계획서\n\n## 개요\n옛\n");
    const two = await subject.both(
      "# 계획서\n\n## 개요\ntoken SECRET-VALUE 입니다\n",
      {
        base: one.version,
      },
    );
    const masked = keep(
      subject.handlers({
        redactor: (_source, _media, text) =>
          text.replaceAll("SECRET-VALUE", "[redacted]"),
      }).diff(CTX, { document: DOC, before: one.version, after: two.version }),
    );
    assertEquals(masked.additions.map((change) => change.text), [
      "token [redacted] 입니다",
    ]);
    const blocked = keep(
      subject.handlers({
        redactor: (
          _source,
          _media,
          text,
        ) => (text.includes("SECRET") ? null : text),
      }).diff(CTX, { document: DOC, before: one.version, after: two.version }),
    );
    assertEquals(blocked.additions, []);
    assertEquals(blocked.deletions.map((change) => change.text), ["옛"]);
    assertEquals(blocked.omissions, [{
      version: two.version,
      section: null,
      ranges: [{ start_line: 4, end_line: 4 }],
      reason: "redaction_failed",
    }]);
    assert(diffPageSchema.safeParse(blocked).success);
  } finally {
    subject.close();
  }
});

Deno.test("documents/outline-and-search#R21: 같은 판 쌍의 cursor는 원문이 다시 추출돼 바뀌면 conflict다", async () => {
  const subject = open();
  try {
    const before = manyLines("가".repeat(40), 900);
    const after = before.split("\n").map((line, index) =>
      index % 5 === 0 ? `${line} 수정` : line
    ).join("\n");
    const one = await subject.both(before);
    const two = await subject.both(after, { base: one.version });
    const handlers = subject.handlers();
    const first = keep(
      handlers.diff(CTX, {
        document: DOC,
        before: one.version,
        after: two.version,
      }),
    );
    assert(first.next_cursor !== null);
    // 같은 판의 추출이 다른 원문으로 다시 기록됐다.
    const redone = recordExtraction(subject.writer, {
      document: DOC,
      version: two.version,
      content_hash: two.content_hash,
      module_hash: BUILTIN_MODULE_HASH,
      extraction: {
        status: "ready",
        title: "계획서",
        text: `${after}\n뒤늦게 달라진 줄`,
        text_hash: await sha256Hex(`${after}\n뒤늦게 달라진 줄`),
        sections: [],
      },
    }, "1");
    assert(redone.ok);
    const moved = handlers.diff(CTX, {
      document: DOC,
      before: one.version,
      after: two.version,
      cursor: first.next_cursor,
    });
    assert(!moved.ok);
    assertEquals(moved.error.code, "conflict");
  } finally {
    subject.close();
  }
});
