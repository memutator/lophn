import { assert, assertEquals } from "@std/assert";
import {
  listMembers,
  nextName,
  parsePattern,
  type SeriesNext,
  type SeriesPattern,
} from "./next.ts";

function pattern(text: string): SeriesPattern {
  const parsed = parsePattern(text);
  if (!parsed.ok) throw new Error(`${text}: ${parsed.error.message}`);
  return parsed.value;
}

function next(text: string, paths: string[]): SeriesNext {
  return nextName(pattern(text), paths);
}

function keysOf(text: string, paths: string[]): string[] {
  return listMembers(pattern(text), paths).map((member) => member.key);
}

function pathsOf(text: string, paths: string[]): string[] {
  return listMembers(pattern(text), paths).map((member) => member.path);
}

const EMPTY = {
  key: "",
  path: null,
  complete: false,
  taken: false,
} as const;

Deno.test("documents/series#R2 [ctx-I61]: patterns with exactly one number place in the file name are accepted", () => {
  for (
    const text of [
      "reports/weekly-{n}.md",
      "eval/experiments/exp-{n}-*.md",
      "P{n+1:03}.md",
      "weekly-{minor}.md",
      "weekly-{major}.md",
      "weekly-{patch}.md",
      "v{n+1}.md",
      "weekly-{n-1}.md",
      "step-{n+0}.md",
      "big-{n+9007199254740991}.md",
      "{n}.md",
      "a/b/c/v{n:4}.md",
      "v{n:01}.md",
    ]
  ) {
    const parsed = parsePattern(text);
    assert(parsed.ok, `${text} should be accepted`);
    if (parsed.ok) assertEquals(parsed.value.text, text);
  }
});

Deno.test("documents/series#R2 [ctx-I61]: patterns that cannot name one number are rejected as invalid_input", () => {
  assert(parsePattern("reports/weekly-{n}.md").ok);
  for (
    const text of [
      "",
      "weekly.md",
      "weekly-{n}-{n}.md",
      "weekly-{n}-{minor}.md",
      "{n}/weekly.md",
      "rep*/weekly-{n}.md",
      "re{ports/weekly-{n}.md",
      "../weekly-{n}.md",
      "reports/../weekly-{n}.md",
      "/reports/weekly-{n}.md",
      "reports//weekly-{n}.md",
      "reports/weekly-{n}.md/",
      "v1{n}.md",
      "v*{n}.md",
      "v{n}*.md",
      "v{n}2.md",
      "v{n}.5.md",
      "v{x}.md",
      "v{n.md",
      "v{n+}.md",
      "v{n*2}.md",
      " v{n}.md",
      "v{n}.md ",
    ]
  ) {
    const parsed = parsePattern(text);
    assert(!parsed.ok, `${JSON.stringify(text)} should be rejected`);
    if (!parsed.ok) {
      assertEquals(parsed.error.code, "invalid_input", text);
    }
  }
});

Deno.test("documents/series#R7 [ctx-I61]: width must be 1 to 4 and step must stay in the safe integer range", () => {
  assert(parsePattern("P{n+1:03}.md").ok);
  for (
    const text of [
      "P{n:0}.md",
      "P{n:00}.md",
      "P{n:5}.md",
      "P{n+1:05}.md",
      "P{n+9007199254740992}.md",
      "P{n-9007199254740992}.md",
    ]
  ) {
    const parsed = parsePattern(text);
    assert(!parsed.ok, `${text} should be rejected`);
    if (!parsed.ok) assertEquals(parsed.error.code, "invalid_input", text);
  }
});

Deno.test("documents/series#R3 [ctx-I61]: members are exactly the files that match the whole pattern and the key is the text the number place caught", () => {
  const files = [
    "reports/weekly-2.md",
    "reports/weekly-1.md",
    "reports/weekly-2026-09-28.md",
    "reports/notes.md",
    "reports/weekly-5.txt",
    "reports/weekly-.md",
    "reports/weekly-1.5.md",
    "reports/sub/weekly-4.md",
    "weekly-3.md",
  ];
  assertEquals(pathsOf("reports/weekly-{n}.md", files), [
    "reports/weekly-1.md",
    "reports/weekly-2.md",
  ]);
  assertEquals(keysOf("reports/weekly-{n}.md", files), ["1", "2"]);
  const created = [...files, "reports/weekly-3.md"];
  assertEquals(keysOf("reports/weekly-{n}.md", created), ["1", "2", "3"]);
  assertEquals(keysOf("reports/weekly-{n}.md", files), ["1", "2"]);
});

Deno.test("documents/series#R3 [ctx-I61]: key keeps leading zeros and parts are the decimal integers of the key", () => {
  const members = listMembers(pattern("P{n}.md"), ["P007.md", "P12.md"]);
  assertEquals(members, [
    { path: "P007.md", key: "007", parts: [7] },
    { path: "P12.md", key: "12", parts: [12] },
  ]);
  assertEquals(
    listMembers(pattern("v{major}.md"), ["v1.2.3.md", "v1.md", "v1..2.md"]),
    [
      { path: "v1.md", key: "1", parts: [1] },
      { path: "v1.2.3.md", key: "1.2.3", parts: [1, 2, 3] },
    ],
  );
  assertEquals(keysOf("weekly-{minor}.md", ["weekly-0.2.md", "weekly-x.md"]), [
    "0.2",
  ]);
});

Deno.test("documents/series#R3 [ctx-I61]: star matches zero or more characters in the file name only and folders must match by position", () => {
  const files = [
    "eval/experiments/exp-001-a.md",
    "eval/experiments/exp-002-a-b.md",
    "eval/experiments/exp-003-.md",
    "eval/experiments/exp-004.md",
    "eval/experiments/sub/exp-005-a.md",
    "eval/exp-006-a.md",
    "eval/experiments/exp-007-a/b.md",
  ];
  assertEquals(pathsOf("eval/experiments/exp-{n}-*.md", files), [
    "eval/experiments/exp-001-a.md",
    "eval/experiments/exp-002-a-b.md",
    "eval/experiments/exp-003-.md",
  ]);
});

Deno.test("documents/series#R3 [ctx-I61]: a number component beyond the safe integer range does not match", () => {
  const files = ["v9007199254740991.md", "v9007199254740992.md"];
  assertEquals(pathsOf("v{n}.md", files), ["v9007199254740991.md"]);
});

Deno.test("documents/series#R4 [ctx-I61]: members follow the natural order of key numbers, not the order of letters", () => {
  const files = ["exp-010.md", "exp-002.md", "exp-009.md"];
  assertEquals(keysOf("exp-{n}.md", files), ["002", "009", "010"]);
  assertEquals(
    keysOf("weekly-{minor}.md", [
      "weekly-0.10.md",
      "weekly-0.2.md",
      "weekly-0.9.md",
    ]),
    ["0.2", "0.9", "0.10"],
  );
  assertEquals(
    keysOf("v{major}.md", [
      "v1.10.md",
      "v1.9.md",
      "v1.9.1.md",
      "v10.md",
      "v2.md",
    ]),
    ["1.9", "1.9.1", "1.10", "2", "10"],
  );
});

Deno.test("documents/series#R4 [ctx-I61]: equal numbers fall back to key letters and then to path order, and a short key counts missing parts as zero", () => {
  assertEquals(
    pathsOf("exp-{n}-*.md", ["exp-001-b.md", "exp-002-a.md", "exp-001-a.md"]),
    ["exp-001-a.md", "exp-001-b.md", "exp-002-a.md"],
  );
  assertEquals(keysOf("exp-{n}.md", ["exp-1.md", "exp-01.md", "exp-001.md"]), [
    "001",
    "01",
    "1",
  ]);
  assertEquals(
    keysOf("weekly-{minor}.md", [
      "weekly-0.2.0.md",
      "weekly-0.2.md",
      "weekly-0.1.9.md",
    ]),
    ["0.1.9", "0.2", "0.2.0"],
  );
});

Deno.test("documents/series#R4 [ctx-I61]: the order does not depend on the order of the input list", () => {
  const files = [
    "exp-010-x.md",
    "exp-002-x.md",
    "exp-009-x.md",
    "exp-009-a.md",
    "readme.md",
  ];
  const expected = pathsOf("exp-{n}-*.md", files);
  assertEquals(expected, [
    "exp-002-x.md",
    "exp-009-a.md",
    "exp-009-x.md",
    "exp-010-x.md",
  ]);
  assertEquals(pathsOf("exp-{n}-*.md", [...files].reverse()), expected);
  assertEquals(
    pathsOf("exp-{n}-*.md", [
      files[3]!,
      files[0]!,
      files[4]!,
      files[2]!,
      files[1]!,
    ]),
    expected,
  );
});

Deno.test("documents/series#R5 [ctx-I61]: the calculation table gives the documented next path for every row", () => {
  const rows: [string, string[], SeriesNext][] = [
    ["P{n+1:03}.md", ["P001.md"], {
      key: "002",
      path: "P002.md",
      from: "P001.md",
      complete: true,
      taken: false,
    }],
    ["weekly-{minor}.md", ["weekly-0.2.md"], {
      key: "0.3",
      path: "weekly-0.3.md",
      from: "weekly-0.2.md",
      complete: true,
      taken: false,
    }],
    ["weekly-{major}.md", ["weekly-0.2.md"], {
      key: "1.0",
      path: "weekly-1.0.md",
      from: "weekly-0.2.md",
      complete: true,
      taken: false,
    }],
    ["weekly-{patch}.md", ["weekly-0.2.1.md"], {
      key: "0.2.2",
      path: "weekly-0.2.2.md",
      from: "weekly-0.2.1.md",
      complete: true,
      taken: false,
    }],
    ["v{n+1}.md", ["v1.md"], {
      key: "2",
      path: "v2.md",
      from: "v1.md",
      complete: true,
      taken: false,
    }],
    ["reports/weekly-{n}.md", ["reports/weekly-9.md"], {
      key: "10",
      path: "reports/weekly-10.md",
      from: "reports/weekly-9.md",
      complete: true,
      taken: false,
    }],
    [
      "eval/experiments/exp-{n}-*.md",
      ["eval/experiments/exp-009-x.md"],
      {
        key: "010",
        path: "eval/experiments/exp-010-*.md",
        from: "eval/experiments/exp-009-x.md",
        complete: false,
        taken: false,
      },
    ],
    [
      "eval/experiments/exp-{n+1:03}-*.md",
      ["eval/experiments/exp-010-x.md"],
      {
        key: "011",
        path: "eval/experiments/exp-011-*.md",
        from: "eval/experiments/exp-010-x.md",
        complete: false,
        taken: false,
      },
    ],
    ["weekly-{n-1}.md", ["weekly-5.md"], {
      key: "4",
      path: "weekly-4.md",
      from: "weekly-5.md",
      complete: true,
      taken: false,
    }],
  ];
  for (const [text, files, expected] of rows) {
    assertEquals(next(text, files), expected, text);
  }
});

Deno.test("documents/series#R5 [ctx-I61]: the next name is computed from the last member in natural order, not from the last letters", () => {
  const files = ["exp-010.md", "exp-002.md", "exp-009.md", "notes.md"];
  assertEquals(next("exp-{n}.md", files), {
    key: "011",
    path: "exp-011.md",
    from: "exp-010.md",
    complete: true,
    taken: false,
  });
  assertEquals(
    next("exp-{n}.md", [...files].reverse()),
    next("exp-{n}.md", files),
  );
});

Deno.test("documents/series#R5 [ctx-I61]: reading the next name twice gives the same result, does not touch the input and a file made outside moves the answer", () => {
  const files = Object.freeze(["reports/weekly-1.md", "reports/weekly-2.md"]);
  const parsed = pattern("reports/weekly-{n}.md");
  const first = nextName(parsed, files);
  assertEquals(first.path, "reports/weekly-3.md");
  assertEquals(nextName(parsed, files), first);
  assertEquals(files, ["reports/weekly-1.md", "reports/weekly-2.md"]);
  assertEquals(
    nextName(parsed, [...files, "reports/weekly-3.md"]).path,
    "reports/weekly-4.md",
  );
});

Deno.test("documents/series#R5 [ctx-I61]: taken is true when a decreasing or zero step lands on an existing member, even if a star is left", () => {
  assertEquals(
    next("weekly-{n-1}.md", ["weekly-3.md", "weekly-5.md", "weekly-4.md"]),
    {
      key: "4",
      path: "weekly-4.md",
      from: "weekly-5.md",
      complete: true,
      taken: true,
    },
  );
  assertEquals(next("weekly-{n-1}.md", ["weekly-5.md"]).taken, false);
  assertEquals(next("weekly-{n+0}.md", ["weekly-5.md"]), {
    key: "5",
    path: "weekly-5.md",
    from: "weekly-5.md",
    complete: true,
    taken: true,
  });
  assertEquals(next("exp-{n-1}-*.md", ["exp-009-x.md", "exp-010-y.md"]), {
    key: "009",
    path: "exp-009-*.md",
    from: "exp-010-y.md",
    complete: false,
    taken: true,
  });
});

Deno.test("documents/series#R6 [ctx-I61]: a star stays in the path and the suggestion is not complete", () => {
  const result = next("eval/exp-{n}-*-final.md", ["eval/exp-004-run-final.md"]);
  assertEquals(result, {
    key: "005",
    path: "eval/exp-005-*-final.md",
    from: "eval/exp-004-run-final.md",
    complete: false,
    taken: false,
  });
  assertEquals(next("exp-{n}.md", ["exp-004.md"]).complete, true);
});

Deno.test("documents/series#R6 [ctx-I61]: without members the suggestion is empty and the first key is left to the human", () => {
  const withMember = next("weekly-{n}.md", ["weekly-1.md"]);
  assertEquals(withMember.path, "weekly-2.md");
  assertEquals(next("weekly-{n}.md", []), { ...EMPTY, from: null });
  assertEquals(next("weekly-{n}.md", ["readme.md", "other/weekly-1.md"]), {
    ...EMPTY,
    from: null,
  });
});

Deno.test("documents/series#R7 [ctx-I61]: width defaults to the width of the last member and never truncates", () => {
  const cases: [string, string[], string][] = [
    ["exp-{n}-*.md", ["exp-009-x.md"], "exp-010-*.md"],
    ["v{n}.md", ["v9.md"], "v10.md"],
    ["v{n}.md", ["v7.md"], "v8.md"],
    ["v{n}.md", ["v099.md"], "v100.md"],
    ["v{n}.md", ["v007.md"], "v008.md"],
    ["P{n+1:03}.md", ["P999.md"], "P1000.md"],
    ["P{n:03}.md", ["P1.md"], "P002.md"],
    ["P{n+1:04}.md", ["P1.md"], "P0002.md"],
    ["P{n+1:1}.md", ["P007.md"], "P8.md"],
  ];
  for (const [text, files, expected] of cases) {
    assertEquals(next(text, files).path, expected, `${text} after ${files}`);
  }
});

Deno.test("documents/series#R7 [ctx-I61]: step can be larger, negative below zero clamps to zero", () => {
  assertEquals(next("v{n+2}.md", ["v5.md"]).path, "v7.md");
  assertEquals(next("v{n-10}.md", ["v5.md"]), {
    key: "0",
    path: "v0.md",
    from: "v5.md",
    complete: true,
    taken: false,
  });
  assertEquals(next("v{n-10:02}.md", ["v05.md"]).path, "v00.md");
});

Deno.test("documents/series#R7 [ctx-I61]: major, minor and patch change their own component and reset the ones after it to zero", () => {
  const cases: [string, string, string][] = [
    ["weekly-{major}.md", "1.5.2", "2.0.0"],
    ["weekly-{major}.md", "3", "4"],
    ["weekly-{minor}.md", "1.5.2", "1.6.0"],
    ["weekly-{minor}.md", "3", "4"],
    ["weekly-{patch}.md", "1.2.3", "1.2.4"],
    ["weekly-{patch}.md", "1.2.3.4", "1.2.4.0"],
    ["weekly-{patch}.md", "0.2", "0.3"],
    ["weekly-{patch}.md", "7", "8"],
    ["weekly-{minor:02}.md", "1.09", "1.10"],
    ["weekly-{minor}.md", "1.09", "1.10"],
    ["weekly-{minor}.md", "01.9", "01.10"],
    ["weekly-{minor:03}.md", "1.5", "1.006"],
    ["weekly-{major:02}.md", "1.5", "02.0"],
    ["weekly-{minor-1}.md", "1.5", "1.4"],
  ];
  for (const [text, last, expected] of cases) {
    const result = next(text, [`weekly-${last}.md`]);
    assertEquals(result.key, expected, `${text} after ${last}`);
    assertEquals(result.path, `weekly-${expected}.md`, `${text} after ${last}`);
    assertEquals(result.complete, true);
  }
});

Deno.test("documents/series#R8 [ctx-I61]: a result beyond the safe integer range is an empty suggestion that still names its source", () => {
  assertEquals(
    next("v{n}.md", ["v9007199254740990.md"]).key,
    "9007199254740991",
  );
  assertEquals(next("v{n}.md", ["v9007199254740991.md"]), {
    ...EMPTY,
    from: "v9007199254740991.md",
  });
  assertEquals(
    next("v{minor}.md", ["v1.9007199254740990.md"]).path,
    "v1.9007199254740991.md",
  );
  assertEquals(next("v{minor}.md", ["v1.9007199254740991.md"]), {
    ...EMPTY,
    from: "v1.9007199254740991.md",
  });
  assertEquals(next("v{n+9007199254740991}.md", ["v1.md"]), {
    ...EMPTY,
    from: "v1.md",
  });
});

Deno.test("documents/series#R8 [ctx-I61]: date names are not members of a number pattern, so no number is invented for them", () => {
  assertEquals(
    next("weekly-{n}.md", ["weekly-2026-09-28.md", "weekly-2026-10-05.md"]),
    { ...EMPTY, from: null },
  );
  assertEquals(
    next("weekly-{n}.md", ["weekly-2026-09-28.md", "weekly-7.md"]).path,
    "weekly-8.md",
  );
});
