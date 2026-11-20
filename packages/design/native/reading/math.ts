// Lightweight LaTeX math formatter for React Native: turns common TeX commands, fractions, roots,
// superscripts and subscripts into readable Unicode math without a WebView or native renderer.

const SYMBOLS: Readonly<Record<string, string>> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  pm: "±",
  mp: "∓",
  times: "×",
  cdot: "·",
  div: "÷",
  ast: "∗",
  star: "⋆",
  circ: "∘",
  bullet: "•",
  oplus: "⊕",
  otimes: "⊗",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  simeq: "≃",
  cong: "≅",
  propto: "∝",
  ll: "≪",
  gg: "≫",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  iff: "⇔",
  implies: "⇒",
  mapsto: "↦",
  uparrow: "↑",
  downarrow: "↓",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  nexists: "∄",
  neg: "¬",
  lnot: "¬",
  land: "∧",
  wedge: "∧",
  lor: "∨",
  vee: "∨",
  sum: "∑",
  prod: "∏",
  coprod: "∐",
  int: "∫",
  iint: "∬",
  iiint: "∭",
  oint: "∮",
  ldots: "…",
  dots: "…",
  cdots: "⋯",
  vdots: "⋮",
  ddots: "⋱",
  therefore: "∴",
  because: "∵",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  degree: "°",
  prime: "′",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  aleph: "ℵ",
  langle: "⟨",
  rangle: "⟩",
  lceil: "⌈",
  rceil: "⌉",
  lfloor: "⌊",
  rfloor: "⌋",
  quad: "  ",
  qquad: "    ",
};

const BLACKBOARD: Readonly<Record<string, string>> = {
  C: "ℂ",
  H: "ℍ",
  N: "ℕ",
  P: "ℙ",
  Q: "ℚ",
  R: "ℝ",
  Z: "ℤ",
};

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
  T: "ᵀ",
};

const SUBSCRIPT: Readonly<Record<string, string>> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  h: "ₕ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  l: "ₗ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  u: "ᵤ",
  v: "ᵥ",
  x: "ₓ",
};

function readGroup(src: string, at: number): { text: string; next: number } {
  while (at < src.length && src[at] === " ") at += 1;
  if (src[at] !== "{") {
    if (src[at] === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(at));
      if (m !== null) return { text: m[0], next: at + m[0].length };
    }
    return { text: src[at] ?? "", next: Math.min(src.length, at + 1) };
  }
  let depth = 0;
  const start = at + 1;
  for (let i = at; i < src.length; i += 1) {
    if (src[i] === "\\" && i + 1 < src.length) {
      i += 1;
      continue;
    }
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return { text: src.slice(start, i), next: i + 1 };
    }
  }
  return { text: src.slice(start), next: src.length };
}

function mapScript(
  text: string,
  table: Readonly<Record<string, string>>,
): string | null {
  let out = "";
  for (const ch of text) {
    if (ch === " ") continue;
    const mapped = table[ch];
    if (mapped === undefined) return null;
    out += mapped;
  }
  return out;
}

function needsParens(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 1 && /[+\-*/=<> ]/.test(trimmed);
}

/** Converts a TeX math expression into readable Unicode math text. */
export function formatMath(tex: string): string {
  const src = tex.trim();
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\") {
      if (src[i + 1] === "\\") {
        out += "\n";
        i += 2;
        continue;
      }
      if (src[i + 1] === "," || src[i + 1] === ";" || src[i + 1] === ":") {
        out += " ";
        i += 2;
        continue;
      }
      if (src[i + 1] === "!") {
        i += 2;
        continue;
      }
      if (src[i + 1] === "{" || src[i + 1] === "}" || src[i + 1] === "%") {
        out += src[i + 1];
        i += 2;
        continue;
      }
      const match = /^\\([A-Za-z]+)/.exec(src.slice(i));
      if (match === null) {
        out += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      const cmd = match[1]!;
      i += match[0].length;
      if (
        cmd === "left" ||
        cmd === "right" ||
        cmd === "big" ||
        cmd === "Big" ||
        cmd === "displaystyle"
      ) {
        if (src[i] === ".") i += 1;
        continue;
      }
      if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
        const num = readGroup(src, i);
        const den = readGroup(src, num.next);
        i = den.next;
        const a = formatMath(num.text);
        const b = formatMath(den.text);
        const denParens = b.length > 1 && !/^\(.*\)$/.test(b);
        out += `${needsParens(a) ? `(${a})` : a}/${denParens ? `(${b})` : b}`;
        continue;
      }
      if (cmd === "sqrt") {
        let index = "";
        if (src[i] === "[") {
          const close = src.indexOf("]", i + 1);
          if (close !== -1) {
            index = formatMath(src.slice(i + 1, close));
            i = close + 1;
          }
        }
        const arg = readGroup(src, i);
        i = arg.next;
        const inner = formatMath(arg.text);
        const rootPrefix =
          index === "3"
            ? "∛"
            : index === "4"
              ? "∜"
              : index === ""
                ? "√"
                : `${mapScript(index, SUPERSCRIPT) ?? index}√`;
        out +=
          inner.length <= 1
            ? `${rootPrefix}${inner}`
            : `${rootPrefix}(${inner})`;
        continue;
      }
      if (cmd === "mathbb") {
        const arg = readGroup(src, i);
        i = arg.next;
        out += BLACKBOARD[arg.text.trim()] ?? arg.text;
        continue;
      }
      if (
        cmd === "text" ||
        cmd === "mathrm" ||
        cmd === "mathbf" ||
        cmd === "mathit" ||
        cmd === "mathsf" ||
        cmd === "mathtt" ||
        cmd === "mathcal" ||
        cmd === "operatorname"
      ) {
        const arg = readGroup(src, i);
        i = arg.next;
        out += cmd === "text" ? arg.text : formatMath(arg.text);
        continue;
      }
      if (cmd === "hat" || cmd === "bar" || cmd === "vec" || cmd === "tilde") {
        const arg = readGroup(src, i);
        i = arg.next;
        const combining =
          cmd === "hat"
            ? "\u0302"
            : cmd === "bar"
              ? "\u0304"
              : cmd === "vec"
                ? "\u20d7"
                : "\u0303";
        out += `${formatMath(arg.text)}${combining}`;
        continue;
      }
      const sym = SYMBOLS[cmd];
      if (sym !== undefined) {
        out += sym;
      } else {
        // Common function names like \sin, \cos, \log, \lim render cleanly without the backslash.
        out += cmd;
      }
      continue;
    }
    if (ch === "^" || ch === "_") {
      const arg = readGroup(src, i + 1);
      i = arg.next;
      const formatted = formatMath(arg.text);
      const mapped = mapScript(formatted, ch === "^" ? SUPERSCRIPT : SUBSCRIPT);
      out +=
        mapped ??
        (formatted.length <= 1 ? `${ch}${formatted}` : `${ch}(${formatted})`);
      continue;
    }
    if (ch === "{" || ch === "}") {
      i += 1;
      continue;
    }
    if (ch === "&") {
      out += " ";
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}
