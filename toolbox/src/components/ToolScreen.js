import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, radius, space } from "../theme";

// Chrome shared by every tool: back button, title, and an optional hint line
// under the header. Tools render whatever they like as children.
export default function ToolScreen({ title, hint, onBack, children }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.back} />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.md,
    paddingTop: space.md,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  backPressed: {
    backgroundColor: colors.surfaceHi,
  },
  backText: {
    color: colors.text,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "700",
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 1,
  },
  hint: {
    color: colors.textDim,
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: space.lg,
    marginTop: space.xs,
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.md,
  },
});
