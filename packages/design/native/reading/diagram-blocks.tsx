// Native presentation blocks for display math and Mermaid diagrams: renders readable math typography and
// lightweight node/arrow diagrams with pure React Native views (no WebView), with a toggle to view/copy raw source.
import { t } from "@lophn/i18n";
import * as Clipboard from "expo-clipboard";
import {
  ArrowDown,
  ArrowRight,
  Check,
  Code2,
  Copy,
  GitGraph,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";
import { CodeBlock } from "./code-block.tsx";
import { formatMath } from "./math.ts";
import {
  type DiagramNode,
  type MermaidDiagram,
  parseMermaid,
} from "./mermaid.ts";

const COPIED_MS = 1500;

function BlockHeader({
  label,
  raw,
  showingCode,
  onToggle,
}: {
  label: string;
  raw: string;
  showingCode: boolean;
  onToggle: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8,
        paddingHorizontal: 14,
      }}
    >
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showingCode ? label : "TeX"}
          hitSlop={10}
          onPress={onToggle}
        >
          <Icon icon={showingCode ? GitGraph : Code2} size={15} tone="muted" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            copied ? "common.label.copied" : "common.button.copy-code",
          )}
          hitSlop={10}
          onPress={() =>
            void Clipboard.setStringAsync(raw).then(() => setCopied(true))
          }
        >
          <Icon
            icon={copied ? Check : Copy}
            size={15}
            tone={copied ? "good" : "muted"}
          />
        </Pressable>
      </View>
    </View>
  );
}

/** Display math block: formatted Unicode math by default, toggleable to raw TeX. */
export function MathBlock({ tex }: { tex: string }) {
  const theme = useTheme();
  const [raw, setRaw] = useState(false);
  const formatted = useMemo(() => formatMath(tex), [tex]);
  return (
    <View
      style={{
        paddingTop: 8,
        paddingBottom: 14,
        borderRadius: 14,
        backgroundColor: theme.color.surface.subtle,
        borderWidth: 1,
        borderColor: theme.color.border.subtle,
      }}
    >
      <BlockHeader
        label="math"
        raw={tex}
        showingCode={raw}
        onToggle={() => setRaw((v) => !v)}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          minWidth: "100%",
          justifyContent: raw ? "flex-start" : "center",
        }}
      >
        {raw ? (
          <Text mono selectable style={{ fontSize: 13, lineHeight: 20 }}>
            {tex.replace(/\n$/, "")}
          </Text>
        ) : (
          <Text
            selectable
            style={{
              fontSize: 17,
              lineHeight: 26,
              fontStyle: "italic",
              textAlign: "center",
              color: theme.color.text.primary,
            }}
          >
            {formatted}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function NodePill({ node }: { node: DiagramNode }) {
  const theme = useTheme();
  const radius =
    node.shape === "circle"
      ? 999
      : node.shape === "round"
        ? 16
        : node.shape === "diamond"
          ? 4
          : 8;
  return (
    <View
      style={{
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: radius,
        backgroundColor: theme.color.surface.base,
        borderWidth: 1,
        borderColor:
          node.shape === "diamond"
            ? theme.color.ink.background
            : theme.color.border.strong,
        maxWidth: 180,
      }}
    >
      <Text variant="caption" weight="medium" numberOfLines={2}>
        {node.shape === "diamond" ? `◇ ${node.label}` : node.label}
      </Text>
    </View>
  );
}

function DiagramCanvas({ diagram }: { diagram: MermaidDiagram }) {
  const theme = useTheme();
  if (diagram.kind === "sequence") {
    return (
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {diagram.participants.map((name) => (
            <View
              key={name}
              style={{
                paddingVertical: 4,
                paddingHorizontal: 10,
                borderRadius: 8,
                backgroundColor: theme.color.surface.base,
                borderWidth: 1,
                borderColor: theme.color.border.strong,
              }}
            >
              <Text variant="caption" weight="semibold">
                {name}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ gap: 6 }}>
          {diagram.steps.map((step, at) => (
            <View
              key={at}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <Text variant="caption" weight="medium">
                {step.from}
              </Text>
              <Text variant="caption" tone="muted">
                {step.dashed ? "⇢" : "→"}
              </Text>
              <Text variant="caption" weight="medium">
                {step.to}
              </Text>
              {step.label !== "" && (
                <Text variant="caption" tone="muted">
                  {`: ${step.label}`}
                </Text>
              )}
            </View>
          ))}
        </View>
      </View>
    );
  }

  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const lookup = (id: string): DiagramNode =>
    byId.get(id) ?? { id, label: id, shape: "rect" };
  const horizontal = diagram.kind === "flowchart" && diagram.direction === "LR";

  if (diagram.edges.length === 0) {
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {diagram.nodes.map((node) => (
          <NodePill key={node.id} node={node} />
        ))}
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {diagram.edges.map((edge, at) => (
        <View
          key={at}
          style={{
            flexDirection: horizontal ? "row" : "column",
            alignItems: horizontal ? "center" : "flex-start",
            gap: 6,
          }}
        >
          <NodePill node={lookup(edge.from)} />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: horizontal ? 2 : 8,
            }}
          >
            <Icon
              icon={horizontal ? ArrowRight : ArrowDown}
              size={14}
              tone="muted"
            />
            {edge.label !== undefined && edge.label !== "" && (
              <Text variant="caption" tone="muted">
                {edge.dashed ? `(${edge.label})` : edge.label}
              </Text>
            )}
          </View>
          <NodePill node={lookup(edge.to)} />
        </View>
      ))}
    </View>
  );
}

/** Mermaid block: renders parsed flowchart/sequence/state diagrams natively, or falls back to CodeBlock. */
export function MermaidBlock({ code }: { code: string }) {
  const theme = useTheme();
  const [raw, setRaw] = useState(false);
  const diagram = useMemo(() => parseMermaid(code), [code]);
  if (diagram === null) {
    return <CodeBlock code={code} language="mermaid" />;
  }
  const label = `mermaid · ${diagram.kind}`;
  return (
    <View
      style={{
        paddingTop: 8,
        paddingBottom: 14,
        borderRadius: 14,
        backgroundColor: theme.color.surface.subtle,
        borderWidth: 1,
        borderColor: theme.color.border.subtle,
      }}
    >
      <BlockHeader
        label={label}
        raw={code}
        showingCode={raw}
        onToggle={() => setRaw((v) => !v)}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 14 }}
      >
        {raw ? (
          <Text mono selectable style={{ fontSize: 13, lineHeight: 20 }}>
            {code.replace(/\n$/, "")}
          </Text>
        ) : (
          <DiagramCanvas diagram={diagram} />
        )}
      </ScrollView>
    </View>
  );
}
