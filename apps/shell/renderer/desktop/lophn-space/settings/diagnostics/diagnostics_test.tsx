// settings 진단 자리 화면 테스트(shell#T58). 보안 상태 점검과 doctor 결과가 영향 한 문장과
// 다음 행동으로만 보이는지, 원문은 개발자 diagnostics 펼침에만 있는지 가짜 통로로 확인한다.
import { assert, assertEquals } from "@std/assert";
import {
  click,
  render,
} from "../../../../../../../packages/design/components/testing.ts";

import { DiagnosticsPanel } from "./diagnostics-panel.tsx";
import { fakeDiagnostics } from "./testdata/fake-source.ts";
import { find, flush } from "../../testdata/dom.ts";

function textOf(root: Element): string {
  return root.textContent ?? "";
}

Deno.test("flow update-lophn: 진단 결과는 영향 한 문장과 다음 행동을 보이고 원문은 펼친 자리에만 있다", async () => {
  const { source, calls } = fakeDiagnostics({
    view: {
      rows: [
        { check: "broad_grant", finding: null },
        {
          check: "raw_key_pattern",
          finding: {
            impact: "raw_key",
            raw: "records contain sk-ant-… in tool inputs",
            at: "2026-10-06T00:00:00.000Z",
          },
        },
        {
          check: "broad_grant",
          finding: {
            impact: "wide_grant",
            raw: "credential asks read+write+network",
            at: "2026-10-06T00:00:00.000Z",
          },
        },
      ],
      observedAt: "2026-10-06T00:00:00.000Z",
    },
  });
  using view = render(<DiagnosticsPanel source={source} />);
  await flush();
  // 검사는 사람이 누를 때만 돌린다.
  assertEquals(calls.some((call) => call[0] === "check"), false);
  click(find(view.container, "[data-action='check']"));
  await flush();
  assertEquals(calls.some((call) => call[0] === "check"), true);
  const findings = [...view.container.querySelectorAll("[data-finding]")];
  assertEquals(findings.length, 2, JSON.stringify(findings.map(textOf)));
  // 영향 한 문장과 다음 행동 하나. 원문은 기본 화면에 없다.
  const first = textOf(findings[0]!);
  assert(
    first.includes("A record holds a key that looks like a saved password"),
    first,
  );
  assert(
    first.includes("Replace the key to keep it out of records."),
    first,
  );
  const second = textOf(findings[1]!);
  assert(
    second.includes("A connection can read more than it needs."),
    second,
  );
  assert(
    second.includes("Give the connection a smaller scope."),
    second,
  );
  // 원문 펼침은 접힌 채로 둔다. 클릭 전에는 원문 목차가 없다.
  assertEquals(view.container.querySelector("[data-raw]"), null);
  // 원문은 개발자 diagnostics 펼침에만 있다(shell/wording#R8).
  click(find(view.container, "[data-action='raw']"));
  await flush();
  const raw = textOf(find(view.container, "[data-raw]"));
  assert(raw.includes("sk-ant-"), raw);
  assert(raw.includes("broad_grant"));
});

Deno.test("flow update-lophn: 문제가 없으면 한 문장으로 말하고 검사를 돌리지 못하면 다시 시도를 보인다", async () => {
  const clean = fakeDiagnostics({
    view: {
      rows: [
        { check: "broad_grant", finding: null },
        { check: "raw_key_pattern", finding: null },
      ],
      observedAt: "2026-10-06T00:00:00.000Z",
    },
  });
  using view = render(<DiagnosticsPanel source={clean.source} />);
  await flush();
  click(find(view.container, "[data-action='check']"));
  await flush();
  assert(
    textOf(find(view.container, "[data-check-result='clean']")).includes(
      "No problems were found in the security check.",
    ),
  );

  const broken = fakeDiagnostics({ checkFails: true });
  using second = render(<DiagnosticsPanel source={broken.source} />);
  await flush();
  click(find(second.container, "[data-action='check']"));
  await flush();
  assertEquals(
    find(second.container, "[data-check='failed']").textContent,
    "The check couldn't start right now. Try again.",
  );
});
