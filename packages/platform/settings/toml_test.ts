import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { SETTINGS_EXCHANGE_FORMAT_VERSION } from "../../contracts/platform/mod.ts";
import { exportSettingsTOML, parseSettingsTOML } from "./toml.ts";

function failure<T>(
  result: { ok: boolean; error?: { code: string; message: string } },
): {
  code: string;
  message: string;
} {
  assert(!result.ok, "거절을 기다렸다");
  return {
    code: (result as { error: { code: string; message: string } }).error.code,
    message:
      (result as { error: { code: string; message: string } }).error.message,
  };
}

function value<T>(
  result: { ok: boolean; value?: T; error?: { code: string; message: string } },
): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value as T;
}

// [exchange] 표와 [settings."layer.key"] 표 하나가 mutation 하나인 format 1 문서.
function formatDocument(settings: string): string {
  return `# settings exchange
[exchange]
format = "TOML"
toml_version = "1.0"
encoding = "UTF-8"
format_version = ${SETTINGS_EXCHANGE_FORMAT_VERSION}

${settings}`;
}

const SET_WIDTH = formatDocument(`[settings."shell.reading_width"]
value = 90`);

Deno.test("platform/settings#R3: format 1 교환 문서를 parse하고 mutation으로 바꾼다", () => {
  const imported = value(parseSettingsTOML(SET_WIDTH));
  assertEquals(imported.format_version, 1);
  assertEquals(imported.mutations, [
    { layer: "common", key: "shell.reading_width", action: "set", value: 90 },
  ]);
  // 주석이 있는 TOML은 가져온다(R3).
  const withComments = value(
    parseSettingsTOML(formatDocument(`# 사람이 고른 추적 규칙
[settings."documents.tracking"]
value = ["user/*.md"]`)),
  );
  assertEquals(withComments.mutations, [
    {
      layer: "common",
      key: "documents.tracking",
      action: "set",
      value: ["user/*.md"],
    },
  ]);
});

Deno.test("platform/settings#R3: 환경 치환 모양의 문자열 값은 거절한다", () => {
  const substituted = parseSettingsTOML(
    formatDocument(`[settings."shell.reading_width"]
value = "\${HOME}/data"`),
  );
  assertEquals(failure(substituted).code, "forbidden");
  // $VAR 모양도 거절한다.
  const bare = parseSettingsTOML(
    formatDocument(`[settings."shell.reading_width"]
value = "$LOPHN_ROOT"`),
  );
  assertEquals(failure(bare).code, "forbidden");
});

Deno.test("platform/settings#R3: credential 모양의 문자열 값은 거절한다", () => {
  const secret = parseSettingsTOML(
    formatDocument(`[settings."documents.tracking"]
value = "sk-abcdefghijklmnopqrst"`),
  );
  assertEquals(failure(secret).code, "forbidden");
});

Deno.test("platform/settings#R3: UTF-8이 아니면 전체를 거절한다", () => {
  const imported = parseSettingsTOML("// 가)\ninvalid \uD800 leftover");
  assertEquals(failure(imported).code, "invalid_input");
});

Deno.test("platform/settings#R26: JSON5·YAML·빈 문서는 TOML parse에서 거절한다", () => {
  // JSON5 모양.
  const json5 = parseSettingsTOML(`{
  // JSON5 주석
  exchange: { format_version: 1 },
}`);
  assertEquals(failure(json5).code, "invalid_input");
  // YAML 모양.
  const yaml = parseSettingsTOML(
    " exchange:\n   format: TOML\n   format_version: 1\n settings:\n   shell.reading_width:\n     value: 90",
  );
  assertEquals(failure(yaml).code, "invalid_input");
  // 빈 문서.
  assertEquals(failure(parseSettingsTOML("")).code, "invalid_input");
  assertEquals(
    failure(parseSettingsTOML("# 주석만 있다")).code,
    "invalid_input",
  );
});

Deno.test("platform/settings#R26: 모르는 format version은 전체를 거절한다", () => {
  const unknownVersion = parseSettingsTOML(
    formatDocument(`[settings."shell.reading_width"]
value = 90`).replace(
      `format_version = ${SETTINGS_EXCHANGE_FORMAT_VERSION}`,
      "format_version = 2",
    ),
  );
  const failureResult = failure(unknownVersion);
  assertEquals(failureResult.code, "invalid_input");
  // format이 TOML이 아니면 거절한다.
  const notToml = parseSettingsTOML(
    formatDocument(`[settings."shell.reading_width"]
value = 90`).replace('format = "TOML"', 'format = "JSON"'),
  );
  assertEquals(failure(notToml).code, "invalid_input");
  // format 표가 없으면 거절한다.
  const noMeta = parseSettingsTOML(`[settings."shell.reading_width"]
value = 90`);
  assertEquals(failure(noMeta).code, "invalid_input");
});

Deno.test("platform/settings#R26: 문서 모양이 다른 항목은 거절한다", () => {
  // value·remove 밖의 필드.
  const extra = parseSettingsTOML(
    formatDocument(`[settings."shell.reading_width"]
value = 90
note = "why"`),
  );
  assertEquals(failure(extra).code, "invalid_input");
  // value와 remove를 같이 넣는다.
  const both = parseSettingsTOML(
    formatDocument(`[settings."shell.reading_width"]
value = 90
remove = true`),
  );
  assertEquals(failure(both).code, "invalid_input");
  // remove는 true만이다.
  const remove = parseSettingsTOML(
    formatDocument(`[settings."shell.reading_width"]
remove = 1`),
  );
  assertEquals(failure(remove).code, "invalid_input");
  // value도 remove도 없다.
  const neither = parseSettingsTOML(
    formatDocument(`[settings."shell.reading_width"]`),
  );
  assertEquals(failure(neither).code, "invalid_input");
  // 항목 경로 모양이 아닌 key.
  const flat = parseSettingsTOML(
    formatDocument(`[settings.width]
value = 90`),
  );
  assertEquals(failure(flat).code, "invalid_input");
  // 같은 항목의 변경이 두 개면 거절한다. TOML은 [[settings.key]] 배열 표로
  // 같은 key를 두 번 적을 수 있다. parse는 두 번째를 mutation 배열로 본다.
  const duplicate = parseSettingsTOML(
    formatDocument(`[[settings."shell.reading_width"]]
value = 90

[[settings."shell.reading_width"]]
value = 100`),
  );
  assertEquals(failure(duplicate).code, "invalid_input");
  // 같은 표 header를 두 번 쓰면 TOML parse 자체가 거절한다.
  const duplicateTable = parseSettingsTOML(
    formatDocument(`[settings."shell.reading_width"]
value = 90

[settings."shell.reading_width"]
value = 100`),
  );
  assertEquals(failure(duplicateTable).code, "invalid_input");
});

Deno.test("platform/settings#R3: 등록 항목 값을 export하고 같은 문서를 왕복한다", () => {
  const exported = value(
    exportSettingsTOML({
      mutations: [
        {
          layer: "common",
          key: "shell.reading_width",
          action: "set",
          value: 90,
        },
        {
          layer: "common",
          key: "documents.tracking",
          action: "set",
          value: { patterns: ["user/*.md"] },
        },
        { layer: "common", key: "coding.harness", action: "delete" },
      ],
    }),
  );
  // export한 문서에 format 표와 세 항목이 있다.
  assert(exported.includes('format = "TOML"'));
  assert(
    exported.includes(`format_version = ${SETTINGS_EXCHANGE_FORMAT_VERSION}`),
  );
  assert(exported.includes("remove = true"));
  // 같은 문서를 다시 parse하면 같은 mutation이 나온다(R26 왕복).
  const imported = value(parseSettingsTOML(exported));
  assertEquals(imported.format_version, 1);
  assertEquals(imported.mutations, [
    { layer: "common", key: "shell.reading_width", action: "set", value: 90 },
    {
      layer: "common",
      key: "documents.tracking",
      action: "set",
      value: { patterns: ["user/*.md"] },
    },
    { layer: "common", key: "coding.harness", action: "delete" },
  ]);
});

Deno.test("platform/settings#R3: null 값과 credential 값은 export에서 거절한다", () => {
  // TOML 1.0에 null이 없다. export는 null 값을 거절한다.
  const nullValue = exportSettingsTOML({
    mutations: [
      { layer: "common", key: "coding.harness", action: "set", value: null },
    ],
  });
  assertEquals(failure(nullValue).code, "invalid_input");
  // 대상 안쪽의 null도 거절한다.
  const nestedNull = exportSettingsTOML({
    mutations: [
      {
        layer: "common",
        key: "documents.tracking",
        action: "set",
        value: { patterns: null },
      },
    ],
  });
  assertEquals(failure(nestedNull).code, "invalid_input");
  // credential 모양의 문자열도 거절한다.
  const secret = exportSettingsTOML({
    mutations: [
      {
        layer: "common",
        key: "documents.tracking",
        action: "set",
        value: "ghp_abcdefghijklmnopqrstuvwxyz123456789",
      },
    ],
  });
  assertEquals(failure(secret).code, "forbidden");
  // 같은 항목의 변경이 두 개면 거절한다.
  const duplicate = exportSettingsTOML({
    mutations: [
      { layer: "common", key: "shell.reading_width", action: "set", value: 90 },
      { layer: "common", key: "shell.reading_width", action: "delete" },
    ],
  });
  assertEquals(failure(duplicate).code, "invalid_input");
  // 빈 변경 목록은 거절한다.
  const empty = exportSettingsTOML({ mutations: [] });
  assertEquals(failure(empty).code, "invalid_input");
});

// export한 문서는 environment 치환 모양을 넣지 않는다. parse가 거절하는 값과 같다.
Deno.test("platform/settings#R3: export된 문서는 format 표를 유지한다", () => {
  const exported = value(
    exportSettingsTOML({
      mutations: [
        {
          layer: "common",
          key: "shell.reading_width",
          action: "set",
          value: 90,
        },
      ],
    }),
  );
  assert(exported.includes("[exchange]"));
  assert(exported.includes('toml_version = "1.0"'));
  assert(exported.includes('encoding = "UTF-8"'));
});

// value_type 검사는 validateChoice·ApplySettings의 몫이다. parse는 값 모양만 본다.
const _valueType = z.number(); // registry 검사와 구별하는 표시
void _valueType;
