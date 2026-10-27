import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { InstructionLayerKind } from "./model.ts";
import { DOMAIN_TEXT_BUDGET, readTurnInstructions } from "./turn.ts";

function setup(docs: Record<string, string>) {
  const requested: string[] = [];
  const deps = {
    files: {
      read(layer: InstructionLayerKind, domain?: string) {
        requested.push(`${layer}:${domain ?? ""}`);
        const text = domain === undefined ? undefined : docs[domain];
        const bytes = new TextEncoder().encode(text ?? "");
        return Promise.resolve(
          ok(
            domain !== undefined && text === undefined
              ? null
              : layer === "domain"
              ? { size_bytes: bytes.length, bytes }
              : null,
          ),
        );
      },
    },
    redact: (text: string) => text,
  };
  return { deps, requested };
}

const A = { id: "dom_a", name: "alpha", purpose: "a purpose" };
const B = { id: "dom_b", name: "beta", purpose: "b purpose" };

test("turn은 맡은 domain의 DOMAIN.md만 읽고 이름순으로 잇는다", async () => {
  const { deps, requested } = setup({
    dom_a: "rules of alpha",
    dom_b: "rules of beta",
    dom_other: "must not be read",
  });
  const result = await readTurnInstructions(deps, { role: "operator" }, [B, A]);
  assert.deepStrictEqual(
    requested.filter((r) => r.startsWith("domain:")),
    ["domain:dom_a", "domain:dom_b"],
  );
  if (result.status !== "ready") throw new Error("blocked");
  const domain = result.layers.find((l) => l.layer === "domain");
  assert.deepStrictEqual(
    domain?.text,
    "## alpha\nrules of alpha\n\n## beta\nrules of beta",
  );
});

test("예산을 넘은 domain부터 본문 없이 purpose 한 줄만 싣는다", async () => {
  const big = "x".repeat(DOMAIN_TEXT_BUDGET - 100);
  const { deps } = setup({ dom_a: big, dom_b: big });
  const result = await readTurnInstructions(deps, { role: "operator" }, [A, B]);
  if (result.status !== "ready") throw new Error("blocked");
  const text = result.layers.find((l) => l.layer === "domain")?.text;
  assert.deepStrictEqual(
    text,
    `## alpha\n${big}\n\n## beta\nb purpose\nfull text: read DOMAIN.md`,
  );
});
