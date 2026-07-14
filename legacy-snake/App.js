import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";

// --- Game constants -------------------------------------------------------
const GRID = 18; // board is GRID x GRID cells
const TICK_MS = 140; // lower = faster snake
const screen = Dimensions.get("window");
const BOARD_PX = Math.min(screen.width - 32, 380);
const CELL = Math.floor(BOARD_PX / GRID);
const BOARD = CELL * GRID; // snap board to whole cells

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const START_SNAKE = [
  { x: 8, y: 9 },
  { x: 7, y: 9 },
  { x: 6, y: 9 },
];

function randomFood(snake) {
  while (true) {
    const food = {
      x: Math.floor(Math.random() * GRID),
      y: Math.floor(Math.random() * GRID),
    };
    if (!snake.some((s) => s.x === food.x && s.y === food.y)) return food;
  }
}

export default function App() {
  const [snake, setSnake] = useState(START_SNAKE);
  const [food, setFood] = useState(() => randomFood(START_SNAKE));
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  // Direction lives in refs so swipes apply instantly without stale closures.
  const dirRef = useRef(DIRS.right);
  const nextDirRef = useRef(DIRS.right);
  const foodRef = useRef(food);
  foodRef.current = food;

  const changeDir = useCallback((d) => {
    const cur = dirRef.current;
    if (d.x === -cur.x && d.y === -cur.y) return; // can't reverse onto self
    nextDirRef.current = d;
  }, []);

  const reset = useCallback(() => {
    dirRef.current = DIRS.right;
    nextDirRef.current = DIRS.right;
    const fresh = randomFood(START_SNAKE);
    setSnake(START_SNAKE);
    setFood(fresh);
    foodRef.current = fresh;
    setScore(0);
    setGameOver(false);
    setRunning(true);
  }, []);

  // Main game loop.
  useEffect(() => {
    if (!running || gameOver) return;
    const id = setInterval(() => {
      setSnake((prev) => {
        const dir = nextDirRef.current;
        dirRef.current = dir;
        const head = { x: prev[0].x + dir.x, y: prev[0].y + dir.y };

        // Wall or self collision -> game over.
        const hitWall =
          head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID;
        const hitSelf = prev.some((s) => s.x === head.x && s.y === head.y);
        if (hitWall || hitSelf) {
          setGameOver(true);
          setRunning(false);
          return prev;
        }

        const ate = head.x === foodRef.current.x && head.y === foodRef.current.y;
        const next = [head, ...prev];
        if (ate) {
          setScore((s) => s + 1);
          const f = randomFood(next);
          setFood(f);
          foodRef.current = f;
        } else {
          next.pop();
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running, gameOver]);

  // Swipe controls.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > Math.abs(g.dy)) {
          changeDir(g.dx > 0 ? DIRS.right : DIRS.left);
        } else {
          changeDir(g.dy > 0 ? DIRS.down : DIRS.up);
        }
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.title}>SNAKE</Text>
        <Text style={styles.score}>{score}</Text>
      </View>

      <View
        style={[styles.board, { width: BOARD, height: BOARD }]}
        {...panResponder.panHandlers}
      >
        {/* Food */}
        <View
          style={[
            styles.food,
            { left: food.x * CELL, top: food.y * CELL, width: CELL, height: CELL },
          ]}
        />
        {/* Snake */}
        {snake.map((seg, i) => (
          <View
            key={i}
            style={[
              styles.segment,
              i === 0 && styles.head,
              {
                left: seg.x * CELL,
                top: seg.y * CELL,
                width: CELL,
                height: CELL,
              },
            ]}
          />
        ))}

        {/* Overlays */}
        {!running && !gameOver && (
          <Overlay
            label="Tap to play"
            hint="Swipe to steer"
            onPress={() => setRunning(true)}
          />
        )}
        {gameOver && (
          <Overlay
            label="Game over"
            hint={`Score ${score} — tap to retry`}
            onPress={reset}
          />
        )}
      </View>

      {/* On-screen D-pad (handy on desktop/web) */}
      <View style={styles.pad}>
        <PadButton label="↑" onPress={() => changeDir(DIRS.up)} />
        <View style={styles.padRow}>
          <PadButton label="←" onPress={() => changeDir(DIRS.left)} />
          <PadButton label="↓" onPress={() => changeDir(DIRS.down)} />
          <PadButton label="→" onPress={() => changeDir(DIRS.right)} />
        </View>
      </View>
    </View>
  );
}

function Overlay({ label, hint, onPress }) {
  return (
    <Pressable style={styles.overlay} onPress={onPress}>
      <Text style={styles.overlayLabel}>{label}</Text>
      <Text style={styles.overlayHint}>{hint}</Text>
    </Pressable>
  );
}

function PadButton({ label, onPress }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.padBtn, pressed && styles.padBtnPressed]}
      onPress={onPress}
    >
      <Text style={styles.padBtnText}>{label}</Text>
    </Pressable>
  );
}

// --- Styles ---------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f1115",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  header: {
    width: BOARD,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 12,
  },
  title: {
    color: "#e6e6e6",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 4,
  },
  score: {
    color: "#4ade80",
    fontSize: 28,
    fontWeight: "800",
  },
  board: {
    backgroundColor: "#171a21",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#262b36",
    overflow: "hidden",
  },
  segment: {
    position: "absolute",
    backgroundColor: "#4ade80",
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "#0f1115",
  },
  head: {
    backgroundColor: "#86efac",
  },
  food: {
    position: "absolute",
    backgroundColor: "#f87171",
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#0f1115",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,17,21,0.82)",
    alignItems: "center",
    justifyContent: "center",
  },
  overlayLabel: {
    color: "#e6e6e6",
    fontSize: 26,
    fontWeight: "800",
  },
  overlayHint: {
    color: "#8b93a7",
    fontSize: 15,
    marginTop: 8,
  },
  pad: {
    marginTop: 28,
    alignItems: "center",
  },
  padRow: {
    flexDirection: "row",
    marginTop: 8,
  },
  padBtn: {
    width: 60,
    height: 60,
    marginHorizontal: 6,
    borderRadius: 12,
    backgroundColor: "#1c2230",
    alignItems: "center",
    justifyContent: "center",
  },
  padBtnPressed: {
    backgroundColor: "#2a3344",
  },
  padBtnText: {
    color: "#cbd5e1",
    fontSize: 24,
    fontWeight: "700",
  },
});
