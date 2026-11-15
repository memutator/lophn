// Faces: a lophn agent's character, a coding agent's or provider's own icon, an initial, a picture.
// The character is the desktop's (packages/shell/renderer/parts/avatar/character.tsx) drawn with react-native-svg.
import { Text, useTheme } from "@lophn/ui-native";
import { Image, View } from "react-native";
import Svg, { Circle, G, Path, SvgXml } from "react-native-svg";
import type { CharacterProfile } from "../../../protocol/lophn-agent/agent-values.ts";
import type { Vendor } from "../../../shell/renderer/parts/vendor-icon/vendors.ts";
import type { Who } from "../data/mod.ts";
import { VENDOR_SVG } from "./vendor-svg.ts";

export type Profile = Who["profile"];

/** lophn's own face: the product mark in the sidebar and on the welcome screen. */
export const LOPHN: CharacterProfile = {
  kind: "character",
  shape: "square",
  color: "coral",
};

const COLORS: Record<CharacterProfile["color"], string> = {
  coral: "#ff806b",
  periwinkle: "#7b91f5",
  yellow: "#ffd465",
  sage: "#84bc9b",
  lavender: "#af8cdb",
  peach: "#ffb693",
  blue: "#649df0",
  teal: "#6ba5a4",
};

const BODIES: Record<
  CharacterProfile["shape"],
  { path: string; eyes: number }
> = {
  square: {
    path: "M30 14H66Q80 14 80 30V42Q91 49 89 59Q87 66 79 62Q77 73 66 76V82Q66 89 59 89H56Q50 89 50 82V78H42V82Q42 89 35 89H32Q26 89 26 82V75Q16 71 15 62Q7 66 5 59Q3 49 16 42V30Q16 14 30 14Z",
    eyes: 45,
  },
  capsule: {
    path: "M23 30A25 25 0 0 1 73 30V45Q84 52 82 61Q80 67 73 63V68Q73 77 65 80V84Q65 91 59 91H56Q50 91 50 84V81H44V84Q44 91 38 91H35Q29 91 29 84V79Q23 75 23 68V63Q16 67 14 61Q12 52 23 45Z",
    eyes: 37,
  },
  wide: {
    path: "M24 29H72Q90 29 90 47V59Q90 74 75 75V81Q75 88 68 88H65Q58 88 58 81V76H38V81Q38 88 31 88H28Q21 88 21 81V75Q6 74 6 59V47Q6 29 24 29Z",
    eyes: 53,
  },
  pear: {
    path: "M48 9Q65 9 74 43Q88 51 89 60Q88 69 79 64Q77 75 66 78V83Q66 90 59 90H56Q50 90 50 83V80H42V83Q42 90 35 90H32Q26 90 26 83V78Q15 74 15 64Q6 69 5 60Q6 51 20 43Q30 9 48 9Z",
    eyes: 51,
  },
  round: {
    path: "M48 13Q77 13 78 43Q89 49 89 58Q88 66 80 62Q77 74 66 77V82Q66 89 59 89H56Q50 89 50 82V79H43V82Q43 89 36 89H33Q26 89 26 82V77Q15 72 15 62Q7 66 6 58Q6 49 18 43Q19 13 48 13Z",
    eyes: 46,
  },
  arch: {
    path: "M20 36Q20 9 48 9Q76 9 76 36V46Q88 53 87 62Q85 69 77 65Q76 75 66 79V83Q66 90 59 90H56Q50 90 50 83V81H43V83Q43 90 36 90H33Q26 90 26 83V79Q16 75 16 65Q8 69 6 62Q5 53 20 46Z",
    eyes: 47,
  },
};

export function Character({
  profile,
  size,
}: {
  profile: CharacterProfile;
  size: number;
}) {
  const body = BODIES[profile.shape];
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96">
      <Path d={body.path} fill={COLORS[profile.color]} />
      <G fill="#1c2530">
        <Circle cx={37} cy={body.eyes} r={4.8} />
        <Circle cx={59} cy={body.eyes} r={4.8} />
      </G>
    </Svg>
  );
}

/** A product's own icon. One-color icons use currentColor and follow the text color. */
export function VendorIcon({ vendor, size }: { vendor: Vendor; size: number }) {
  const theme = useTheme();
  return (
    <SvgXml
      xml={VENDOR_SVG[vendor]}
      width={size}
      height={size}
      color={theme.color.text.primary}
    />
  );
}

/** Whoever runs a session, in a `size` square. A vendor icon fills most of it, as on the desktop. */
export function Face({ profile, size = 24 }: { profile: Profile; size?: number }) {
  const theme = useTheme();
  const box = {
    width: size,
    height: size,
    alignItems: "center",
    justifyContent: "center",
  } as const;
  switch (profile.kind) {
    case "character":
      return <Character profile={profile} size={size} />;
    case "vendor":
      return (
        <View style={box}>
          <VendorIcon vendor={profile.vendor} size={Math.round(size * 0.84)} />
        </View>
      );
    case "image":
      return (
        <Image
          source={{ uri: profile.src }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      );
    case "initial":
      return (
        <View
          style={[
            box,
            { borderRadius: size / 2, backgroundColor: theme.color.surface.muted },
          ]}
        >
          <Text
            weight="medium"
            tone="secondary"
            style={{ fontSize: size * 0.5, lineHeight: size * 0.6 }}
          >
            {profile.text}
          </Text>
        </View>
      );
  }
}
