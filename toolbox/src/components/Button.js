import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, space } from "../theme";

export default function Button({ label, onPress, tone = "default", style }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        tone === "accent" && styles.accent,
        tone === "danger" && styles.danger,
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text style={[styles.label, tone !== "default" && styles.labelOnTone]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minWidth: 104,
    paddingVertical: space.sm + 4,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHi,
    alignItems: "center",
    justifyContent: "center",
  },
  accent: { backgroundColor: colors.accent },
  danger: { backgroundColor: colors.danger },
  pressed: { opacity: 0.75 },
  label: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  labelOnTone: { color: colors.bg },
});
