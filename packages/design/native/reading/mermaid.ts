// Lightweight Mermaid parser for React Native: parses common flowcharts, sequence diagrams, and state
// diagrams into a simple structured model so mobile renders clean native diagram cards without a WebView.

export type NodeShape = "rect" | "round" | "diamond" | "circle";

export interface DiagramNode {
  readonly id: string;
  readonly label: string;
  readonly shape: NodeShape;
}

export interface DiagramEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly dashed?: boolean;
}

export interface SequenceStep {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly dashed: boolean;
}

export type MermaidDiagram =
  | {
      readonly kind: "flowchart";
      readonly direction: "TD" | "LR";
      readonly nodes: readonly DiagramNode[];
      readonly edges: readonly DiagramEdge[];
    }
  | {
      readonly kind: "sequence";
      readonly participants: readonly string[];
      readonly steps: readonly SequenceStep[];
    }
  | {
      readonly kind: "state";
      readonly nodes: readonly DiagramNode[];
      readonly edges: readonly DiagramEdge[];
    };

function unquote(text: string): string {
  const s = text.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function parseNodeToken(raw: string): DiagramNode | null {
  const token = raw.trim();
  if (token === "") return null;
  if (token === "[*]") return { id: "[*]", label: "●", shape: "circle" };
  const patterns: readonly [RegExp, NodeShape][] = [
    [/^([A-Za-z0-9_.-]+)\s*\(\((.+)\)\)$/, "circle"],
    [/^([A-Za-z0-9_.-]+)\s*\(\[(.+)\]\)$/, "round"],
    [/^([A-Za-z0-9_.-]+)\s*\{\{(.+)\}\}$/, "diamond"],
    [/^([A-Za-z0-9_.-]+)\s*\{(.+)\}$/, "diamond"],
    [/^([A-Za-z0-9_.-]+)\s*\[(.+)\]$/, "rect"],
    [/^([A-Za-z0-9_.-]+)\s*\((.+)\)$/, "round"],
  ];
  for (const [re, shape] of patterns) {
    const match = re.exec(token);
    if (match !== null) {
      return { id: match[1]!, label: unquote(match[2]!), shape };
    }
  }
  const bare = /^([A-Za-z0-9_.-]+)$/.exec(token);
  if (bare !== null) {
    return { id: bare[1]!, label: bare[1]!, shape: "rect" };
  }
  return null;
}

const FLOW_ARROW =
  /^(.+?)\s*(-\.->|-\.-|==>|--?>|---)\s*(?:\|([^|]+)\|\s*)?(.+)$/;
const FLOW_INLINE_LABEL = /^(.+?)\s*--\s+(.+?)\s*(-->|---)\s*(.+)$/;

function parseFlowchart(
  lines: readonly string[],
  header: string,
): MermaidDiagram | null {
  const dirMatch = /^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i.exec(header);
  const rawDir = dirMatch?.[1]?.toUpperCase() ?? "TD";
  const direction: "TD" | "LR" =
    rawDir === "LR" || rawDir === "RL" ? "LR" : "TD";
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];

  const register = (node: DiagramNode) => {
    const existing = nodes.get(node.id);
    // Keep the richer explicit label/shape if a later line only references the bare node ID.
    if (
      existing === undefined ||
      (existing.label === existing.id && node.label !== node.id)
    ) {
      nodes.set(node.id, node);
    }
  };

  for (const line of lines) {
    if (
      line.startsWith("%%") ||
      /^(?:subgraph|end|style|classDef|class|click|linkStyle)\b/i.test(line)
    ) {
      continue;
    }
    const inline = FLOW_INLINE_LABEL.exec(line);
    if (inline !== null) {
      const from = parseNodeToken(inline[1]!);
      const to = parseNodeToken(inline[4]!);
      if (from !== null && to !== null) {
        register(from);
        register(to);
        edges.push({ from: from.id, to: to.id, label: unquote(inline[2]!) });
        continue;
      }
    }
    const match = FLOW_ARROW.exec(line);
    if (match !== null) {
      const from = parseNodeToken(match[1]!);
      const to = parseNodeToken(match[4]!);
      if (from !== null && to !== null) {
        register(from);
        register(to);
        const arrow = match[2]!;
        const label = match[3] === undefined ? undefined : unquote(match[3]);
        edges.push({
          from: from.id,
          to: to.id,
          ...(label === undefined ? {} : { label }),
          ...(arrow.includes(".") ? { dashed: true } : {}),
        });
        continue;
      }
    }
    const single = parseNodeToken(line);
    if (single !== null && single.label !== single.id) register(single);
  }

  if (edges.length === 0 && nodes.size === 0) return null;
  return {
    kind: "flowchart",
    direction,
    nodes: [...nodes.values()],
    edges,
  };
}

function parseSequence(lines: readonly string[]): MermaidDiagram | null {
  const participants: string[] = [];
  const aliases = new Map<string, string>();
  const steps: SequenceStep[] = [];
  const addParticipant = (id: string, label?: string) => {
    const shown = label ?? aliases.get(id) ?? id;
    if (label !== undefined) aliases.set(id, label);
    if (!participants.includes(shown)) participants.push(shown);
    return shown;
  };

  for (const line of lines) {
    if (line.startsWith("%%")) continue;
    const part =
      /^(?:participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i.exec(
        line,
      );
    if (part !== null) {
      addParticipant(
        part[1]!,
        part[2] === undefined ? part[1]! : unquote(part[2]),
      );
      continue;
    }
    const msg =
      /^([A-Za-z0-9_.-]+?)\s*(-->>|->>|-->|->)\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(
        line,
      );
    if (msg !== null) {
      const from = addParticipant(msg[1]!);
      const to = addParticipant(msg[3]!);
      steps.push({
        from,
        to,
        label: msg[4]!.trim(),
        dashed: msg[2]!.startsWith("--"),
      });
    }
  }
  if (steps.length === 0) return null;
  return { kind: "sequence", participants, steps };
}

function parseState(lines: readonly string[]): MermaidDiagram | null {
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const register = (node: DiagramNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };

  for (const line of lines) {
    if (line.startsWith("%%") || /^(?:direction|note|state\s+"|})/i.test(line))
      continue;
    const match =
      /^(\[\*\]|[A-Za-z0-9_.-]+)\s*-->\s*(\[\*\]|[A-Za-z0-9_.-]+)(?:\s*:\s*(.+))?$/.exec(
        line,
      );
    if (match === null) continue;
    const from = parseNodeToken(match[1]!);
    const to = parseNodeToken(match[2]!);
    if (from === null || to === null) continue;
    register(from.id === "[*]" ? from : { ...from, shape: "round" });
    register(to.id === "[*]" ? to : { ...to, shape: "round" });
    edges.push({
      from: from.id,
      to: to.id,
      ...(match[3] === undefined ? {} : { label: match[3].trim() }),
    });
  }
  if (edges.length === 0) return null;
  return { kind: "state", nodes: [...nodes.values()], edges };
}

/** Parses common Mermaid diagram types into a lightweight native model, or null if unsupported. */
export function parseMermaid(source: string): MermaidDiagram | null {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("%%"));
  if (lines.length < 2) return null;
  const [header, ...rest] = lines;
  if (/^(?:flowchart|graph)\b/i.test(header!))
    return parseFlowchart(rest, header!);
  if (/^sequenceDiagram\b/i.test(header!)) return parseSequence(rest);
  if (/^stateDiagram(?:-v2)?\b/i.test(header!)) return parseState(rest);
  return null;
}
