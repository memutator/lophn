// 검사와 preview 요청에 싣는 환경(docs/domain-model/documents/contexts.md "다른 context의 type 참조",
// "앱 command 효과"). core가 ledger에서 읽어 싣고 worker는 다른 context의 파일이나 앱을 읽지 않는다.
// - external_types: 같은 Project의 다른 active context가 적용한 판의 type 목록(제목으로 찾는다).
// - app_commands: 판의 app-data Source가 가리키는 (app, command)의 앱 선언 효과.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type BundleContent,
  bundleContentSchema,
  type ContextWorkInput,
} from "../../../../protocol/projects/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import type { ContextLedgerDeps } from "./adapter.ts";
import { loadBundle, loadProjectContexts } from "./rows.ts";

type ExternalTypes = ContextWorkInput["external_types"];
type AppCommands = ContextWorkInput["app_commands"];
type Reader = Pick<Sql, "get" | "all">;

// 앱 command 선언의 효과. 앱 등록이 선언을 찾지 못하면 undefined다.
export type AppCommandEffectLookup = (
  app: string,
  command: string,
) => AppCommands[number]["effect"] | undefined;

// 한 context의 판이 다른 context에 내놓는 type 목록(계약의 type 순서). private인 type도 visibility를 달아
// 싣는다: 검사가 "없다"와 "private이다"를 구별해 알린다. source·rules·relations는 싣지 않는다.
export function externalTypesOf(
  title: string,
  content: BundleContent,
): ExternalTypes {
  return content.contract.types.map((type) => ({
    context: title,
    name: type.name,
    visibility: type.visibility,
    key: type.key,
    fields: type.fields.map((field) => ({
      name: field.name,
      visibility: field.visibility,
      value_type: field.value_type,
    })),
  }));
}

// 같은 Project의 다른 context 중 active이고 적용된 판이 있는 것의 type 목록. 자기 자신, drafting,
// archived는 뺀다. context id 순이다. 적용된 판을 읽지 못하면 오류다(없는 참조로 꾸미지 않는다).
export function externalTypesRead(
  sql: Reader,
  deps: Pick<ContextLedgerDeps, "blobs">,
  self: { id: string; project: string },
): Result<ExternalTypes> {
  const found: ExternalTypes = [];
  for (const context of loadProjectContexts(sql, self.project)) {
    if (
      context.id === self.id || context.status !== "active" ||
      context.applied_bundle === null
    ) continue;
    const bundle = loadBundle(sql, context.applied_bundle);
    const read = bundle === null ? undefined : deps.blobs.read(
      bundle.content_ref,
    );
    const content = read?.ok
      ? bundleContentSchema.safeParse(read.value)
      : undefined;
    if (!content?.success) {
      return err({
        code: "internal",
        message: `the applied bundle of ${context.id} is not readable`,
      });
    }
    found.push(...externalTypesOf(context.title, content.data));
  }
  return ok(found);
}

// 판의 app-data Source가 가리키는 (app, command) 쌍에 앱 선언의 효과를 붙인다. 앱 선언이 없는 쌍은
// 싣지 않아 worker가 알 수 없는 command로 본다. 내용이 BundleContent 모양이 아니면 비어 있다(모양은
// worker의 검사가 알린다). (app, command)의 code unit 순이고 중복이 없다.
export function appCommandsOf(
  content: Record<string, unknown>,
  effectOf: AppCommandEffectLookup | undefined,
): AppCommands {
  const parsed = bundleContentSchema.safeParse(content);
  if (!parsed.success || effectOf === undefined) return [];
  const pairs = new Map<string, { app: string; command: string }>();
  for (const type of parsed.data.contract.types) {
    if (type.source.kind !== "app-data") continue;
    const { app, command } = type.source;
    pairs.set(`${app}\u0000${command}`, { app, command });
  }
  const commands: AppCommands = [];
  for (const key of [...pairs.keys()].sort()) {
    const { app, command } = pairs.get(key)!;
    const effect = effectOf(app, command);
    if (effect !== undefined) commands.push({ app, command, effect });
  }
  return commands;
}
