// tool registry 테스트다(R2, R3, R4). toolset에 켠 것만 discovery에 나오고,
// op마다 소유 route 하나로만 routing하는지, readOnlyHint는 읽기만 되는 tool에만
// 붙는지 본다. core에 닿지 않는다.
import { assertEquals } from "@std/assert";
import {
  findTool,
  inputSchema,
  resolveRoute,
  STATIC_TOOLS,
  toolEntries,
} from "./registry.ts";

Deno.test(
  "coding-agent/mcp-server#R3: 기본 discovery에는 core toolset만 나온다",
  () => {
    const entries = toolEntries(["core"]);
    const names = entries.map((entry) => entry.name);
    assertEquals(names.includes("lophn_index"), true);
    assertEquals(names.includes("lophn_read"), true);
    // 앱 toolset 도구는 명시 실행 옵션 없이는 보이지 않는다(R3).
    assertEquals(names.some((name) => name.startsWith("lophn_app_")), false);
    const toolsets = new Set(
      STATIC_TOOLS
        .filter((tool) => names.includes(tool.name))
        .map((tool) => tool.toolset),
    );
    assertEquals([...toolsets], ["core"]);
  },
);

Deno.test(
  "coding-agent/mcp-server#R3: app toolset을 켜면 앱 도구도 discovery에 나온다",
  () => {
    const entries = toolEntries(["core", "app"]);
    const names = entries.map((entry) => entry.name);
    assertEquals(names.includes("lophn_index"), true);
    assertEquals(names.includes("lophn_app"), true);
    // 도구 수는 core만 켠 것보다 많다.
    assertEquals(entries.length > toolEntries(["core"]).length, true);
  },
);

Deno.test(
  "coding-agent/mcp-server#R2: resolveRoute는 op마다 소유 route 하나로만 좁힌다",
  () => {
    // lophn_project.show는 소유 route가 있다.
    const show = resolveRoute("lophn_project", "show");
    assertEquals(show !== undefined, true);
    assertEquals(show?.tool.name, "lophn_project");
    assertEquals(show?.op, "show");
    assertEquals(typeof show?.route.input.safeParse, "function");
    // lophn_index에는 home op가 없다.
    assertEquals(resolveRoute("lophn_index", "home"), undefined);
    // lophn_session의 소유 표는 Route가 아니다(list에 Route가 없다). 표 밖 op와
    // 같은 값이므로 undefined다.
    assertEquals(resolveRoute("lophn_session", "list"), undefined);
    // 없는 tool은 undefined다. lophn_app은 있으므로 op가 맞으면 route로 좁혀진다.
    const app = resolveRoute("lophn_app", "list");
    assertEquals(app !== undefined, true);
    assertEquals(app?.op, "list");
    assertEquals(app?.tool.toolset, "app");
    // 여러 op tool은 op 없이는 route를 정하지 못한다.
    assertEquals(resolveRoute("lophn_index", undefined), undefined);
  },
);

Deno.test(
  "coding-agent/mcp-server#R2: 단일 동작 tool의 소유 입력은 route 입력이다",
  () => {
    // lophn_read·lophn_save는 op 없는 단일 동작이다.
    const read = resolveRoute("lophn_read", undefined);
    assertEquals(read !== undefined, true);
    assertEquals(read?.tool.ops, []);
    assertEquals(typeof read?.route.input.safeParse, "function");
    // 소유 입력이 route 입력과 같은 기준이다. 같은 입력이 둘 다 통과한다.
    const valid = {
      reference: {
        document: "doc_01h455vb4pex5v6nkc6gd5fdw1",
        version: "ver_01h455vb4pex5v6nkc6gd5fdw1",
        section: null,
      },
    };
    assertEquals(read?.route.input.safeParse(valid).success, true);
    assertEquals(
      read?.tool.input.safeParse(valid).success,
      true,
    );
    // 빈 입력은 둘 다 거절이다(R6).
    assertEquals(read?.route.input.safeParse({}).success, false);
    assertEquals(read?.tool.input.safeParse({}).success, false);
  },
);

Deno.test(
  "coding-agent/mcp-server#R4: readOnlyHint는 읽기만 되는 tool에만 붙는다",
  () => {
    const entries = toolEntries(["core", "app"]);
    for (const entry of entries) {
      const readOnly = entry.readOnlyHint === true;
      // lophn_save는 저장 tool이라 읽기 전용이 아니다.
      if (entry.name === "lophn_save") {
        assertEquals(readOnly, false);
      }
      if (entry.name === "lophn_read") {
        assertEquals(readOnly, true);
      }
      if (entry.name === "lophn_index") {
        assertEquals(readOnly, true);
      }
    }
    // discovery schema는 minified UTF-8 JSON으로 변환 실패를 숨기지 않는다(R4).
    const read = findTool("lophn_read");
    assertEquals(read !== undefined, true);
    const schema = inputSchema(read!.input);
    assertEquals(JSON.stringify(schema).includes(" "), false);
  },
);

Deno.test(
  "coding-agent/mcp-server#R8: 문서 읽기 tool의 모든 op가 읽기 route로 좁혀지고 쓰기 route는 없다",
  () => {
    const ops: [string, readonly string[]][] = [
      ["lophn_index", [
        "root",
        "place",
        "document",
        "section",
        "search",
        "status",
      ]],
      ["lophn_project", ["list", "show", "current"]],
      ["lophn_document", ["list", "history", "diff"]],
    ];
    for (const [tool, names] of ops) {
      for (const op of names) {
        const resolved = resolveRoute(tool, op);
        assertEquals(resolved !== undefined, true, `${tool} ${op}`);
        assertEquals(
          resolved?.route.kind === "command",
          false,
          `${tool} ${op}`,
        );
      }
    }
    const read = resolveRoute("lophn_read", undefined);
    assertEquals(read?.route.kind === "command", false);
    // 저장·복원·등록 같은 op는 표에 없다.
    assertEquals(resolveRoute("lophn_document", "restore"), undefined);
    assertEquals(resolveRoute("lophn_project", "register"), undefined);
  },
);
