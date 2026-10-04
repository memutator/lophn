// fixtures/model의 녹화 응답을 script step으로 읽는다. 자동 녹화는 하지 않는다.
import { parseScript } from "./script.ts";
import type { Step } from "./types.ts";

export async function loadFixture(path: string): Promise<Step[]> {
  const parsed: unknown = JSON.parse(await Deno.readTextFile(path));
  return parseFixture(parsed);
}

export function parseFixture(parsed: unknown): Step[] {
  if (!isRecord(parsed) || parsed.synthetic !== true) {
    throw new Error("fixture가 합성 자료가 아님");
  }
  if (
    parsed.version !== 1 ||
    Object.keys(parsed).some((key) =>
      !["version", "protocol", "synthetic", "interactions"].includes(key)
    )
  ) throw new Error("fixture version/field가 잘못됨");
  const protocol = parsed.protocol;
  const interactions = parsed.interactions;
  if (
    protocol !== "messages" && protocol !== "responses" &&
    protocol !== "chat_completions"
  ) {
    throw new Error("fixture protocol이 잘못됨");
  }
  if (!Array.isArray(interactions)) {
    throw new Error("fixture interactions가 없음");
  }
  const steps = interactions.map((interaction, index) => {
    if (!isRecord(interaction) || !isRecord(interaction.response)) {
      throw new Error("fixture interaction이 잘못됨");
    }
    if (
      Object.keys(interaction).some((key) =>
        !["request", "response"].includes(key)
      )
    ) throw new Error("fixture interaction field가 잘못됨");
    return {
      id: `${protocol}-${index + 1}`,
      protocol,
      match: interaction.request,
      response: interaction.response,
    };
  });
  return parseScript({ steps }).steps;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
