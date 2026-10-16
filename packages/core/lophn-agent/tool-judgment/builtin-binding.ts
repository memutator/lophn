import { err, ok, type Result } from "../../../base/mod.ts";
import type { JsonObject } from "../../../protocol/base/mod.ts";
import type { ResolvedAction, ToolBinding } from "./mod.ts";
import type { ToolDefinition } from "../tools/mod.ts";

// 내장 쓰기 tool의 소유 계약 연결이다. 호출 입력에서
// 정확한 대상을 읽고, 대상이 이 run의 자격으로 보이는지 소유 contract의 읽기로 확인한 뒤에만
// 범위 안으로 올린다. 읽지 못하면 연결이 오류를 내고 호출은 없는 tool·대상과 같은 답으로 거절된다.
// 되돌림은 정의가 선언한 값(소유 contract가 되돌릴 수 있는 변경인지)이고 model의 말이 아니다.

export type BindingRun = {
  // 이 run의 agent 자격으로 소유 contract를 이름으로 부른다(읽기 확인용).
  call(contract: string, input: unknown): Promise<Result<unknown>>;
  // 이 run이 닿는 대상 ID. 확인을 마친 대상만 더한다.
  reach: Set<string>;
  run: string;
  assignment: string;
};

type Input = Record<string, unknown>;

type Spec = {
  // 소유 concern의 이름(approval 동작의 concern).
  concern: string;
  // 입력이 가리키는 정확한 대상. 새로 만드는 것은 호출 run이 대상이다.
  targets(input: Input, run: BindingRun): string[];
  // 쓰기 계약이 요구하는 비교 기준.
  comparison?(input: Input): JsonObject;
  changes(input: Input): string;
  // 대상이 이 run의 자격으로 보이는지 묻는 소유 contract의 읽기. 없으면 확인할 읽기가 없다.
  // input이 undefined면 확인할 대상 읽기가 없다(자리 없는 새 문서).
  verify?: { contract: string; input(input: Input): unknown };
};

const text = (value: unknown): string => typeof value === "string" ? value : "";

// 읽은 revision이 있으면 비교 기준이다. 새로 만들 때는 없다.
const revisionOf = (input: Input): JsonObject =>
  input["base_revision"] === undefined
    ? {}
    : { base_revision: text(input["base_revision"]) };

const SPECS: ReadonlyMap<string, Spec> = new Map<string, Spec>([
  ["ticket.create", {
    concern: "coding-agent/tickets",
    targets: (input) => [text(input["app"])],
    changes: (input) => `creates a ticket titled ${text(input["title"])}`,
    verify: {
      contract: "ListTickets",
      input: (input) => ({ app: input["app"] }),
    },
  }],
  // Context Engineer의 쓰기다. context 생성은 project가, 초안은 context가, 제출은 만든 판이,
  // 용어집 항목은 항목(새 항목은 context)이 대상이다. 판과 항목 id만으로는 대상 읽기가 없어 소유 contract가
  // 실행 때 자격으로 막는다.
  ["context.create", {
    concern: "documents/contexts",
    targets: (input) => [text(input["project"])],
    changes: (input) => `creates a context titled ${text(input["title"])}`,
  }],
  ["context.draft", {
    concern: "documents/contexts",
    targets: (input) => [text(input["context"])],
    comparison: revisionOf,
    changes: () => "writes the draft bundle of a context",
    verify: {
      contract: "context.draft",
      input: (input) => ({ context: input["context"] }),
    },
  }],
  ["context.submit", {
    concern: "documents/contexts",
    targets: (input) => [text(input["bundle"])],
    changes: () => "submits a draft bundle to be checked and applied",
  }],
  ["context.glossary_write", {
    concern: "documents/terms",
    targets: (input) => [text(input["entry"] ?? input["context"])],
    comparison: revisionOf,
    changes: (input) =>
      input["entry"] === undefined
        ? "adds a glossary entry to a context"
        : input["remove"] === true
        ? "removes a glossary entry"
        : "changes a glossary entry",
    verify: {
      contract: "glossary.list",
      input: (input) =>
        input["context"] === undefined
          ? undefined
          : { context: input["context"] },
    },
  }],
  ["visual.show", {
    concern: "lophn-agent/conversation",
    targets: (_input, run) => [run.run],
    changes: () => "adds an answer with visuals to the session",
  }],
]);

function unavailable(): Result<never> {
  return err({
    code: "not_found",
    message: "the tool or target is not available",
  });
}

// 내장 쓰기 tool 하나의 연결이다. 읽기 tool과 연결 목록에 없는 tool은 없다.
export function builtinBinding(
  definition: ToolDefinition,
  run: BindingRun,
): ToolBinding | undefined {
  const spec = SPECS.get(definition.name);
  if (spec === undefined || definition.effect === "read") return undefined;
  return {
    async resolve(raw): Promise<Result<ResolvedAction>> {
      const input = raw as Input;
      const targets = spec.targets(input, run);
      if (targets.length === 0 || targets.some((target) => target === "")) {
        return unavailable();
      }
      const readInput = spec.verify?.input(input);
      if (spec.verify !== undefined && readInput !== undefined) {
        const seen = await run.call(spec.verify.contract, readInput);
        // 사람의 결정을 기다리는 run을 이을 때는 이 process에 agent 자격이 아직 없다(unauthorized).
        // 그때는 판정 때 확인한 같은 대상·입력(비교 기준)이고, 소유 contract가 실행 때 자격으로 다시
        // 막는다. 그 밖의 거절은 없는 대상과 같다.
        if (!seen.ok && seen.error.code !== "unauthorized") {
          return unavailable();
        }
      }
      // 확인이 끝난 대상만 이 run의 범위로 올린다.
      for (const target of targets) run.reach.add(target);
      return ok({
        concern: spec.concern,
        operation: definition.contract,
        contractRevision: definition.revision,
        targets: targets.map((id) => ({
          id,
          reversibility: definition.reversible
            ? "reversible" as const
            : "unknown" as const,
        })),
        comparison: spec.comparison?.(input) ?? {},
        changes: spec.changes(input),
        external: null,
        reversibility: definition.reversible
          ? "a person can revert what this run changed"
          : "not guaranteed",
      });
    },
  };
}
