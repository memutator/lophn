// 알려진 secret 원문은 보호 메모리에만 둔다.
// 이 목록을 agent·앱·test 결과로 내보내지 않는다.

// 읽기만 하는 얼굴. 등록·회수·개수 없이 일치 검사만 한다. 값 목록을 내보내지 않는다.

export type KnownSecretRegistry = {
  register(values: readonly string[]): void;
  // 회수한 값은 이 순간부터 알려진 값이 아니다. 없는 값은 무시한다.
  revoke(values: readonly string[]): void;
  clear(): void;
  readonly count: number;
  // 긴 값부터 정확 일치한다. 길이·개수로 값을 빼지 않는다.
  match(text: string): { index: number; length: number } | undefined;
  // text의 끝에서 시작하는 suffix가 어떤 값의 앞부분(1자 이상)인 가장 이른 자리다.
  // 끝에 닿은 값 전체도 넣는다: 1·2자 값은 다음 글자가 단어 경계일 때만 match라서 뒤에 글이 더 오면
  // 지울지가 바뀐다. 값 전체를 붙잡는 비용은 그 값의 replacement가 다음 batch까지 늦는 것뿐이다.
  prefixFrom(text: string): number | undefined;
  readonly maxLength: number;
};

export function createKnownSecretRegistry(): KnownSecretRegistry {
  const values = new Set<string>();
  // 긴 값부터. 같은 길이에서는 등록 순서를 유지한다.
  let ordered: string[] = [];
  let maxLength = 0;

  const rebuild = () => {
    ordered = [...values].sort((a, b) => b.length - a.length);
    maxLength = ordered[0]?.length ?? 0;
  };

  return {
    register(incoming) {
      let changed = false;
      for (const value of incoming) {
        if (value.length === 0 || values.has(value)) continue;
        values.add(value);
        changed = true;
        if (value.length > maxLength) maxLength = value.length;
      }
      if (!changed) return;
      // 긴 값 우선. 같은 길이는 등록 순서를 유지한다.
      rebuild();
    },
    revoke(outgoing) {
      let changed = false;
      for (const value of outgoing) {
        if (values.delete(value)) changed = true;
      }
      if (changed) rebuild();
    },
    clear() {
      values.clear();
      ordered = [];
      maxLength = 0;
    },
    get count() {
      return values.size;
    },
    get maxLength() {
      return maxLength;
    },
    match(text) {
      let best: { index: number; length: number } | undefined;
      for (const value of ordered) {
        const index = boundedIndex(text, value);
        if (index < 0) continue;
        if (
          !best ||
          index < best.index ||
          (index === best.index && value.length > best.length)
        ) {
          best = { index, length: value.length };
        }
      }
      return best;
    },
    prefixFrom(text) {
      // suffix가 값보다 길면 값의 앞부분일 수 없으므로 가장 긴 값만큼만 본다.
      const from = Math.max(0, text.length - maxLength);
      for (let index = from; index < text.length; index++) {
        for (const value of ordered) {
          if (value.length < text.length - index) continue;
          if (isPrefixAt(text, index, value)) return index;
        }
      }
      return undefined;
    },
  };
}

// index부터 text 끝까지가 value의 앞부분인지. 자리마다 남은 글을 만들지 않고 글자를 비교한다.
function isPrefixAt(text: string, index: number, value: string): boolean {
  for (let k = 0; index + k < text.length; k++) {
    if (text[index + k] !== value[k]) return false;
  }
  return true;
}

// 1자·2자는 단어 경계에서만 맞춘다. 긴 값의 부분 일치는 그대로 지운다.
function boundedIndex(text: string, value: string): number {
  let from = 0;
  while (from <= text.length - value.length) {
    const index = text.indexOf(value, from);
    if (index < 0) return -1;
    if (value.length > 2 || atWordEdge(text, index, value.length)) return index;
    from = index + 1;
  }
  return -1;
}

function atWordEdge(text: string, index: number, length: number): boolean {
  const edge = (char: string | undefined) =>
    char === undefined || !/[A-Za-z0-9]/.test(char);
  return (
    edge(index === 0 ? undefined : text[index - 1]) &&
    edge(index + length >= text.length ? undefined : text[index + length])
  );
}
