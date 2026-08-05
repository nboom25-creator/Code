import { useCallback, useEffect, useState } from "react";
import {
  BackHandler,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import TOOLS from "./src/tools";
import { colors, radius, space } from "./src/theme";

export default function App() {
  const [activeId, setActiveId] = useState(null);
  const active = TOOLS.find((t) => t.id === activeId);

  const goHome = useCallback(() => setActiveId(null), []);

  // Android's system back button should exit a tool before exiting the app.
  useEffect(() => {
    if (Platform.OS !== "android" || !activeId) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      goHome();
      return true;
    });
    return () => sub.remove();
  }, [activeId, goHome]);

  if (active) {
    const Tool = active.component;
    return (
      <>
        <StatusBar style="light" />
        <Tool onBack={goHome} />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>TOOLBOX</Text>
        <Text style={styles.subtitle}>
          {TOOLS.length} tools · everything runs offline
        </Text>

        <View style={styles.grid}>
          {TOOLS.map((tool) => (
            <Pressable
              key={tool.id}
              onPress={() => setActiveId(tool.id)}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <Text style={styles.glyph}>{tool.glyph}</Text>
              <Text style={styles.cardName}>{tool.name}</Text>
              <Text style={styles.cardBlurb}>{tool.blurb}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    padding: space.md,
    paddingTop: space.xl,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 5,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 14,
    marginTop: space.xs,
    marginBottom: space.lg,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.md,
  },
  card: {
    flexGrow: 1,
    flexBasis: "44%",
    minHeight: 128,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "flex-end",
  },
  pressed: {
    backgroundColor: colors.surfaceHi,
  },
  glyph: {
    color: colors.accent,
    fontSize: 30,
    marginBottom: space.sm,
  },
  cardName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  cardBlurb: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: 2,
  },
});
