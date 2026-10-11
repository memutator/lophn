// context API 읽기: context.entity·context.series_next. 둘 다 적용된 판의 index(state.entities)만 읽는다.
// entity는 개체 하나의 field와 관계 대상을, series_next는 series kind type의 개체 경로들로 다음 이름을
// 계산한다(계산은 series/next.ts). 파일을 읽지 않고 아무것도 바꾸지 않는다.
// 규칙은 docs/domain-model/documents/contexts.md "읽기"의 entity·series_next다.
import { err, ok } from "../../../base/mod.ts";
import type { EntityRef } from "../../../contracts/documents/mod.ts";
import { nextName, parsePattern } from "../series/next.ts";
import type { ContextApiReads } from "./reads.ts";
import {
  checkReader,
  common,
  invalidInput,
  notFound,
  searchableOf,
} from "./reads-common.ts";
import type { ContextApiState, EntityRow } from "./state.ts";

type Handlers = Pick<ContextApiReads, "contextEntity" | "contextSeriesNext">;

const refOf = (row: EntityRow): EntityRef => ({
  type: row.type,
  key: row.key,
  path: row.path,
  section: row.section,
});

export function createEntityReads(state: ContextApiState): Handlers {
  const contextEntity: Handlers["contextEntity"] = ({ actor, input }) => {
    const reader = checkReader(actor);
    if (!reader.ok) return reader;
    const target = searchableOf(state, input.context);
    if (!target.ok) return target;
    const { applied, content } = target.value;

    const type = content.contract.types.find((candidate) =>
      candidate.name === input.type
    );
    if (type === undefined) {
      return invalidInput(`type ${input.type} is not in the contract`);
    }
    const rows = state.entities.get(input.context) ?? [];
    // 추출 순서의 첫 개체다. app-data 개체는 index에 없으므로 그대로 not_found가 된다.
    const row = rows.find((candidate) =>
      candidate.type === type.name && candidate.key === input.key
    );
    if (row === undefined) {
      return notFound("entity", `${input.type}/${input.key}`);
    }

    const fields: Record<string, unknown> = {};
    for (const field of type.fields) {
      fields[field.name] = row.fields[field.name] ?? null;
    }
    const relations = type.relations.map((relation) => {
      // 다른 context의 type(`context/type`)은 싣지 않는다.
      const targets: EntityRef[] = [];
      if (!relation.to.includes("/")) {
        for (const link of row.links ?? []) {
          if (link.relation !== relation.name) continue;
          const found = rows.find((candidate) =>
            candidate.type === relation.to && candidate.key === link.target_key
          );
          if (found !== undefined) targets.push(refOf(found));
        }
      }
      return { name: relation.name, label: relation.label, targets };
    });
    return ok({
      context: input.context,
      bundle_hash: applied.bundle_hash!,
      ref: refOf(row),
      fields,
      relations,
      ...common(state),
    });
  };

  const contextSeriesNext: Handlers["contextSeriesNext"] = (
    { actor, input },
  ) => {
    const reader = checkReader(actor);
    if (!reader.ok) return reader;
    const target = searchableOf(state, input.context);
    if (!target.ok) return target;

    const type = target.value.content.contract.types.find((candidate) =>
      candidate.name === input.type
    );
    if (type === undefined) {
      return invalidInput(`type ${input.type} is not in the contract`);
    }
    if (type.source.kind !== "series") {
      return invalidInput(`type ${input.type} is not a series kind`);
    }
    const pattern = parsePattern(type.source.pattern);
    if (!pattern.ok) return err(pattern.error);
    const paths = (state.entities.get(input.context) ?? [])
      .filter((row) => row.type === type.name)
      .map((row) => row.path);
    return ok({
      context: input.context,
      type: type.name,
      pattern: type.source.pattern,
      next: nextName(pattern.value, paths),
      ...common(state),
    });
  };

  return { contextEntity, contextSeriesNext };
}
