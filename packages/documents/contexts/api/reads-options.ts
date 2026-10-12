// context API 읽기: context.input_options. 선언 검색의 고르는 입력(entity·value)에 보일 후보를 개체에서
// 모은다. 사람이 친 앞부분으로 거르고 개수를 자른다.
import { ok } from "../../../base/mod.ts";
import {
  type ContractType,
  INPUT_OPTIONS_DEFAULT,
} from "../../../protocol/projects/mod.ts";
import type { ContextApiReads } from "./reads.ts";
import {
  checkReader,
  common,
  compareText,
  invalidInput,
  searchableOf,
} from "./reads-common.ts";
import type { ContextApiState, EntityRow } from "./state.ts";

type Handlers = Pick<ContextApiReads, "contextInputOptions">;

type Scalar = string | number | boolean;
type Option = { value: Scalar; label: string };

const isScalar = (value: unknown): value is Scalar =>
  typeof value === "string" || typeof value === "number" ||
  typeof value === "boolean";

// ASCII 대문자만 소문자로 접는다. 비ASCII 글자는 그대로 둔다.
const fold = (text: string) =>
  text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

// 개체의 이름표: field `title`이 비어 있지 않은 글이면 그것, 아니면 key.
function titleOf(entity: EntityRow): string {
  const title = entity.fields.title;
  return typeof title === "string" && title.trim().length > 0
    ? title
    : entity.key;
}

function entityOptions(entities: readonly EntityRow[], type: string): Option[] {
  return entities
    .filter((entity) => entity.type === type)
    .sort((a, b) => compareText(a.key, b.key))
    .map((entity) => ({ value: entity.key, label: titleOf(entity) }));
}

function fieldValue(entity: EntityRow, field: string): unknown {
  if (field === "key") return entity.key;
  if (field === "path") return entity.path;
  return entity.fields[field] ?? null;
}

// 같은 종류끼리는 수는 크기, 글은 code unit 순이다. 종류가 섞이면 수, 글, boolean 순이다.
function compareScalars(a: Scalar, b: Scalar): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return compareText(a, b);
  const rank = (value: Scalar) =>
    typeof value === "number" ? 0 : typeof value === "string" ? 1 : 2;
  return rank(a) - rank(b) ||
    compareText(String(a), String(b));
}

function enumValues(type: ContractType | undefined, field: string): string[] {
  const declared = type?.fields.find((candidate) => candidate.name === field);
  return declared?.values ?? [];
}

function valueOptions(
  entities: readonly EntityRow[],
  type: ContractType | undefined,
  typeName: string,
  field: string,
): Option[] {
  // enum은 선언한 값 순서가 앞이다. 행이 없는 값도 후보다.
  const declared = enumValues(type, field);
  const seen = new Set<Scalar>(declared);
  const others: Scalar[] = [];
  for (const entity of entities) {
    if (entity.type !== typeName) continue;
    const value = fieldValue(entity, field);
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!isScalar(item) || seen.has(item)) continue;
      seen.add(item);
      others.push(item);
    }
  }
  others.sort(compareScalars);
  return [...declared, ...others].map((value) => ({
    value,
    label: String(value),
  }));
}

export function createOptionReads(state: ContextApiState): Handlers {
  const contextInputOptions: Handlers["contextInputOptions"] = (
    { actor, input },
  ) => {
    const allowed = checkReader(actor);
    if (!allowed.ok) return allowed;
    const target = searchableOf(state, input.context);
    if (!target.ok) return target;
    const { content } = target.value;

    const search = content.searches.find((candidate) =>
      candidate.name === input.search
    );
    if (search === undefined) {
      return invalidInput(`search ${input.search} is not declared`);
    }
    const declared = search.inputs.find((candidate) =>
      candidate.name === input.input
    );
    if (declared === undefined) {
      return invalidInput(`input ${input.input} is not declared`);
    }
    if (
      (declared.type !== "entity" && declared.type !== "value") ||
      declared.of === undefined
    ) {
      return invalidInput(`input ${input.input} has no candidates to pick`);
    }

    const entities = state.entities.get(target.value.context.id) ?? [];
    const [typeName, field] = declared.of.split(".") as [string, string?];
    const type = content.contract.types.find((candidate) =>
      candidate.name === typeName
    );
    const all = declared.type === "entity"
      ? entityOptions(entities, typeName)
      : field === undefined
      ? []
      : valueOptions(entities, type, typeName, field);

    const prefix = fold(input.prefix ?? "");
    const matching = prefix === ""
      ? all
      : all.filter((option) =>
        fold(String(option.value)).startsWith(prefix) ||
        fold(option.label).startsWith(prefix)
      );
    const limit = input.limit ?? INPUT_OPTIONS_DEFAULT;
    return ok({
      context: input.context,
      search: input.search,
      input: input.input,
      options: matching.slice(0, limit),
      complete: matching.length <= limit,
      ...common(state),
    });
  };

  return { contextInputOptions };
}
