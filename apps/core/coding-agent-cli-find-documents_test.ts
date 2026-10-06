// coding-agent#T13 CLI 쪽 끝에서 끝까지: 실제 CLI 실행 entry(`cliMain`)가 실제 core에서 전체 목차 → 자리 목차 →
// 문서 목차 → 구역 목차 → 본문(잘림·이어 읽기) → keyword 검색 여섯 단계를 읽고, 같은 credential·입력의
// MCP tool 결과와 같은 사실을 낸다(cli#R11·R12·R13, mcp-server#R8·R10). 구역 이력(`document history --section`)도
// MCP `lophn_document history`와 같다. core·I/O worker는 실제 자식 프로세스이고 데이터 root·작업 폴더는
// temp dir이며 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { cliMain } from "../cli/main.ts";
import { saveFromPaths } from "../../packages/coding-agent/connection/mod.ts";
import {
  DOCUMENT_OPERATIONS,
  openScopeWorld,
  type ScopeWorld,
} from "./testing/coding-agent-scope.ts";

const TEXT = `# 계획서

## 개요
여섯 단계 검증용 문서다. 첫째 줄이다.
둘째 줄이다.
셋째 줄이다.
넷째 줄이다.

## 일정
다섯째 줄이다.
`;

type Cli = { exit: number; value: Record<string, unknown> };

// 실제 cliMain으로 한 command를 실행한다. credential은 world의 token이고 core 주소는 실제 core다.
async function cli(
  world: ScopeWorld,
  argv: string[],
  input?: Record<string, unknown>,
): Promise<Cli> {
  const out = new TransformStream<Uint8Array, Uint8Array>();
  const errs = new TransformStream<Uint8Array, Uint8Array>();
  const decoder = new TextDecoder();
  const collect = async (readable: ReadableStream<Uint8Array>) => {
    let text = "";
    for await (const chunk of readable) {
      text += decoder.decode(chunk, { stream: true });
    }
    return text;
  };
  const stdout = collect(out.readable);
  const stderr = collect(errs.readable);
  const exit = await cliMain([
    ...argv,
    "--json",
    "--connection",
    world.connection("all"),
    "--daemon-url",
    world.baseUrl,
    ...(input === undefined ? [] : ["--input", JSON.stringify(input)]),
  ], {
    stdout: out.writable,
    stderr: errs.writable,
    cwd: world.work,
    home: world.work,
    installRoot: "/nonexistent-install",
    env: { get: (name) => name === "LOPHN_HOME" ? world.home : undefined },
    provider: () =>
      Promise.resolve({ ok: true, value: { token: world.token("all") } }),
  });
  await out.writable.close();
  await errs.writable.close();
  const text = await stdout;
  await stderr;
  return { exit, value: JSON.parse(text) as Record<string, unknown> };
}

function dataOf(reply: Cli): Record<string, unknown> {
  return reply.value["data"] as Record<string, unknown>;
}

// MCP data는 route 출력이다. CLI data와 같은 키의 사실이 같다.
function sameFacts(
  mcp: Record<string, unknown>,
  cliData: Record<string, unknown>,
  label: string,
): void {
  for (const [key, value] of Object.entries(cliData)) {
    assertEquals(mcp[key], value, `${label}: ${key}`);
  }
}

Deno.test("coding-agent/cli#R11 coding-agent/cli#R12 coding-agent/cli#R13: CLI로 전체 목차→자리 목차→문서 목차→구역 목차→본문(잘림·이어 읽기)→검색이 이어지고 MCP와 같은 사실이며 구역 이력도 같다", async () => {
  const world = await openScopeWorld(DOCUMENT_OPERATIONS);
  try {
    await Deno.writeTextFile(`${world.work}/plan.md`, TEXT);
    const saved = await saveFromPaths(world.saveDeps("all"), {
      paths: ["plan.md"],
      place: { kind: "project", id: world.project },
      slug: "plan",
    });
    assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
    await world.index(saved.value.saved, "plan", TEXT);
    const reference = {
      document: saved.value.saved.document,
      version: saved.value.saved.version,
      section: null,
    };
    const place = { kind: "project", id: world.project };

    // 1. 전체 목차
    const root = await cli(world, ["index"], { op: "root" });
    assertEquals(root.exit, 0, JSON.stringify(root.value));
    sameFacts(
      (await world.mcp("all", "lophn_index", { op: "root" })).data,
      dataOf(root),
      "root",
    );
    assert(
      (dataOf(root).entries as { kind: string }[]).some((entry) =>
        entry.kind === "project"
      ),
    );

    // 2. 자리 목차
    const placeIndex = await cli(world, ["index"], { op: "place", place });
    assertEquals(placeIndex.exit, 0, JSON.stringify(placeIndex.value));
    sameFacts(
      (await world.mcp("all", "lophn_index", { op: "place", place })).data,
      dataOf(placeIndex),
      "place",
    );

    // 3. 문서 목차
    const document = await cli(world, ["index"], { op: "document", reference });
    assertEquals(document.exit, 0, JSON.stringify(document.value));
    sameFacts(
      (await world.mcp("all", "lophn_index", { op: "document", reference }))
        .data,
      dataOf(document),
      "document",
    );
    const keys = (dataOf(document).entries as { key: string }[]).map((entry) =>
      entry.key
    );
    assert(keys.includes("개요"), JSON.stringify(keys));

    // 4. 구역 목차
    const sectionRef = { ...reference, section: "개요" };
    const section = await cli(world, ["index"], {
      op: "section",
      reference: sectionRef,
    });
    assertEquals(section.exit, 0, JSON.stringify(section.value));
    sameFacts(
      (await world.mcp("all", "lophn_index", {
        op: "section",
        reference: sectionRef,
      })).data,
      dataOf(section),
      "section",
    );

    // 5. 본문: 짧게 끊어 읽으면 잘렸다고 알리고 cursor로 이어 읽은 합이 전체 본문이다. MCP와 같은 조각이다.
    const first = await cli(world, ["read"], {
      reference,
      section: "개요",
      max_codepoints: 20,
    });
    assertEquals(first.exit, 0, JSON.stringify(first.value));
    const firstData = dataOf(first);
    assertEquals(firstData.complete, false);
    assert(typeof firstData.next_cursor === "string");
    sameFacts(
      (await world.mcp("all", "lophn_read", {
        reference,
        section: "개요",
        max_codepoints: 20,
      })).data,
      firstData,
      "read",
    );
    const rest = await cli(world, ["read"], {
      reference,
      section: "개요",
      cursor: firstData.next_cursor,
    });
    assertEquals(rest.exit, 0, JSON.stringify(rest.value));
    const joined = `${firstData.text}${dataOf(rest).text}`;
    assert(joined.includes("첫째 줄이다."), joined);
    assert(joined.includes("넷째 줄이다."), joined);
    assertEquals(dataOf(rest).complete, true);

    // 6. keyword 검색의 결과 reference로 그대로 본문을 읽는다.
    const search = await cli(world, ["search"], { query: "여섯 단계" });
    assertEquals(search.exit, 0, JSON.stringify(search.value));
    sameFacts(
      (await world.mcp("all", "lophn_index", {
        op: "search",
        query: "여섯 단계",
      })).data,
      dataOf(search),
      "search",
    );
    const hits = dataOf(search).results as {
      document: string;
      reference: { document: string; version: string; section?: string | null };
    }[];
    assertEquals(hits.map((hit) => hit.document), [reference.document]);
    const viaSearch = await cli(world, ["read"], {
      reference: {
        ...hits[0].reference,
        section: hits[0].reference.section ?? null,
      },
    });
    assertEquals(viaSearch.exit, 0, JSON.stringify(viaSearch.value));

    // 구역 이력: section을 주면 그 key의 판별 변화이고 MCP `lophn_document history`와 같다.
    const history = await cli(world, ["document", "history"], {
      document: reference.document,
      section: "개요",
    });
    assertEquals(history.exit, 0, JSON.stringify(history.value));
    sameFacts(
      (await world.mcp("all", "lophn_document", {
        op: "history",
        document: reference.document,
        section: "개요",
      })).data,
      dataOf(history),
      "section history",
    );
    assert(Array.isArray(dataOf(history).entries));
    // section이 없으면 고정 판 목록이다.
    const versions = await cli(world, ["document", "history"], {
      document: reference.document,
    });
    assertEquals(versions.exit, 0, JSON.stringify(versions.value));
    assert(Array.isArray(dataOf(versions).versions));
  } finally {
    await world.dispose();
  }
});
