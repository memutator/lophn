// fake source의 값이 context API 계약 schema에 맞는지 본다. 이 시험은 화면이 아니라 시험 자료를
// 지키므로 처음부터 통과한다(화면 시험은 `*_test.tsx`가 맡는다).
import { assert, assertEquals } from "@std/assert";

import {
  bundleSummarySchema,
  checkReportSchema,
  contextListItemSchema,
  glossaryEntrySchema,
  savedViewListItemSchema,
  searchRowSchema,
  storedViolationSchema,
} from "../../../../../packages/contracts/documents/context-api.ts";
import { bundleContentSchema } from "../../../../../packages/contracts/documents/context-contract.ts";
import {
  createFakeContextsSource,
  EVAL,
  HARNESS,
  PROJECT,
  RELEASE_NOTES,
} from "./fake-source.ts";

Deno.test("shell/workspace#R16 [ctx-S17]: fake source의 값은 context API 계약 schema에 맞는다", async () => {
  const source = createFakeContextsSource({ drafting: true });
  const listed = await source.list(PROJECT);
  assert(listed.ok);
  assertEquals(
    listed.value.map((item) => contextListItemSchema.parse(item).title),
    ["eval", "harness", "release-notes"],
  );
  for (const context of [EVAL, HARNESS, RELEASE_NOTES]) {
    const bundles = await source.bundles(context);
    assert(bundles.ok);
    for (const { bundle, check } of bundles.value) {
      bundleSummarySchema.parse(bundle);
      if (check !== null) checkReportSchema.parse(check);
    }
    const contract = await source.contract(context);
    assert(contract.ok);
    if (contract.value !== null) bundleContentSchema.parse(contract.value);
    const violations = await source.violations(context);
    assert(violations.ok);
    violations.value.violations.forEach((v) => storedViolationSchema.parse(v));
    const glossary = await source.glossary(context);
    assert(glossary.ok);
    glossary.value.forEach((entry) => glossaryEntrySchema.parse(entry));
    const views = await source.savedViews(context);
    assert(views.ok);
    views.value.forEach((view) => savedViewListItemSchema.parse(view));
  }
  const page = await source.search({
    context: EVAL,
    search: "findings_about_change",
    inputs: {},
  });
  assert(page.ok);
  assertEquals(page.value.rows.length, 5);
  assertEquals(page.value.total, 14);
  page.value.rows.forEach((row) => searchRowSchema.parse(row));
});
