import Level from "./Level";
import Flashlight from "./Flashlight";
import Stopwatch from "./Stopwatch";

// The single place a tool gets registered. Add a file in this folder, add a
// row here, and it shows up on the home grid — nothing else to wire.
const TOOLS = [
  {
    id: "level",
    name: "Level",
    glyph: "⊙",
    blurb: "Bubble + edge level",
    component: Level,
  },
  {
    id: "flashlight",
    name: "Flashlight",
    glyph: "☀",
    blurb: "Torch, strobe, SOS",
    component: Flashlight,
  },
  {
    id: "stopwatch",
    name: "Stopwatch",
    glyph: "◷",
    blurb: "Laps and splits",
    component: Stopwatch,
  },
];

export default TOOLS;
