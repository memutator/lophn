import { canonicalize, sha256Hex } from "../../../../packages/base/mod.ts";

// system 블록 하나의 경계. text는 그 블록의 글이다.
export type Boundary = { layer: string; prefix_hash: string; text: string };

type WireBlock = { text?: unknown; cache_control?: unknown };

// layer 이름은 body만으로 붙인다: 새 assembly가 층을 더하거나 순서를 바꿔도 이름이 겹치지 않고 어긋남이 보이게 한다.
function layerNames(texts: string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((text, i) => {
    const base =
      i === 0
        ? "place_kind"
        : text.startsWith("# Instructions")
          ? "instructions"
          : text.startsWith("# Skills")
            ? "skills"
            : i === texts.length - 1
              ? "place"
              : `block${i}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

// 제품의 cache_boundaries와 같은 식이다(turn-prompt.ts). 보낸 요청 body에서 다시 계산한다.
// wire body의 tools와 system이 그 식의 입력 전부다. 식이 바뀌면 prefix_test가 깨진다.
export async function prefixBoundaries(body: unknown): Promise<Boundary[]> {
  const { tools, system } = (body ?? {}) as {
    tools?: unknown;
    system?: unknown;
  };
  if (!Array.isArray(system)) return [];
  const blocks = system as WireBlock[];
  const texts = blocks.map((b) => String(b.text ?? ""));
  const names = layerNames(texts);
  const out: Boundary[] = [];
  let prefix = await sha256Hex(canonicalize(tools ?? []));
  for (let i = 0; i < blocks.length; i++) {
    prefix = await sha256Hex(`${prefix}\n${texts[i]}`);
    if (blocks[i].cache_control) {
      out.push({ layer: names[i], prefix_hash: prefix, text: texts[i] });
    }
  }
  return out;
}
