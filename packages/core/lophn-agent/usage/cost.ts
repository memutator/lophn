import type {
  PriceBasis,
  PriceRate,
  TokenUsage,
} from "../../../protocol/lophn-agent/mod.ts";

// 비용은 float 없이 십진수 문자열로만 계산·저장한다(plan 완료: 십진수 문자열로
// 입력·계산·저장, float 변환 없음). 요율은 1000000 token당 금액이다.
const TOKENS_PER_UNIT = "1000000";

// 십진수 문자열은 nonnegativeDecimalSchema(/^(0|[1-9][0-9]*)(\.[0-9]+)?/)다.
function parts(value: string): { whole: bigint; frac: bigint; width: number } {
  const [int, frac = ""] = value.split(".");
  return {
    whole: BigInt(int),
    frac: frac === "" ? 0n : BigInt(frac),
    width: frac.length,
  };
}

function trim(value: bigint, width: number): string {
  if (width === 0) return value.toString();
  const scale = 10n ** BigInt(width);
  const whole = value / scale;
  const frac = value % scale;
  if (frac === 0n) return whole.toString();
  const text = frac.toString().padStart(width, "0").replace(/0+$/, "");
  return `${whole}.${text}`;
}

// 분해한 십진수를 공통 자릿수 고정점 값으로 맞춘다. 호출이 항상 넓은 쪽을
// width로 주므로 자릿수 줄임은 없다.
function align(
  value: { whole: bigint; frac: bigint; width: number },
  width: number,
): bigint {
  if (value.width === width) {
    return value.whole * 10n ** BigInt(width) + value.frac;
  }
  return value.whole * 10n ** BigInt(width) +
    value.frac * 10n ** BigInt(width - value.width);
}

// 십진수 문자열 더하기. 소수 자릿수는 양쪽 중 큰 값이고 값은 정확하다.
function decimalSum(a: string, b: string): string {
  const left = parts(a);
  const right = parts(b);
  const width = Math.max(left.width, right.width);
  return trim(align(left, width) + align(right, width), width);
}

// tokens × rate ÷ 1000000을 십진수 문자열로 돌려준다. 하나의 정수 나눗셈으로
// 소수 6자리까지 내려 중간 반올림이 없어 재계산 결과가 같다.
function decimalMulDiv(tokens: bigint, rate: string): string {
  const rateParts = parts(rate);
  const unitParts = parts(TOKENS_PER_UNIT);
  const width = Math.max(rateParts.width, unitParts.width);
  const scaled = tokens * align(rateParts, width) * 10n ** 6n /
    align(unitParts, width);
  return trim(scaled, 6);
}

// 그 call의 과금 token 구간. 새 입력, cache 읽기, cache 쓰기는 각자 요율로 센다(없는 cache 요율은 input 요율).
// 저장된 input은 adapter가 이미 cache를 뺀 새 입력이다. `cache_in_input`은 provider가 원래 어떻게 세는지를 적은
// 표시라 여기서 다시 빼지 않는다(빼면 OpenAI 계열의 cache가 두 번 빠진다).
type ChargedTokens = {
  input: bigint | null;
  cacheRead: bigint;
  cacheWrite: bigint;
  output: bigint | null;
  reasoning: bigint | null;
};

function chargedTokens(usage: TokenUsage): ChargedTokens {
  const cacheRead = BigInt(usage.cache_read ?? 0);
  const cacheWrite = BigInt(usage.cache_write ?? 0);
  const input = usage.input === null ? null : BigInt(usage.input);
  const output = usage.output === null ? null : BigInt(usage.output);
  const reasoning = usage.reasoning === null ? null : BigInt(usage.reasoning);
  return { input, cacheRead, cacheWrite, output, reasoning };
}

// 추정 금액. 겹치지 않는 과금 token 구간 × 당시 요율을 십진수로 더한다.
// 필요한 usage·가격이 하나라도 모르면 null이다(null은 금액 unknown이다).
export function estimatedCost(
  usage: TokenUsage,
  basis: PriceBasis,
): {
  amount: string | null;
  rate_basis: unknown;
} {
  if (basis.currency !== "USD") return { amount: null, rate_basis: null };
  const tokens = chargedTokens(usage);
  const rate = rateFor(basis.rates);
  if (rate === undefined || rate.input === null || rate.output === null) {
    return { amount: null, rate_basis: null };
  }
  if (tokens.input === null || tokens.output === null) {
    return { amount: null, rate_basis: null };
  }
  const cacheReadRate = rate.cache_read ?? rate.input;
  const cacheWriteRate = rate.cache_write ?? rate.input;
  // 별도 추론 요율이 있으면 출력에서 추론을 빼고 각각 곱한다.
  let output = tokens.output;
  const charged: [string, bigint, string][] = [
    ["input", tokens.input, rate.input],
    ["cache_read", tokens.cacheRead, cacheReadRate],
    ["cache_write", tokens.cacheWrite, cacheWriteRate],
  ];
  if (rate.reasoning !== null && tokens.reasoning !== null) {
    if (usage.reasoning_in_output !== false) {
      output = output > tokens.reasoning ? output - tokens.reasoning : 0n;
    }
    charged.push(["reasoning", tokens.reasoning, rate.reasoning]);
  }
  charged.push(["output", output, rate.output]);
  const amount = charged.reduce(
    (total, [, count, per]) => decimalSum(total, mulDiv(count, per)),
    "0",
  );
  return { amount, rate_basis: rateBasisOf(basis, rate, usage, charged) };
}

// 어느 token에 어느 요율을 곱했는지 남긴다. cache 요율이 없어 input 요율로 센 것도 여기서 보인다.
function rateBasisOf(
  basis: PriceBasis,
  rate: PriceRate,
  usage: TokenUsage,
  charged: readonly (readonly [string, bigint, string])[],
): unknown {
  return {
    source: basis.source,
    revision: basis.revision,
    checked_at: basis.checked_at,
    rates: [rate],
    tokens: usage,
    charged: Object.fromEntries(
      charged.map(([name, count, per]) => [
        name,
        { tokens: count.toString(), rate: per },
      ]),
    ),
    per_unit: TOKENS_PER_UNIT,
  };
}

function rateFor(rates: readonly PriceRate[]): PriceRate | undefined {
  // 당시 snapshot의 구간 경계는 등록 시점에 검사됐다. 당시 call의 문맥 구간
  // 기준은 call 기록에 없어 첫 요율을 쓴다. 여러 구간인 snapshot의 선택은
  // 구간 기준이 생길 때 doc 관문에서 정한다.
  return rates[0];
}

function mulDiv(tokens: bigint, rate: string): string {
  return decimalMulDiv(tokens, rate);
}
