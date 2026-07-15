import type { Project } from "@/lib/types";

/**
 * Seed catalog of guided DIY projects for ProjectPath.
 *
 * All tool ids and material ids used here reference the shared tool/material
 * catalog. Content is written for absolute beginners: encouraging, plain
 * language, with honest safety guidance and clear "stop and call a pro" cues.
 */
export const PROJECTS: Project[] = [
  /* ------------------------------------------------------------------ */
  /* 1. Hang a framed picture                                            */
  /* ------------------------------------------------------------------ */
  {
    id: "proj-hang-picture",
    slug: "hang-a-framed-picture",
    title: "Hang a Framed Picture",
    category: "maintenance",
    summary:
      "Get a picture or piece of art on the wall straight, secure, and at the right height without leaving a mess of holes behind.",
    description:
      "Hanging a framed picture is one of the most satisfying quick wins in home improvement. With a tape measure, a level, and the right hook for your wall, you can have art up in under half an hour. This project walks you through choosing a height that looks intentional, marking the spot accurately, and picking a hanger that matches how heavy your frame is so it stays put for years.",
    difficulty: "beginner",
    safetyLevel: "low",
    indoor: true,
    renterFriendly: true,
    requiresPermitOrPro: false,
    activeMinutes: 20,
    totalMinutes: 30,
    costBand: "under_25",
    estimatedCostLowCents: 500,
    estimatedCostHighCents: 2000,
    recommendedPeople: 1,
    skillPrerequisites: [
      "Able to read a tape measure to the nearest inch",
      "Comfortable using a hammer for light tapping",
    ],
    tools: [
      { toolId: "tool-tape-measure", optional: false },
      { toolId: "tool-level", optional: false, note: "A small torpedo level or a phone level app both work fine." },
      { toolId: "tool-pencil", optional: false },
      { toolId: "tool-hammer", optional: false },
      { toolId: "tool-stud-finder", optional: true, note: "Only needed for heavier frames you want anchored into a stud." },
      { toolId: "tool-drill", optional: true, note: "Handy if you use screw-in wall anchors for a heavier piece." },
    ],
    materials: [
      { materialId: "mat-picture-hooks", quantity: 1, note: "Choose a hook rated for your frame's weight." },
      { materialId: "mat-wall-anchors", quantity: 1, note: "Only needed for heavier frames not landing on a stud." },
    ],
    preparation: [
      "Weigh or estimate how heavy the framed piece is so you can pick a matching hook.",
      "Decide roughly where on the wall it should go and clear the area beneath it.",
      "Gather your tape measure, level, pencil, and hook before you start.",
      "Have an eraser or damp cloth ready in case you need to remove a pencil mark.",
    ],
    safetyEquipment: ["Safety glasses"],
    commonMistakes: [
      "Hanging the picture too high — eye level for the center is usually best.",
      "Guessing at the hook location instead of measuring from the frame's hanging wire or bracket.",
      "Using a hook rated for less weight than the frame actually is.",
    ],
    doNotAttemptIf: [
      "The frame is extremely large or heavy (over ~25 lbs) and you have no way to find a stud.",
      "You suspect wiring or plumbing runs directly behind your chosen spot and cannot confirm otherwise.",
    ],
    callProfessionalIf: [
      "The wall is plaster-and-lath, tile, brick, or concrete and you are unsure how to anchor into it safely.",
      "The piece is a valuable mirror or heavy artwork you are not confident supporting on your own.",
    ],
    steps: [
      {
        id: "proj-hang-picture-step-1",
        order: 1,
        title: "Choose the height and center point",
        instructions:
          "As a rule of thumb, the center of the picture should sit around 57–60 inches from the floor, which is comfortable eye level for most people. Hold the frame against the wall and step back to confirm it looks right before you commit. Make a light pencil mark where you want the center to be.",
        estimatedMinutes: 5,
        tools: [{ toolId: "tool-tape-measure" }, { toolId: "tool-pencil" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "A consistent center height makes art feel intentional and keeps multiple frames visually aligned around a room.",
        beginnerTip:
          "If the picture hangs above furniture, leave about 6–10 inches between the top of the furniture and the bottom of the frame.",
        commonMistake: "Hanging art too high because it feels natural to raise your arms while holding it.",
        imageAlt: "A person holding a framed picture against a wall while measuring its height with a tape measure.",
      },
      {
        id: "proj-hang-picture-step-2",
        order: 2,
        title: "Measure the hanger drop on the frame",
        instructions:
          "Flip the frame over and find the hanging wire or bracket. Pull the wire taut toward the top and measure the distance from the top edge of the frame down to that taut point. This 'drop' tells you how far below the top of the frame the hook needs to sit.",
        estimatedMinutes: 3,
        tools: [{ toolId: "tool-tape-measure" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "The hook location depends on the wire, not the frame edge. Skipping this measurement is the number one cause of pictures that end up too high or too low.",
        beginnerTip: "Write the drop measurement down so you do not have to remember it while you are at the wall.",
        commonMistake: "Measuring the loose wire instead of pulling it taut the way it will pull once hung.",
        imageAlt: "The back of a picture frame showing a hanging wire being pulled taut and measured.",
      },
      {
        id: "proj-hang-picture-step-3",
        order: 3,
        title: "Mark the hook location on the wall",
        instructions:
          "From your center mark, measure up to where the top of the frame will be, then measure down by the wire drop you recorded. Make a small pencil mark there — that is exactly where the hook's nail or screw should land. Double-check it is level relative to your center point.",
        estimatedMinutes: 4,
        tools: [{ toolId: "tool-tape-measure" }, { toolId: "tool-pencil" }, { toolId: "tool-level" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Marking precisely means you drive the hook once, in the right place, instead of leaving a row of unused holes.",
        beginnerTip: "Use light pencil pressure so any stray marks wipe away easily with a damp cloth.",
        commonMistake: "Forgetting to subtract the wire drop and placing the hook at the frame's top edge.",
        imageAlt: "A pencil marking a small dot on a wall next to a level held horizontally.",
      },
      {
        id: "proj-hang-picture-step-4",
        order: 4,
        title: "Install the hook or anchor",
        instructions:
          "For light frames, tap a picture hook's nail into your mark at the angle the hook specifies. For heavier frames, or if you want extra security, use a wall anchor: for a stud, a screw bites directly; for hollow drywall, insert an anchor first and drive the screw into it. Confirm the hook feels firmly seated with a gentle tug.",
        estimatedMinutes: 5,
        tools: [
          { toolId: "tool-hammer" },
          { toolId: "tool-drill" },
          { toolId: "tool-stud-finder" },
        ],
        materials: [
          { materialId: "mat-picture-hooks", quantity: 1 },
          { materialId: "mat-wall-anchors", quantity: 1 },
        ],
        safetyWarnings: [
          {
            id: "proj-hang-picture-warn-1",
            level: "moderate",
            title: "Avoid hidden wiring and pipes",
            detail:
              "Outlets and switches often have wiring running vertically nearby. Avoid drilling directly above or below them, and stop if a tool meets unexpected resistance.",
            requiresAcknowledgment: true,
          },
        ],
        whyItMatters:
          "Matching the anchor to the wall type and frame weight is what keeps the picture on the wall instead of on the floor.",
        beginnerTip: "Wear safety glasses when hammering or drilling — small chips of paint or drywall can flick toward your face.",
        commonMistake: "Driving a bare screw into hollow drywall without an anchor, so it strips out under load.",
        imageAlt: "A picture hook nail being tapped into a marked spot on a wall with a hammer.",
      },
      {
        id: "proj-hang-picture-step-5",
        order: 5,
        title: "Hang, level, and adjust",
        instructions:
          "Rest the wire or bracket onto the hook and let the frame settle. Set your level on the top edge and nudge one side until the bubble is centered. If it drifts, a small bumper or a dab of adhesive putty on a bottom corner keeps it from sliding.",
        estimatedMinutes: 3,
        tools: [{ toolId: "tool-level" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "A quick level check now saves you from staring at a crooked frame every day, and small adhesive bumpers keep it straight over time.",
        beginnerTip: "Step back across the room after leveling — walls and floors are rarely perfectly square, so trust your eye too.",
        commonMistake: "Leveling by eye alone and ending up with a frame that looks fine up close but tilts from across the room.",
        imageAlt: "A framed picture hanging on a wall with a small level resting on its top edge showing it is straight.",
      },
    ],
    troubleshooting: [
      {
        id: "proj-hang-picture-ts-1",
        keywords: ["crooked", "tilted", "not straight", "slanted"],
        stepId: "proj-hang-picture-step-5",
        symptom: "The picture will not stay straight and keeps tilting to one side.",
        likelyCauses: [
          "The hanging wire may be sliding sideways across a single center hook.",
          "One bottom corner may be catching on an uneven wall surface.",
        ],
        safeChecks: [
          "Lift the frame off and confirm the wire is centered on the hook.",
          "Run your hand along the wall behind the frame to feel for bumps or texture.",
        ],
        correctiveActions: [
          "Add small adhesive bumpers to the two bottom corners to grip the wall.",
          "For wide frames, switch to two hooks spaced apart so the wire cannot slide.",
        ],
        stopIf: ["The hook itself wobbles or begins pulling out of the wall."],
        callProfessionalIf: ["The wall surface is so uneven that no standard hanger will sit flush."],
      },
      {
        id: "proj-hang-picture-ts-2",
        keywords: ["hole", "too big", "loose", "pulled out", "fell"],
        stepId: "proj-hang-picture-step-4",
        symptom: "The hook or anchor pulled out and left a hole larger than expected.",
        likelyCauses: [
          "The hook may have been under-rated for the frame's weight.",
          "A bare screw may have been used in hollow drywall without an anchor.",
        ],
        safeChecks: [
          "Compare the frame's weight to the hook's stated rating.",
          "Check whether the failed spot was solid stud or hollow drywall.",
        ],
        correctiveActions: [
          "Move over a couple of inches to fresh drywall and install a properly rated anchor.",
          "Patch the old hole later with a small dab of spackle once the picture is up.",
        ],
        stopIf: ["Repeated attempts keep failing in the same crumbling area of wall."],
        callProfessionalIf: ["The wall is plaster or masonry and standard anchors will not hold."],
      },
      {
        id: "proj-hang-picture-ts-3",
        keywords: ["stud", "cannot find", "hard wall", "wont drill", "resistance"],
        stepId: null,
        symptom: "You cannot find a stud, or the wall feels unusually hard to drive a hook into.",
        likelyCauses: [
          "The wall may be plaster-and-lath, brick, or concrete rather than standard drywall.",
          "The stud finder may be reading over metal, wiring, or thick texture.",
        ],
        safeChecks: [
          "Tap the wall and listen — a hollow sound suggests drywall, a dull thud suggests masonry.",
          "Re-run the stud finder slowly and mark each edge it detects.",
        ],
        correctiveActions: [
          "For light frames on hollow drywall, a rated drywall anchor is usually enough.",
          "For masonry, use an anchor specifically labeled for brick or concrete.",
        ],
        stopIf: ["You hit unexpected hard resistance that could be a pipe or conduit."],
        callProfessionalIf: ["The wall is masonry or plaster and you are not confident anchoring into it safely."],
      },
    ],
    imageAlt: "A framed print hanging straight and centered on a living room wall above a small console table.",
    featured: true,
  },

  /* ------------------------------------------------------------------ */
  /* 2. Install a floating shelf                                         */
  /* ------------------------------------------------------------------ */
  {
    id: "proj-floating-shelf",
    slug: "install-a-floating-shelf",
    title: "Install a Floating Shelf",
    category: "shelving-storage",
    summary:
      "Mount a clean, bracket-free shelf that appears to float on the wall, anchored securely enough to hold books, plants, or decor.",
    description:
      "A floating shelf hides its hardware inside the shelf body, giving you a tidy, modern look with no visible brackets. The trick is all in the mounting: get the hidden bracket level and firmly anchored — ideally into a stud — and the shelf will carry real weight for years. This project covers finding solid support, drilling accurately, and testing the shelf before you load it up.",
    difficulty: "beginner",
    safetyLevel: "moderate",
    indoor: true,
    renterFriendly: false,
    requiresPermitOrPro: false,
    activeMinutes: 40,
    totalMinutes: 60,
    costBand: "25_75",
    estimatedCostLowCents: 2500,
    estimatedCostHighCents: 6000,
    recommendedPeople: 2,
    skillPrerequisites: [
      "Comfortable operating a power drill",
      "Able to read a level and a tape measure",
    ],
    tools: [
      { toolId: "tool-tape-measure", optional: false },
      { toolId: "tool-level", optional: false },
      { toolId: "tool-pencil", optional: false },
      { toolId: "tool-stud-finder", optional: false, note: "Anchoring into a stud is strongly preferred for load-bearing shelves." },
      { toolId: "tool-drill", optional: false },
      { toolId: "tool-screwdriver", optional: true, note: "For final tightening if you prefer hand control over the drill." },
    ],
    materials: [
      { materialId: "mat-floating-shelf", quantity: 1, note: "Includes the hidden mounting bracket in most kits." },
      { materialId: "mat-wood-screws", quantity: 1, note: "Use if the shelf kit does not include screws long enough for your wall." },
      { materialId: "mat-wall-anchors", quantity: 1, note: "Required for any mounting point that does not land on a stud." },
    ],
    preparation: [
      "Read the shelf kit instructions and confirm which screws and anchors it includes.",
      "Decide the shelf location and check the weight it is rated to hold.",
      "Use the stud finder to map studs behind your chosen area before drilling.",
      "Clear the floor beneath the work area and have a helper ready to hold the bracket.",
      "Charge your drill battery so you are not interrupted mid-install.",
    ],
    safetyEquipment: ["Safety glasses", "Work gloves"],
    commonMistakes: [
      "Mounting the bracket out of level, so the shelf visibly slopes once installed.",
      "Relying only on drywall anchors for a shelf you plan to load heavily.",
      "Skipping the load test and stacking books on a bracket that is not fully seated.",
    ],
    doNotAttemptIf: [
      "You cannot locate any studs and the shelf will carry significant weight.",
      "The wall is masonry or tile and you lack the correct drill bit and anchors.",
    ],
    callProfessionalIf: [
      "The shelf must bear heavy or valuable items and you are unsure the wall can support it.",
      "You are drilling near a spot where electrical or plumbing lines are likely to run.",
    ],
    steps: [
      {
        id: "proj-floating-shelf-step-1",
        order: 1,
        title: "Locate studs and mark the mounting height",
        instructions:
          "Run the stud finder across your chosen area and mark the center of each stud you find. Decide the shelf height and make a light horizontal reference mark. Wherever possible, plan for at least one bracket screw to land in a stud.",
        estimatedMinutes: 8,
        tools: [{ toolId: "tool-stud-finder" }, { toolId: "tool-pencil" }, { toolId: "tool-tape-measure" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Studs provide far stronger support than drywall alone. Landing screws in a stud is the difference between a shelf that holds and one that sags or tears out.",
        beginnerTip: "Confirm the stud by pushing a thin nail at the marked edge — you should feel solid wood, not hollow give.",
        commonMistake: "Trusting a single stud-finder reading over textured walls, which can give false hits.",
        imageAlt: "A stud finder held against a wall with pencil marks indicating stud centers.",
      },
      {
        id: "proj-floating-shelf-step-2",
        order: 2,
        title: "Level the bracket and mark the holes",
        instructions:
          "Hold the hidden bracket against your reference mark and rest the level on top. Adjust until the bubble is centered, then have your helper hold it steady while you mark each mounting hole through the bracket. Recheck level before moving on.",
        estimatedMinutes: 8,
        tools: [{ toolId: "tool-level" }, { toolId: "tool-pencil" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "The shelf is only as level as the bracket behind it. Two extra minutes here prevents a permanently crooked shelf.",
        beginnerTip: "A second pair of hands makes leveling far easier — this is a good step to have your helper on.",
        commonMistake: "Marking holes while the bracket has drifted off level during the reach for a pencil.",
        imageAlt: "A hidden shelf bracket held level against a wall while hole positions are marked in pencil.",
      },
      {
        id: "proj-floating-shelf-step-3",
        order: 3,
        title: "Drill the mounting holes",
        instructions:
          "Fit your drill with a bit sized to the anchors or screws in your kit. Drill straight into each marked point, keeping the bit perpendicular to the wall. For holes that land in a stud, drill a smaller pilot; for holes in hollow drywall, drill for the anchor size.",
        estimatedMinutes: 8,
        tools: [{ toolId: "tool-drill" }],
        materials: [],
        safetyWarnings: [
          {
            id: "proj-floating-shelf-warn-1",
            level: "moderate",
            title: "Watch for hidden utilities",
            detail:
              "Avoid drilling directly above or below outlets and switches, where wiring often runs. If the drill suddenly meets metal or unusual resistance, stop and reassess before continuing.",
            requiresAcknowledgment: true,
          },
        ],
        whyItMatters:
          "Clean, perpendicular holes let the bracket sit flush and the screws pull tight. Angled holes leave gaps and weaken the hold.",
        beginnerTip: "Wrap a strip of tape around the bit at your target depth so you know exactly when to stop.",
        commonMistake: "Drilling oversized holes in a stud, which prevents the screw threads from biting.",
        imageAlt: "A power drill boring a hole into a marked point on a wall.",
      },
      {
        id: "proj-floating-shelf-step-4",
        order: 4,
        title: "Anchor and fasten the bracket",
        instructions:
          "Tap wall anchors into any hollow-drywall holes until flush. Line the bracket back up with the holes and drive each screw until the bracket pulls tight against the wall. Do not overtighten drywall anchors — snug is enough.",
        estimatedMinutes: 8,
        tools: [{ toolId: "tool-drill" }, { toolId: "tool-screwdriver" }],
        materials: [
          { materialId: "mat-wall-anchors", quantity: 1 },
          { materialId: "mat-wood-screws", quantity: 1 },
        ],
        safetyWarnings: [],
        whyItMatters:
          "A bracket that is firmly seated across all its screws distributes the shelf's load safely across the wall.",
        beginnerTip: "Switch to a hand screwdriver for the final quarter turn so you can feel when it is snug without stripping.",
        commonMistake: "Over-driving screws into drywall anchors until they spin freely and lose all grip.",
        imageAlt: "A metal shelf bracket screwed flush against a wall with anchors seated in the drywall.",
      },
      {
        id: "proj-floating-shelf-step-5",
        order: 5,
        title: "Slide on the shelf and test the load",
        instructions:
          "Slide the shelf body over the bracket rods until it meets the wall, and secure any set screws underneath. Before loading it, press down firmly near the outer edge to test the hold. Add weight gradually and watch for any sag or movement.",
        estimatedMinutes: 8,
        tools: [{ toolId: "tool-screwdriver" }],
        materials: [],
        safetyWarnings: [
          {
            id: "proj-floating-shelf-warn-2",
            level: "moderate",
            title: "Test before you trust it",
            detail:
              "Do not place fragile or heavy items on the shelf until you have confirmed it holds firm under hand pressure and gradual loading. A shelf that shifts under test weight is not ready for use.",
            requiresAcknowledgment: true,
          },
        ],
        whyItMatters:
          "A load test surfaces a weak anchor before it fails with your belongings on top of it.",
        beginnerTip: "Start with a stack of books rather than a plant or ceramics — books survive a test better than glass.",
        commonMistake: "Loading the shelf to capacity immediately without a gradual test push first.",
        imageAlt: "A floating shelf mounted on a wall being pressed down at its outer edge to test its hold.",
      },
      {
        id: "proj-floating-shelf-step-6",
        order: 6,
        title: "Final level check and cleanup",
        instructions:
          "Set the level on the finished shelf and confirm it still reads true under a light load. Wipe away pencil marks and vacuum any drywall dust from the floor. If the shelf is even slightly off, minor bracket adjustments now are easy to make.",
        estimatedMinutes: 5,
        tools: [{ toolId: "tool-level" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "A final check confirms nothing shifted during install and leaves you with a clean, finished result you can trust.",
        beginnerTip: "If it is a hair off, a thin felt pad under one end of the shelf can visually correct a tiny slope.",
        commonMistake: "Declaring it done before verifying the shelf is still level after the load test.",
        imageAlt: "A level resting on an installed floating shelf showing a centered bubble.",
      },
    ],
    troubleshooting: [
      {
        id: "proj-floating-shelf-ts-1",
        keywords: ["sag", "sagging", "droop", "leaning down", "tilts forward"],
        stepId: "proj-floating-shelf-step-5",
        symptom: "The shelf droops downward at the front once weight is added.",
        likelyCauses: [
          "The bracket screws may be anchored only in drywall rather than a stud.",
          "The load may exceed the shelf's rated capacity.",
        ],
        safeChecks: [
          "Remove the load and check whether the bracket has pulled away from the wall.",
          "Compare what you placed on the shelf to its stated weight limit.",
        ],
        correctiveActions: [
          "Reduce the load and redistribute weight toward the wall side.",
          "Re-anchor at least one screw into a stud, or upgrade to heavier-duty anchors.",
        ],
        stopIf: ["The bracket is visibly tearing out of the wall."],
        callProfessionalIf: ["No studs are reachable and the shelf must carry significant weight."],
      },
      {
        id: "proj-floating-shelf-ts-2",
        keywords: ["not level", "crooked", "slopes", "uneven"],
        stepId: "proj-floating-shelf-step-2",
        symptom: "The installed shelf is visibly not level.",
        likelyCauses: [
          "The bracket may have drifted off level while the holes were marked.",
          "One anchor may be seated deeper than the other.",
        ],
        safeChecks: [
          "Place a level on the shelf to measure how far off it reads.",
          "Check whether both bracket screws pulled fully tight.",
        ],
        correctiveActions: [
          "Loosen the high side slightly and re-seat to bring it into level, then retighten.",
          "If holes are only slightly off, a small felt shim can correct minor slope.",
        ],
        stopIf: ["Re-drilling would leave the wall too damaged to hold the bracket."],
        callProfessionalIf: ["Repeated attempts have enlarged the holes so anchors no longer grip."],
      },
      {
        id: "proj-floating-shelf-ts-3",
        keywords: ["spins", "wont tighten", "stripped", "loose screw"],
        stepId: "proj-floating-shelf-step-4",
        symptom: "A screw spins freely and will not tighten.",
        likelyCauses: [
          "The drywall anchor may have been over-driven and lost its grip.",
          "The hole may be oversized for the screw.",
        ],
        safeChecks: [
          "Gently tug the bracket to see if that fastener is holding at all.",
          "Inspect the hole to judge whether it has widened.",
        ],
        correctiveActions: [
          "Move to a fresh spot a couple of inches over and install a new anchor.",
          "Step up to a larger-diameter anchor sized for the enlarged hole.",
        ],
        stopIf: ["The surrounding drywall is crumbling and will not hold any anchor."],
        callProfessionalIf: ["The wall repeatedly fails to hold and you are unsure of the wall type."],
      },
    ],
    imageAlt: "A clean floating wood shelf mounted on a wall holding a few books and a small potted plant.",
    featured: true,
  },

  /* ------------------------------------------------------------------ */
  /* 3. Patch a small drywall hole                                       */
  /* ------------------------------------------------------------------ */
  {
    id: "proj-patch-drywall",
    slug: "patch-a-small-drywall-hole",
    title: "Patch a Small Drywall Hole",
    category: "walls-drywall",
    summary:
      "Make a nail hole, dent, or fist-sized ding disappear with a patch kit and a little spackle, then blend it back into the wall.",
    description:
      "Small holes in drywall are one of the most common wall repairs, and one of the most forgiving for beginners. Whether it is a leftover anchor hole or a doorknob dent, a self-adhesive patch plus a couple of thin coats of spackle will make it vanish. The secret is patience: thin layers, light sanding between coats, and priming before you touch up the paint.",
    difficulty: "beginner",
    safetyLevel: "low",
    indoor: true,
    renterFriendly: true,
    requiresPermitOrPro: false,
    activeMinutes: 30,
    totalMinutes: 180,
    costBand: "under_25",
    estimatedCostLowCents: 800,
    estimatedCostHighCents: 2500,
    recommendedPeople: 1,
    skillPrerequisites: ["Comfortable using a putty knife with light pressure"],
    tools: [
      { toolId: "tool-putty-knife", optional: false },
      { toolId: "tool-sanding-block", optional: false },
      { toolId: "tool-sandpaper", optional: false, note: "Fine grit (around 150–220) blends best without gouging." },
      { toolId: "tool-utility-knife", optional: true, note: "For trimming any loose or ragged drywall edges around the hole." },
      { toolId: "tool-paint-brush", optional: true, note: "For dabbing on primer and touch-up paint at the end." },
    ],
    materials: [
      { materialId: "mat-patch-kit", quantity: 1, note: "Self-adhesive mesh patch for holes roughly 1–4 inches across." },
      { materialId: "mat-spackle", quantity: 1 },
      { materialId: "mat-primer", quantity: 1, note: "Spot-priming the patch keeps the paint from flashing dull." },
      { materialId: "mat-wall-paint", quantity: 1, note: "Only what you need to feather the repair back into the wall." },
    ],
    preparation: [
      "Clean around the hole and remove any loose or crumbling drywall.",
      "Confirm the hole is small enough for a patch (roughly fist-sized or less).",
      "Find leftover wall paint or note the color so touch-up blends in.",
      "Lay something down beneath the spot to catch sanding dust.",
    ],
    safetyEquipment: ["Safety glasses", "Dust mask"],
    commonMistakes: [
      "Applying one thick glob of spackle instead of thin, buildable coats.",
      "Sanding too aggressively and gouging the surrounding wall.",
      "Painting over the patch without priming, so it shows through as a dull spot.",
    ],
    doNotAttemptIf: [
      "The hole is larger than the patch can span or exposes framing or wiring.",
      "The damaged area is soft and water-stained, which may point to a leak behind the wall.",
    ],
    callProfessionalIf: [
      "You find mold, persistent moisture, or wiring behind the opening.",
      "The damage is large enough to require cutting in and replacing a section of drywall.",
    ],
    steps: [
      {
        id: "proj-patch-drywall-step-1",
        order: 1,
        title: "Clean and prep the hole",
        instructions:
          "Gently remove any crumbling drywall or paper around the edges so the surface is stable. Use a utility knife to trim ragged bits back to firm material. Wipe away dust so your patch and spackle will stick properly.",
        estimatedMinutes: 5,
        tools: [{ toolId: "tool-utility-knife" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Spackle and patches only bond well to clean, firm drywall. Loose edges will telegraph through your repair later.",
        beginnerTip: "Press lightly around the hole first — if the wall feels soft or spongy, stop and investigate for moisture.",
        commonMistake: "Leaving loose paper flaps that lift and crack once spackle dries over them.",
        imageAlt: "A small hole in a drywall wall being cleaned of loose debris with a utility knife.",
      },
      {
        id: "proj-patch-drywall-step-2",
        order: 2,
        title: "Apply the self-adhesive patch",
        instructions:
          "Peel the backing off the mesh patch and center it over the hole, pressing it flat so it fully adheres. The patch should extend an inch or more onto solid wall all the way around. Smooth out any wrinkles with your fingers.",
        estimatedMinutes: 4,
        tools: [],
        materials: [{ materialId: "mat-patch-kit", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "The mesh bridges the opening and gives the spackle something rigid to span, preventing the repair from cracking through.",
        beginnerTip: "For holes under about a half inch, you can often skip the patch and just fill with spackle.",
        commonMistake: "Using a patch too small to reach solid wall, so it flexes and cracks over the void.",
        imageAlt: "A self-adhesive mesh drywall patch pressed flat over a small hole in a wall.",
      },
      {
        id: "proj-patch-drywall-step-3",
        order: 3,
        title: "Apply the first thin coat of spackle",
        instructions:
          "Load a small amount of spackle onto your putty knife and spread a thin coat over the patch, pushing it into the mesh. Feather the edges out past the patch so there is no hard ridge. Do not try to fill it completely in one pass.",
        estimatedMinutes: 6,
        tools: [{ toolId: "tool-putty-knife" }],
        materials: [{ materialId: "mat-spackle", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "Thin coats dry evenly and shrink less. A single thick coat cracks and takes far longer to dry.",
        beginnerTip: "Hold the putty knife at a low angle and let its edge do the smoothing rather than pressing hard.",
        commonMistake: "Globbing on a heavy layer to finish fast, which leaves a lumpy bump that is hard to sand flat.",
        imageAlt: "A putty knife spreading a thin layer of white spackle over a mesh wall patch.",
      },
      {
        id: "proj-patch-drywall-step-4",
        order: 4,
        title: "Let it dry, sand, and add a second coat",
        instructions:
          "Allow the first coat to dry fully — usually one to two hours, longer in humidity. Lightly sand it smooth with fine sandpaper, wipe the dust, then apply a slightly wider second coat to fill any low spots. Feather the edges even farther out.",
        estimatedMinutes: 10,
        tools: [{ toolId: "tool-sanding-block" }, { toolId: "tool-sandpaper" }, { toolId: "tool-putty-knife" }],
        materials: [{ materialId: "mat-spackle", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "Building up in coats with light sanding between them is how you get a flat, invisible repair instead of a raised patch.",
        beginnerTip: "Run your bare hand over the spot with eyes closed — your fingertips catch ridges your eyes miss.",
        commonMistake: "Sanding or recoating before the previous layer is fully dry, which drags and gums up.",
        imageAlt: "A sanding block smoothing a dried patch of spackle flush with the surrounding wall.",
      },
      {
        id: "proj-patch-drywall-step-5",
        order: 5,
        title: "Prime and touch up the paint",
        instructions:
          "Once the patch is smooth and flush, brush a spot of primer over the repaired area and let it dry. Then feather your matching wall paint over the primed spot, blending outward into the surrounding wall. A second light coat may be needed for full color match.",
        estimatedMinutes: 5,
        tools: [{ toolId: "tool-paint-brush" }],
        materials: [
          { materialId: "mat-primer", quantity: 1 },
          { materialId: "mat-wall-paint", quantity: 1 },
        ],
        safetyWarnings: [],
        whyItMatters:
          "Spackle absorbs paint differently than the wall, so priming first is what makes the repair truly disappear.",
        beginnerTip: "Feather the paint outward in a wide, thinning circle rather than stopping at a hard line around the patch.",
        commonMistake: "Skipping primer and ending up with a dull 'flashing' spot that shows in raking light.",
        imageAlt: "A paintbrush blending touch-up paint over a primed drywall repair so it matches the wall.",
      },
    ],
    troubleshooting: [
      {
        id: "proj-patch-drywall-ts-1",
        keywords: ["crack", "cracked", "reappeared", "splitting"],
        stepId: "proj-patch-drywall-step-3",
        symptom: "A crack shows through the finished patch.",
        likelyCauses: [
          "The patch may not have extended onto solid wall on all sides.",
          "The spackle may have been applied too thick and shrank as it dried.",
        ],
        safeChecks: [
          "Look at whether the crack follows the edge of the patch.",
          "Press near the repair to see if the area still flexes.",
        ],
        correctiveActions: [
          "Sand back the coat, apply a larger patch that reaches firm wall, and rebuild in thin layers.",
          "Recoat with thin passes, feathering well beyond the crack.",
        ],
        stopIf: ["The wall flexes significantly, suggesting damage larger than a surface patch can fix."],
        callProfessionalIf: ["Cracks keep returning, which may indicate structural movement behind the wall."],
      },
      {
        id: "proj-patch-drywall-ts-2",
        keywords: ["bump", "raised", "visible", "shows", "lump"],
        stepId: "proj-patch-drywall-step-4",
        symptom: "The patch is visible as a raised bump under the paint.",
        likelyCauses: [
          "The spackle may not have been feathered out far enough.",
          "Sanding may have stopped short of blending the edges flat.",
        ],
        safeChecks: [
          "Shine a light across the wall at a low angle to see the ridge.",
          "Run your hand over the area to feel where it rises.",
        ],
        correctiveActions: [
          "Sand the high edges gently with fine paper and re-feather with a very thin skim coat.",
          "Widen the feathered area so the transition is gradual.",
        ],
        stopIf: ["Sanding starts cutting into the surrounding painted wall."],
        callProfessionalIf: ["You cannot achieve a flush blend after several attempts on a highly visible wall."],
      },
      {
        id: "proj-patch-drywall-ts-3",
        keywords: ["soft", "wet", "stain", "moisture", "mold", "brown"],
        stepId: "proj-patch-drywall-step-1",
        symptom: "The drywall around the hole feels soft, damp, or is stained brown.",
        likelyCauses: [
          "There may be a plumbing or roof leak behind the wall.",
          "Long-term condensation could be softening the drywall.",
        ],
        safeChecks: [
          "Gently feel whether the area is cool and damp compared to the rest of the wall.",
          "Look for staining that spreads outward from the hole.",
        ],
        correctiveActions: [
          "Stop patching and find the moisture source before repairing.",
          "Let the area dry fully and confirm it stays dry before any cosmetic repair.",
        ],
        stopIf: ["You see active moisture, mold growth, or a spreading stain."],
        callProfessionalIf: ["The dampness points to a hidden leak or you find mold behind the wall."],
      },
    ],
    imageAlt: "A smooth section of interior wall where a small hole was patched and repainted so it is no longer visible.",
    featured: false,
  },

  /* ------------------------------------------------------------------ */
  /* 4. Paint a bedroom wall                                             */
  /* ------------------------------------------------------------------ */
  {
    id: "proj-paint-wall",
    slug: "paint-a-bedroom-wall",
    title: "Paint a Bedroom Wall",
    category: "painting",
    summary:
      "Transform a single wall with a fresh coat of paint — from taping clean edges to rolling an even, streak-free finish.",
    description:
      "Painting one wall is the highest-impact change you can make in an afternoon, and it is very achievable for a first-timer. The results live and die by preparation: clean edges from good taping, a smooth surface, and the right order of operations. This project takes you from prepping and cutting in to rolling the field and pulling the tape for crisp lines.",
    difficulty: "intermediate",
    safetyLevel: "low",
    indoor: true,
    renterFriendly: false,
    requiresPermitOrPro: false,
    activeMinutes: 90,
    totalMinutes: 240,
    costBand: "25_75",
    estimatedCostLowCents: 4000,
    estimatedCostHighCents: 8000,
    recommendedPeople: 1,
    skillPrerequisites: [
      "Comfortable working on a small step stool or ladder for the upper wall",
      "Able to work patiently through dry-time waits between coats",
    ],
    tools: [
      { toolId: "tool-paint-roller", optional: false },
      { toolId: "tool-paint-brush", optional: false, note: "An angled sash brush makes cutting in edges much easier." },
      { toolId: "tool-paint-tray", optional: false },
      { toolId: "tool-drop-cloth", optional: false },
      { toolId: "tool-putty-knife", optional: true, note: "For pressing tape down and filling any small nicks first." },
      { toolId: "tool-sanding-block", optional: true, note: "For lightly scuffing glossy or rough spots before painting." },
    ],
    materials: [
      { materialId: "mat-wall-paint", quantity: 1, note: "One gallon covers a typical single wall with two coats." },
      { materialId: "mat-primer", quantity: 1, note: "Needed for big color changes, stains, or bare patched areas." },
      { materialId: "mat-painters-tape", quantity: 1 },
      { materialId: "mat-paint-stir", quantity: 1 },
    ],
    preparation: [
      "Move or center furniture and cover it, then lay drop cloths along the base of the wall.",
      "Wipe the wall clean of dust and fingerprints and let it dry.",
      "Fill any nail holes or dents and lightly sand rough spots smooth.",
      "Remove or loosen switch and outlet cover plates on the wall.",
      "Open a window or run a fan so the room stays ventilated as you work.",
    ],
    safetyEquipment: ["Safety glasses", "Work gloves"],
    commonMistakes: [
      "Skipping the tape and trying to freehand a clean edge on the first try.",
      "Overloading the roller so paint drips and leaves heavy runs.",
      "Recoating before the first coat has dried, which lifts and streaks the paint.",
    ],
    doNotAttemptIf: [
      "The wall has flaking paint that may contain lead in a pre-1978 home, until it is assessed.",
      "There is active moisture or mold on the wall that painting would only hide.",
    ],
    callProfessionalIf: [
      "You suspect lead paint and need safe removal before repainting.",
      "The wall has water damage or mold that must be resolved before any paint goes on.",
    ],
    steps: [
      {
        id: "proj-paint-wall-step-1",
        order: 1,
        title: "Protect the room and tape the edges",
        instructions:
          "Spread drop cloths along the wall base and over nearby furniture. Run painter's tape along the ceiling line, baseboards, and any trim or window casing that meets the wall. Press the tape edge down firmly with a putty knife so paint cannot seep under it.",
        estimatedMinutes: 20,
        tools: [{ toolId: "tool-drop-cloth" }, { toolId: "tool-putty-knife" }],
        materials: [{ materialId: "mat-painters-tape", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "Crisp lines come from well-sealed tape, not a steady hand. Time spent taping is what separates a tidy job from a messy one.",
        beginnerTip: "Burnish the tape edge firmly with the flat of a putty knife — sealed tape is what blocks bleed-through.",
        commonMistake: "Pressing tape on loosely so paint wicks underneath and ruins the line.",
        imageAlt: "Painter's tape applied along the ceiling and baseboard edges of a wall with a drop cloth on the floor.",
      },
      {
        id: "proj-paint-wall-step-2",
        order: 2,
        title: "Prime if needed",
        instructions:
          "If you are covering a dark color, stains, or fresh patches, roll on a coat of primer first and let it dry fully. Primer gives an even base so your color goes on true and covers in fewer coats. Skip this only if you are repainting a similar color over sound existing paint.",
        estimatedMinutes: 15,
        tools: [{ toolId: "tool-paint-roller" }, { toolId: "tool-paint-tray" }],
        materials: [{ materialId: "mat-primer", quantity: 1 }],
        safetyWarnings: [
          {
            id: "proj-paint-wall-warn-1",
            level: "moderate",
            title: "Keep the room ventilated",
            detail:
              "Primers and paints release fumes. Keep a window open or a fan running throughout, and take breaks in fresh air if you feel lightheaded.",
            requiresAcknowledgment: true,
          },
        ],
        whyItMatters:
          "Primer seals patches and blocks old colors and stains from bleeding through your finish coat.",
        beginnerTip: "Tinted primer toward your final color can save you a whole coat of paint on big color changes.",
        commonMistake: "Skipping primer over patched spots, which then show as dull, blotchy areas.",
        imageAlt: "A roller applying white primer to a section of interior wall.",
      },
      {
        id: "proj-paint-wall-step-3",
        order: 3,
        title: "Stir the paint and cut in the edges",
        instructions:
          "Stir the paint thoroughly with a stir stick so the color and sheen are uniform. Using an angled brush, 'cut in' a two-to-three inch band of paint along all the taped edges and corners the roller cannot reach. Work in manageable sections so the cut-in stays wet when you roll into it.",
        estimatedMinutes: 20,
        tools: [{ toolId: "tool-paint-brush" }],
        materials: [
          { materialId: "mat-wall-paint", quantity: 1 },
          { materialId: "mat-paint-stir", quantity: 1 },
        ],
        safetyWarnings: [],
        whyItMatters:
          "Cutting in first creates clean borders and lets you blend the rolled area into a wet edge, avoiding visible brush-versus-roller lines.",
        beginnerTip: "Load the brush lightly and wipe one side — a slightly dry brush gives you more control on the edge.",
        commonMistake: "Cutting in the whole wall and letting it dry before rolling, which leaves a picture-frame effect.",
        imageAlt: "An angled brush cutting a band of paint along the taped ceiling edge of a wall.",
      },
      {
        id: "proj-paint-wall-step-4",
        order: 4,
        title: "Roll on the first coat",
        instructions:
          "Load the roller in the tray and roll off the excess so it is evenly coated but not dripping. Apply paint in a large 'W' or 'M' pattern, then fill it in with lighter parallel passes to spread it evenly. Keep a wet edge and work in sections down the wall.",
        estimatedMinutes: 20,
        tools: [{ toolId: "tool-paint-roller" }, { toolId: "tool-paint-tray" }],
        materials: [{ materialId: "mat-wall-paint", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "The W pattern spreads paint before you smooth it, giving even coverage without the heavy build-up that causes drips.",
        beginnerTip: "Finish each section with light top-to-bottom passes in one direction for a uniform texture.",
        commonMistake: "Overloading the roller so it sheds drips and leaves thick, uneven ridges.",
        imageAlt: "A paint roller applying color to a bedroom wall in overlapping strokes.",
      },
      {
        id: "proj-paint-wall-step-5",
        order: 5,
        title: "Let it dry, then apply the second coat",
        instructions:
          "Let the first coat dry fully per the paint can's guidance — typically two to four hours. Resist the urge to recoat early. Once dry to the touch and no longer tacky, repeat your cut-in and rolling process for an even, opaque second coat.",
        estimatedMinutes: 25,
        tools: [{ toolId: "tool-paint-roller" }, { toolId: "tool-paint-brush" }, { toolId: "tool-paint-tray" }],
        materials: [{ materialId: "mat-wall-paint", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "A proper second coat is what gives rich, even color. Rushing it before the first dries will drag and streak the finish.",
        beginnerTip: "Most walls need two coats even if the first looks close — the second evens out the sheen and depth.",
        commonMistake: "Recoating while the first is still tacky, which pulls up paint and creates streaks.",
        imageAlt: "A second even coat of paint being rolled onto a partially painted wall.",
      },
      {
        id: "proj-paint-wall-step-6",
        order: 6,
        title: "Pull the tape and clean up",
        instructions:
          "While the final coat is still slightly damp, pull the painter's tape back on itself at a shallow angle to reveal crisp edges. Remove drop cloths carefully to avoid spreading any wet paint. Reinstall cover plates once the wall is dry to the touch.",
        estimatedMinutes: 15,
        tools: [],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Pulling tape while paint is still slightly wet gives the cleanest line and prevents the dried film from tearing.",
        beginnerTip: "If paint has bridged onto the tape and dried, score the edge lightly with a blade before pulling.",
        commonMistake: "Waiting until the paint is bone dry to remove tape, which peels the edge and chips the line.",
        imageAlt: "Painter's tape being peeled away from a freshly painted wall revealing a clean edge.",
      },
    ],
    troubleshooting: [
      {
        id: "proj-paint-wall-ts-1",
        keywords: ["streaks", "streaky", "roller marks", "uneven", "patchy"],
        stepId: "proj-paint-wall-step-4",
        symptom: "The finished wall shows streaks or uneven roller marks.",
        likelyCauses: [
          "The roller may have been underloaded or the wet edge allowed to dry between passes.",
          "The coat may have been spread too thin to cover evenly.",
        ],
        safeChecks: [
          "View the wall in raking light to map where the thin spots are.",
          "Check whether the marks follow where sections met after drying.",
        ],
        correctiveActions: [
          "Let it dry fully and apply an even additional coat, keeping a wet edge throughout.",
          "Load the roller more consistently and maintain overlapping passes.",
        ],
        stopIf: ["Paint is running or sagging, indicating coats are going on far too heavy."],
        callProfessionalIf: ["Repeated coats will not even out and the wall texture is fighting the finish."],
      },
      {
        id: "proj-paint-wall-ts-2",
        keywords: ["bleed", "bled under", "fuzzy line", "seeped", "tape"],
        stepId: "proj-paint-wall-step-6",
        symptom: "Paint bled under the tape leaving a fuzzy or ragged edge.",
        likelyCauses: [
          "The tape may not have been pressed down firmly before painting.",
          "Too much paint may have been applied right at the tape edge.",
        ],
        safeChecks: [
          "Inspect the line to see where the bleed is worst.",
          "Feel whether the tape had lifted in those spots.",
        ],
        correctiveActions: [
          "Let it dry, then carefully touch up the line with a small brush against a fresh tape edge.",
          "On future edges, burnish the tape firmly and keep the brush lighter near it.",
        ],
        stopIf: ["Correcting the line risks smearing large areas of still-wet paint."],
        callProfessionalIf: ["The finish quality matters greatly and hand touch-ups are not achieving a clean line."],
      },
      {
        id: "proj-paint-wall-ts-3",
        keywords: ["wont cover", "old color", "showing through", "bleeding through", "stain"],
        stepId: "proj-paint-wall-step-2",
        symptom: "The old color or a stain keeps showing through your new paint.",
        likelyCauses: [
          "The wall may need a primer coat that was skipped.",
          "A stain such as water or marker may be bleeding through ordinary paint.",
        ],
        safeChecks: [
          "Look at whether the show-through is a general color or a specific mark.",
          "Check if the area was ever primed.",
        ],
        correctiveActions: [
          "Apply a coat of primer, using a stain-blocking primer over specific marks.",
          "Recoat with your color once the primer is fully dry.",
        ],
        stopIf: ["A recurring stain reappears, which may signal an underlying moisture problem."],
        callProfessionalIf: ["A stain keeps bleeding through despite primer, suggesting a hidden leak."],
      },
    ],
    imageAlt: "A bedroom wall painted in a fresh, even color with crisp clean edges along the ceiling and trim.",
    featured: true,
  },

  /* ------------------------------------------------------------------ */
  /* 5. Recaulk a bathtub                                                */
  /* ------------------------------------------------------------------ */
  {
    id: "proj-recaulk-tub",
    slug: "recaulk-a-bathtub",
    title: "Recaulk a Bathtub",
    category: "maintenance",
    summary:
      "Replace cracked, moldy caulk around a tub with a clean waterproof bead that keeps water out of the wall behind it.",
    description:
      "Old caulk around a tub or shower eventually shrinks, cracks, and grows mold, letting water sneak behind the wall. Recaulking is a satisfying weekend job that protects your bathroom for years. The work itself is quick, but the new caulk needs a full cure before the tub gets wet again — so the real skill is removing every scrap of the old bead and laying a smooth new one.",
    difficulty: "beginner",
    safetyLevel: "moderate",
    indoor: true,
    renterFriendly: true,
    requiresPermitOrPro: false,
    activeMinutes: 45,
    totalMinutes: 1440,
    costBand: "under_25",
    estimatedCostLowCents: 1000,
    estimatedCostHighCents: 2500,
    recommendedPeople: 1,
    skillPrerequisites: [
      "Comfortable working in a bent or kneeling position around a tub",
      "Patient enough to wait a full cure time before using the tub again",
    ],
    tools: [
      { toolId: "tool-caulk-gun", optional: false },
      { toolId: "tool-caulk-removal", optional: false, note: "A dedicated caulk removal tool makes stripping the old bead far easier." },
      { toolId: "tool-utility-knife", optional: false, note: "For scoring the old caulk before pulling it out." },
      { toolId: "tool-putty-knife", optional: true, note: "Helpful for lifting stubborn strips of old caulk." },
      { toolId: "tool-sponge", optional: true },
      { toolId: "tool-bucket", optional: true },
    ],
    materials: [
      { materialId: "mat-tub-caulk", quantity: 1, note: "Use a mildew-resistant caulk labeled for kitchen and bath." },
      { materialId: "mat-rubbing-alcohol", quantity: 1, note: "Wipes the joint clean and dry so new caulk adheres." },
      { materialId: "mat-painters-tape2", quantity: 1, note: "Masks both sides of the joint for a crisp, even bead." },
      { materialId: "mat-cleaner", quantity: 1 },
    ],
    preparation: [
      "Open the bathroom window or run the exhaust fan for ventilation.",
      "Clear everything off the tub surround so you have full access to the joint.",
      "Confirm the joint and wall are completely dry before starting.",
      "Read the caulk tube for its specific cure time before water exposure.",
      "Have a trash bag ready for the strips of old caulk you remove.",
    ],
    safetyEquipment: ["Safety glasses", "Work gloves"],
    commonMistakes: [
      "Applying new caulk over old, which never bonds and quickly fails.",
      "Caulking a damp joint so the bead will not adhere or cure properly.",
      "Using the tub before the caulk has fully cured, breaking the seal.",
    ],
    doNotAttemptIf: [
      "There is active mold spreading behind loose tiles, which needs deeper investigation.",
      "The tub surround has soft, water-damaged walls that suggest a larger leak.",
    ],
    callProfessionalIf: [
      "You find rot, extensive mold, or loose tile indicating water already reached the wall.",
      "The gap between tub and wall is unusually wide or the surround is failing structurally.",
    ],
    steps: [
      {
        id: "proj-recaulk-tub-step-1",
        order: 1,
        title: "Remove all the old caulk",
        instructions:
          "Score along both edges of the old caulk with a utility knife, then pull and scrape the strips out with a caulk removal tool or putty knife. Get every bit out, including bits buried in the corner. The joint should be bare all the way down.",
        estimatedMinutes: 20,
        tools: [{ toolId: "tool-utility-knife" }, { toolId: "tool-caulk-removal" }, { toolId: "tool-putty-knife" }],
        materials: [],
        safetyWarnings: [
          {
            id: "proj-recaulk-tub-warn-1",
            level: "moderate",
            title: "Mind the blade",
            detail:
              "Cut away from your hands and body when scoring caulk, and keep fingers clear of the blade path. Wear safety glasses in case bits of hardened caulk flick up.",
            requiresAcknowledgment: true,
          },
        ],
        whyItMatters:
          "New caulk only bonds to a clean surface. Any old residue left behind becomes a weak point where water gets in.",
        beginnerTip: "A plastic caulk removal tool is less likely to scratch your tub than a metal blade — reach for it first.",
        commonMistake: "Leaving a thin skin of old caulk in the joint that stops the new bead from sticking.",
        imageAlt: "Old cracked caulk being scraped out of the joint between a bathtub and tiled wall.",
      },
      {
        id: "proj-recaulk-tub-step-2",
        order: 2,
        title: "Clean and dry the joint",
        instructions:
          "Scrub the joint with cleaner to remove soap scum and any mildew, then rinse. Wipe the entire seam with rubbing alcohol and let it dry completely. The surface must be spotless and bone dry for the new caulk to grip.",
        estimatedMinutes: 8,
        tools: [{ toolId: "tool-sponge" }, { toolId: "tool-bucket" }],
        materials: [
          { materialId: "mat-cleaner", quantity: 1 },
          { materialId: "mat-rubbing-alcohol", quantity: 1 },
        ],
        safetyWarnings: [
          {
            id: "proj-recaulk-tub-warn-2",
            level: "moderate",
            title: "Ventilate and don't mix cleaners",
            detail:
              "Keep the fan on and never mix bathroom cleaners together, as some combinations release harmful gases. Rubbing alcohol is flammable, so keep it away from any flame.",
            requiresAcknowledgment: true,
          },
        ],
        whyItMatters:
          "Soap film and moisture are the top reasons a fresh bead of caulk fails early. A clean, dry joint is the foundation of a lasting seal.",
        beginnerTip: "Give the alcohol wipe plenty of time to flash off — even slight dampness undermines adhesion.",
        commonMistake: "Caulking right after cleaning while the joint is still damp from rinsing.",
        imageAlt: "A gloved hand wiping the cleaned tub joint with an alcohol-dampened cloth.",
      },
      {
        id: "proj-recaulk-tub-step-3",
        order: 3,
        title: "Mask both sides with tape",
        instructions:
          "Run painter's tape along the tub side and the wall side of the joint, leaving a consistent narrow gap for the caulk. This frames your bead so you get a straight, even line even if your hand wavers. Press the tape edges down firmly.",
        estimatedMinutes: 6,
        tools: [],
        materials: [{ materialId: "mat-painters-tape2", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "Taping gives you a professional-looking straight bead and keeps stray caulk off the tub and tile.",
        beginnerTip: "Keep the tape gap consistent by eye as you go — an even gap is what makes the finished bead look uniform.",
        commonMistake: "Leaving too wide a gap, which produces a thick, messy bead that is hard to tool smooth.",
        imageAlt: "Painter's tape lining both sides of a tub-to-wall joint leaving a narrow channel for caulk.",
      },
      {
        id: "proj-recaulk-tub-step-4",
        order: 4,
        title: "Apply the new caulk bead",
        instructions:
          "Cut the caulk tube tip at a slight angle to match the joint width and load it in the gun. Holding the gun at about 45 degrees, squeeze steadily while moving along the joint to lay one continuous bead. Keep a smooth, even pace so the bead is consistent.",
        estimatedMinutes: 8,
        tools: [{ toolId: "tool-caulk-gun" }],
        materials: [{ materialId: "mat-tub-caulk", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "One continuous bead seals better than a stop-and-start line, which leaves gaps where water can enter.",
        beginnerTip: "Practice a short test bead on scrap or cardboard first to get a feel for the trigger pressure.",
        commonMistake: "Cutting the tip too large, which dumps out far more caulk than the joint needs.",
        imageAlt: "A caulk gun laying a smooth bead of white caulk along a taped tub joint.",
      },
      {
        id: "proj-recaulk-tub-step-5",
        order: 5,
        title: "Tool the bead and pull the tape",
        instructions:
          "Smooth the bead with a wet fingertip or a caulk tool in one steady pass to press it into the joint and create a clean concave surface. Immediately pull the tape away at a shallow angle while the caulk is still wet. Wipe any smears before they set.",
        estimatedMinutes: 6,
        tools: [],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Tooling forces caulk into the gap for a watertight seal, and pulling the tape while wet leaves crisp edges.",
        beginnerTip: "Keep a damp rag handy and wipe your finger clean after every pass so you do not drag caulk around.",
        commonMistake: "Waiting to pull the tape until the caulk skins over, which tears a ragged edge.",
        imageAlt: "A fingertip smoothing a fresh caulk bead into a concave line along a bathtub edge.",
      },
      {
        id: "proj-recaulk-tub-step-6",
        order: 6,
        title: "Let it cure fully before use",
        instructions:
          "Leave the tub completely dry and unused while the caulk cures — commonly 24 hours, but always follow the tube's stated time. Keep the fan running to help it set. Only run water once the full cure period has passed.",
        estimatedMinutes: 5,
        tools: [],
        materials: [],
        safetyWarnings: [
          {
            id: "proj-recaulk-tub-warn-3",
            level: "moderate",
            title: "Respect the full cure time",
            detail:
              "Using the tub before the caulk has fully cured breaks the seal and traps moisture behind it. Wait the entire time listed on the tube before any water contact.",
            requiresAcknowledgment: true,
          },
        ],
        whyItMatters:
          "Caulk needs its full cure to become waterproof. Getting it wet early ruins the seal and you will be redoing the job.",
        beginnerTip: "Post a note on the tub so no one in the household uses it before the cure time is up.",
        commonMistake: "Assuming a surface-dry bead is fully cured and showering that same evening.",
        imageAlt: "A freshly caulked bathtub joint left to cure with a clean, smooth white bead.",
      },
    ],
    troubleshooting: [
      {
        id: "proj-recaulk-tub-ts-1",
        keywords: ["peeling", "not sticking", "lifting", "wont adhere", "pulling away"],
        stepId: "proj-recaulk-tub-step-4",
        symptom: "The new caulk is peeling or lifting away from the joint.",
        likelyCauses: [
          "The joint may have still been damp or soapy when caulked.",
          "Residue of old caulk may have prevented a proper bond.",
        ],
        safeChecks: [
          "Gently lift an edge to see whether it releases cleanly with no adhesion.",
          "Look for leftover old caulk or film in the joint.",
        ],
        correctiveActions: [
          "Remove the failed section, clean and dry the joint thoroughly, and re-caulk.",
          "Confirm the surface is fully dry before applying new caulk.",
        ],
        stopIf: ["The wall behind the joint feels soft, suggesting water already got in."],
        callProfessionalIf: ["Repeated failure and soft walls point to hidden water damage."],
      },
      {
        id: "proj-recaulk-tub-ts-2",
        keywords: ["messy", "uneven", "lumpy", "bumpy", "bead"],
        stepId: "proj-recaulk-tub-step-5",
        symptom: "The finished bead looks lumpy or uneven.",
        likelyCauses: [
          "The caulk may have been applied at an inconsistent pace.",
          "The bead may not have been tooled smooth in a single steady pass.",
        ],
        safeChecks: [
          "Look along the bead to spot thick and thin sections.",
          "Check whether the tape gap was even along the joint.",
        ],
        correctiveActions: [
          "While still wet, retool the bead in one smooth pass with a wet finger.",
          "If already set, cut it out and reapply with a steadier, even motion.",
        ],
        stopIf: ["Reworking cured caulk begins damaging the tub or tile surface."],
        callProfessionalIf: ["You cannot achieve a watertight, clean bead on a prominent seam."],
      },
      {
        id: "proj-recaulk-tub-ts-3",
        keywords: ["mold", "black", "mildew", "behind", "smell"],
        stepId: "proj-recaulk-tub-step-1",
        symptom: "You find black mold or a musty smell behind the old caulk.",
        likelyCauses: [
          "Water may have been seeping past the old seal for some time.",
          "Poor ventilation may have let moisture linger in the joint.",
        ],
        safeChecks: [
          "Look at how far the discoloration extends beyond the joint.",
          "Feel whether the surrounding wall or tile is loose or soft.",
        ],
        correctiveActions: [
          "Clean surface mildew with an appropriate bathroom cleaner and let the area dry fully.",
          "Improve ventilation with the exhaust fan to prevent recurrence.",
        ],
        stopIf: ["Mold extends behind loose tile or into soft wall material."],
        callProfessionalIf: ["Mold or rot has reached the wall structure behind the surround."],
      },
    ],
    imageAlt: "A bathtub with a clean, smooth new bead of white caulk sealing the joint against the tiled wall.",
    featured: false,
  },

  /* ------------------------------------------------------------------ */
  /* 6. Replace a cabinet handle                                         */
  /* ------------------------------------------------------------------ */
  {
    id: "proj-cabinet-handle",
    slug: "replace-a-cabinet-handle",
    title: "Replace a Cabinet Handle",
    category: "furniture",
    summary:
      "Swap tired cabinet knobs or pulls for fresh hardware — a five-minute upgrade that instantly refreshes a kitchen or dresser.",
    description:
      "Changing cabinet hardware is the easiest way to modernize furniture or cabinetry, and it takes little more than a screwdriver. If your new handle uses the same hole spacing as the old one, it is a simple swap. If not, you will drill one new hole — still a very beginner-friendly task. This project shows you how to measure hole spacing so your new pulls fit the first time.",
    difficulty: "beginner",
    safetyLevel: "low",
    indoor: true,
    renterFriendly: true,
    requiresPermitOrPro: false,
    activeMinutes: 15,
    totalMinutes: 25,
    costBand: "under_25",
    estimatedCostLowCents: 500,
    estimatedCostHighCents: 2000,
    recommendedPeople: 1,
    skillPrerequisites: ["Comfortable using a screwdriver"],
    tools: [
      { toolId: "tool-screwdriver", optional: false },
      { toolId: "tool-tape-measure", optional: false, note: "For measuring the hole spacing (the 'center-to-center')." },
      { toolId: "tool-pencil", optional: true, note: "For marking a new hole if the spacing differs." },
      { toolId: "tool-drill", optional: true, note: "Only needed if the new pull requires a new hole." },
    ],
    materials: [
      { materialId: "mat-cabinet-handle", quantity: 1, note: "Buy one to start and confirm fit before purchasing the full set." },
      { materialId: "mat-cabinet-screw", quantity: 1, note: "New hardware usually includes screws, but sizes vary — have spares." },
    ],
    preparation: [
      "Measure the center-to-center spacing of your existing pulls before shopping.",
      "Buy a single new handle first to test the fit before committing to a full set.",
      "Gather a screwdriver and the new hardware's included screws.",
      "Have a small container ready to hold the old screws and handles.",
    ],
    safetyEquipment: ["Safety glasses"],
    commonMistakes: [
      "Buying pulls with different hole spacing than the existing holes.",
      "Overtightening screws and stripping the threads or cracking the door.",
      "Losing the tiny screws by not setting them aside as you remove them.",
    ],
    doNotAttemptIf: [
      "The cabinet face is thin veneer that is already cracking around the holes.",
      "You need to relocate holes on a visible antique piece you cannot risk damaging.",
    ],
    callProfessionalIf: [
      "Repositioning handles requires filling and refinishing holes on fine furniture.",
      "The cabinet material is crumbling and will not hold any fastener.",
    ],
    steps: [
      {
        id: "proj-cabinet-handle-step-1",
        order: 1,
        title: "Remove the old handle",
        instructions:
          "From the inside of the door or drawer, unscrew the screws holding the old handle and set them aside. Catch the handle so it does not drop. Keep the screws in a small container in case you need them.",
        estimatedMinutes: 4,
        tools: [{ toolId: "tool-screwdriver" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Removing hardware from the back keeps the visible face clean and lets you see the exact hole spacing you need to match.",
        beginnerTip: "Have one hand on the handle as you loosen the last turn so it does not fall and ding the floor.",
        commonMistake: "Letting the loose screws roll away and disappear before the new ones are confirmed to fit.",
        imageAlt: "A screwdriver removing the screw from the back of a cabinet door handle.",
      },
      {
        id: "proj-cabinet-handle-step-2",
        order: 2,
        title: "Measure the hole spacing",
        instructions:
          "Measure the distance between the centers of the two mounting holes — this is the 'center-to-center' measurement that a pull must match. For a single knob, there is just one hole. Confirm your new hardware matches before going further.",
        estimatedMinutes: 4,
        tools: [{ toolId: "tool-tape-measure" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Matching the hole spacing means the new pull drops right in with no drilling. A mismatch means new holes and patching old ones.",
        beginnerTip: "Common pull spacings are standard sizes like 3 inches or 96mm — measure precisely so you buy the right one.",
        commonMistake: "Measuring edge-to-edge instead of center-to-center and buying the wrong size.",
        imageAlt: "A tape measure spanning the two mounting holes on a cabinet door to find their spacing.",
      },
      {
        id: "proj-cabinet-handle-step-3",
        order: 3,
        title: "Position the new handle",
        instructions:
          "Line the new handle up with the existing holes and confirm the screws pass through cleanly. If the new pull has the same spacing, it will seat right away. If it looks slightly off, recheck your measurement before drilling anything.",
        estimatedMinutes: 3,
        tools: [{ toolId: "tool-pencil" }],
        materials: [{ materialId: "mat-cabinet-handle", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "A quick dry-fit confirms everything lines up before you commit, saving you from misaligned hardware.",
        beginnerTip: "If you must drill a new hole, mark it precisely and start with a small pilot to keep the bit from wandering.",
        commonMistake: "Forcing screws through slightly misaligned holes and cross-threading them.",
        imageAlt: "A new cabinet pull held in position against the existing mounting holes on a door.",
      },
      {
        id: "proj-cabinet-handle-step-4",
        order: 4,
        title: "Drive the screws snug",
        instructions:
          "Insert the screws from the back and thread them into the new handle by hand first, then tighten with the screwdriver. Stop as soon as the handle is firm against the face — snug, not forced. Overtightening can strip the hole or dent the door.",
        estimatedMinutes: 4,
        tools: [{ toolId: "tool-screwdriver" }, { toolId: "tool-drill" }],
        materials: [{ materialId: "mat-cabinet-screw", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "Hand-starting the screws avoids cross-threading, and stopping at snug protects the cabinet face from damage.",
        beginnerTip: "If the included screw is too long or short for your door thickness, swap in one of your spares.",
        commonMistake: "Reefing on the screwdriver until the screw strips out or the wood cracks.",
        imageAlt: "A screwdriver tightening the mounting screw of a newly installed cabinet handle.",
      },
      {
        id: "proj-cabinet-handle-step-5",
        order: 5,
        title: "Test and repeat across the set",
        instructions:
          "Give the handle a firm pull and a wiggle to confirm it is secure and does not spin. Once you are happy with the fit, repeat the same steps on the rest of the cabinets. Keep the hardware oriented consistently for a uniform look.",
        estimatedMinutes: 3,
        tools: [{ toolId: "tool-screwdriver" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Testing each handle catches a loose or spinning one early, and consistent orientation makes the whole set look intentional.",
        beginnerTip: "Do one handle completely first as a test before opening all your new hardware, in case the fit is wrong.",
        commonMistake: "Installing the whole set before realizing the spacing or screw length was wrong on the first one.",
        imageAlt: "A row of kitchen cabinets fitted with matching new handles installed uniformly.",
      },
    ],
    troubleshooting: [
      {
        id: "proj-cabinet-handle-ts-1",
        keywords: ["wont line up", "holes dont match", "misaligned", "wrong spacing"],
        stepId: "proj-cabinet-handle-step-3",
        symptom: "The new handle's screws will not line up with the existing holes.",
        likelyCauses: [
          "The new pull may have a different center-to-center spacing than the old one.",
          "The measurement may have been taken edge-to-edge instead of center-to-center.",
        ],
        safeChecks: [
          "Re-measure the existing holes center-to-center.",
          "Compare that number to the new hardware's stated spacing.",
        ],
        correctiveActions: [
          "Exchange the hardware for one matching your hole spacing.",
          "If committed to this pull, drill a new hole and fill the old one before installing.",
        ],
        stopIf: ["Drilling a new hole would break through thin veneer or split the door."],
        callProfessionalIf: ["Relocating holes on fine or antique furniture risks visible damage."],
      },
      {
        id: "proj-cabinet-handle-ts-2",
        keywords: ["screw too long", "screw too short", "wont reach", "sticks out"],
        stepId: "proj-cabinet-handle-step-4",
        symptom: "The included screw is too long or too short for your cabinet.",
        likelyCauses: [
          "The door thickness may differ from what the hardware assumed.",
          "Thicker drawer fronts sometimes need longer machine screws.",
        ],
        safeChecks: [
          "Hold the screw against the door edge to gauge the length needed.",
          "Check whether the screw bottoms out or pokes through.",
        ],
        correctiveActions: [
          "Swap in a cabinet screw of the correct length from your spares.",
          "For thick fronts, buy longer machine screws in the same thread size.",
        ],
        stopIf: ["A too-long screw is about to punch through the visible face."],
        callProfessionalIf: ["No standard-length screw fits and the cabinet needs custom hardware."],
      },
      {
        id: "proj-cabinet-handle-ts-3",
        keywords: ["spins", "loose", "wont tighten", "stripped", "wobbly"],
        stepId: "proj-cabinet-handle-step-4",
        symptom: "The handle spins or stays loose no matter how much you tighten.",
        likelyCauses: [
          "The screw threads may have stripped in the handle or the hole may be oversized.",
          "The handle post may be cross-threaded.",
        ],
        safeChecks: [
          "Back the screw out and inspect the threads for damage.",
          "Check whether the hole in the door has widened.",
        ],
        correctiveActions: [
          "Replace the stripped screw with a fresh one of the correct thread.",
          "For a slightly oversized hole, a thin washer or a dab of wood filler can restore grip.",
        ],
        stopIf: ["The cabinet material around the hole is crumbling and will not hold a screw."],
        callProfessionalIf: ["The door face is damaged enough to need refinishing to hold hardware."],
      },
    ],
    imageAlt: "A kitchen cabinet door fitted with a stylish new brushed-metal pull replacing the old worn handle.",
    featured: false,
  },

  /* ------------------------------------------------------------------ */
  /* 7. Fix a running toilet flapper                                     */
  /* ------------------------------------------------------------------ */
  {
    id: "proj-toilet-flapper",
    slug: "fix-a-running-toilet-flapper",
    title: "Fix a Running Toilet Flapper",
    category: "plumbing",
    summary:
      "Stop that constant trickle and phantom refilling by replacing the worn rubber flapper inside the tank — no plumber required.",
    description:
      "A toilet that keeps running or randomly refills is usually caused by a worn flapper — the rubber seal at the bottom of the tank that lets water down when you flush. It is one of the most common and wallet-friendly plumbing fixes, wasting gallons of water until it is addressed. Best of all, it involves no pipes and no specialized tools: shut off the water, swap the flapper, and you are done.",
    difficulty: "beginner",
    safetyLevel: "low",
    indoor: true,
    renterFriendly: true,
    requiresPermitOrPro: false,
    permitDisclaimer:
      "Replacing a flapper is a simple homeowner fix. If the toilet keeps running after a new flapper, or you notice leaks around the base or supply line, the problem lies beyond the flapper and you should consult a plumber.",
    activeMinutes: 20,
    totalMinutes: 30,
    costBand: "under_25",
    estimatedCostLowCents: 500,
    estimatedCostHighCents: 1500,
    recommendedPeople: 1,
    skillPrerequisites: ["Comfortable reaching into a toilet tank and turning a shutoff valve"],
    tools: [
      { toolId: "tool-sponge", optional: true, note: "For mopping up the little water left in the tank bottom." },
      { toolId: "tool-bucket", optional: true, note: "Handy to catch drips when disconnecting anything." },
    ],
    materials: [
      { materialId: "mat-toilet-flapper", quantity: 1, note: "Bring your old flapper to the store to match the size and style." },
    ],
    preparation: [
      "Take the tank lid off and set it flat somewhere safe — it is heavy and breakable.",
      "Locate the water shutoff valve on the wall or floor behind the toilet.",
      "Note the flapper's shape and how it attaches so you can buy a match.",
      "Lay a towel on the floor to catch any drips.",
    ],
    safetyEquipment: ["Work gloves"],
    commonMistakes: [
      "Forgetting to shut off the water before starting.",
      "Buying a generic flapper that does not match your toilet's flush valve.",
      "Setting the chain too tight or too loose so the flapper cannot seat or seal.",
    ],
    doNotAttemptIf: [
      "You see water leaking from the tank bolts or the base of the toilet, which is a different repair.",
      "The shutoff valve is corroded and will not turn, risking a break.",
    ],
    callProfessionalIf: [
      "The toilet keeps running after a correctly installed new flapper.",
      "You find leaks at the base, cracked porcelain, or a shutoff valve that fails.",
    ],
    steps: [
      {
        id: "proj-toilet-flapper-step-1",
        order: 1,
        title: "Shut off the water and drain the tank",
        instructions:
          "Turn the shutoff valve behind the toilet clockwise until it stops to cut the water supply. Flush the toilet to drain the tank, holding the handle down to let out as much water as possible. Sponge out the little that remains in the bottom.",
        estimatedMinutes: 5,
        tools: [{ toolId: "tool-sponge" }, { toolId: "tool-bucket" }],
        materials: [],
        safetyWarnings: [
          {
            id: "proj-toilet-flapper-warn-1",
            level: "moderate",
            title: "Shut off the water first",
            detail:
              "Always close the supply valve and drain the tank before working inside it. Skipping this can leave you fighting a constant refill or overflowing the tank. If the valve will not turn, stop rather than forcing it.",
            requiresAcknowledgment: true,
          },
        ],
        whyItMatters:
          "Working in an empty tank keeps the job dry and lets you see and reach the flapper clearly.",
        beginnerTip: "If the shutoff valve is stiff, turn it gently — forcing an old corroded valve can snap it.",
        commonMistake: "Skipping the shutoff and battling water pouring in the whole time.",
        imageAlt: "A hand turning the water shutoff valve behind a toilet clockwise to close it.",
      },
      {
        id: "proj-toilet-flapper-step-2",
        order: 2,
        title: "Remove the old flapper",
        instructions:
          "Unhook the chain from the flush handle arm, then unclip or slide the flapper off the pegs at the base of the overflow tube. Note exactly how it was attached. The old flapper often looks warped, slimy, or brittle — that is your culprit.",
        estimatedMinutes: 4,
        tools: [],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Seeing how the old flapper mounts tells you exactly how the new one goes on, and confirms it was the source of the leak.",
        beginnerTip: "Wear gloves — the bottom of a tank can be grimy with mineral buildup even though the water is clean.",
        commonMistake: "Yanking the flapper off without noting the chain length and attachment points.",
        imageAlt: "A worn rubber toilet flapper being unclipped from the base of the overflow tube inside a tank.",
      },
      {
        id: "proj-toilet-flapper-step-3",
        order: 3,
        title: "Install the new flapper",
        instructions:
          "Attach the new flapper the same way the old one came off, clipping or sliding it onto the overflow tube pegs. Make sure it sits flat and centered over the flush valve opening so it can seal. Confirm it moves freely up and down.",
        estimatedMinutes: 5,
        tools: [],
        materials: [{ materialId: "mat-toilet-flapper", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "A flapper that sits flat and centered is what forms the watertight seal that stops the tank from leaking down into the bowl.",
        beginnerTip: "If your flapper has an adjustable dial or float, leave it at the middle setting to start.",
        commonMistake: "Mounting the flapper crooked so it never fully seals against the valve seat.",
        imageAlt: "A new rubber flapper clipped onto the overflow tube and seated over the flush valve.",
      },
      {
        id: "proj-toilet-flapper-step-4",
        order: 4,
        title: "Set the chain length",
        instructions:
          "Reconnect the chain to the flush handle arm with just a small amount of slack — enough that the flapper can close fully, but not so much that it tangles under the flapper. Too tight and the flapper stays cracked open; too loose and it catches. Aim for a little slack when the flapper is closed.",
        estimatedMinutes: 3,
        tools: [],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Chain length is the number one thing people get wrong. Correct slack lets the flapper seal after each flush.",
        beginnerTip: "Hook the chain so there is roughly a half inch of slack — adjust by a link at a time.",
        commonMistake: "Leaving the chain too tight so it holds the flapper open and the toilet keeps running.",
        imageAlt: "A hand adjusting the chain length between the flush handle arm and the new flapper.",
      },
      {
        id: "proj-toilet-flapper-step-5",
        order: 5,
        title: "Turn the water back on and test",
        instructions:
          "Open the shutoff valve counterclockwise to refill the tank. Watch the flapper seal as the tank fills and the water stops at the fill line. Flush a couple of times and listen — no trickling or repeat refilling means success. If it still runs, adjust the chain slack.",
        estimatedMinutes: 5,
        tools: [],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Testing with a few real flushes confirms the seal holds under normal use before you put the lid back on.",
        beginnerTip: "Put a few drops of food coloring in the tank and wait — if color creeps into the bowl, the seal still leaks.",
        commonMistake: "Declaring victory after one flush without listening for the sneaky trickle that returns minutes later.",
        imageAlt: "A refilled toilet tank with the new flapper sealed and water settled at the fill line.",
      },
    ],
    troubleshooting: [
      {
        id: "proj-toilet-flapper-ts-1",
        keywords: ["still running", "keeps running", "trickle", "wont stop", "phantom flush"],
        stepId: "proj-toilet-flapper-step-5",
        symptom: "The toilet still runs after installing the new flapper.",
        likelyCauses: [
          "The chain may be too tight and holding the flapper slightly open.",
          "The flapper may not match the flush valve seat, or the seat may be worn or gritty.",
        ],
        safeChecks: [
          "Watch the flapper close and see if the chain is pulling it open.",
          "Do the food-coloring test to confirm whether it is sealing.",
        ],
        correctiveActions: [
          "Loosen the chain by a link or two so the flapper seats fully.",
          "Wipe the valve seat clean of mineral grit, or fit a flapper matched to your valve.",
        ],
        stopIf: ["Water rises toward the tank rim or overflows despite adjustment."],
        callProfessionalIf: ["The toilet keeps running with a correct, well-seated flapper, pointing to a valve or fill issue."],
      },
      {
        id: "proj-toilet-flapper-ts-2",
        keywords: ["valve stuck", "wont turn", "corroded", "shutoff"],
        stepId: "proj-toilet-flapper-step-1",
        symptom: "The shutoff valve will not turn or feels stuck.",
        likelyCauses: [
          "The valve may be corroded or seized from years of no use.",
          "Mineral buildup may be binding the valve stem.",
        ],
        safeChecks: [
          "Try turning it gently by hand to feel whether it gives at all.",
          "Look for corrosion or moisture around the valve body.",
        ],
        correctiveActions: [
          "Do not force it — a seized valve can snap and cause a flood.",
          "If your home has a main water shutoff, that is an alternative for a careful worker.",
        ],
        stopIf: ["The valve weeps water or feels like it is about to break."],
        callProfessionalIf: ["The shutoff valve is corroded, leaking, or will not close."],
      },
      {
        id: "proj-toilet-flapper-ts-3",
        keywords: ["leak base", "water on floor", "leaking bolts", "puddle", "cracked"],
        stepId: null,
        symptom: "You see water on the floor or leaking from the tank bolts or base.",
        likelyCauses: [
          "The leak may be from tank-to-bowl bolts, the supply line, or the base wax seal — not the flapper.",
          "Cracked porcelain could be weeping water.",
        ],
        safeChecks: [
          "Dry the area and watch to locate exactly where water reappears.",
          "Check whether the leak tracks to the bolts, supply line, or base.",
        ],
        correctiveActions: [
          "For a flapper-only project, this is beyond scope — shut the water off and stop.",
          "Keep the supply valve closed to prevent water damage until it is addressed.",
        ],
        stopIf: ["Water is actively pooling on the floor or you see a crack in the porcelain."],
        callProfessionalIf: ["The leak is at the base, the bolts, the supply line, or the porcelain is cracked."],
      },
    ],
    imageAlt: "The inside of a toilet tank with a clean new flapper seated over the flush valve and the water settled and still.",
    featured: true,
  },

  /* ------------------------------------------------------------------ */
  /* 8. Assemble a wooden planter box                                    */
  /* ------------------------------------------------------------------ */
  {
    id: "proj-planter-box",
    slug: "assemble-a-wooden-planter-box",
    title: "Assemble a Wooden Planter Box",
    category: "woodworking",
    summary:
      "Build a simple, sturdy cedar planter box for your porch or garden using pre-cut boards, glue, and exterior screws.",
    description:
      "A wooden planter box is a perfect first woodworking project: straightforward cuts, forgiving joints, and a genuinely useful result. Using rot-resistant cedar and exterior-rated screws, you will build a box that stands up to weather and holds soil for herbs, flowers, or vegetables. This project focuses on squaring up the frame, fastening it solidly, and adding drainage so your plants thrive.",
    difficulty: "beginner",
    safetyLevel: "low",
    indoor: false,
    renterFriendly: true,
    requiresPermitOrPro: false,
    activeMinutes: 75,
    totalMinutes: 120,
    costBand: "25_75",
    estimatedCostLowCents: 3000,
    estimatedCostHighCents: 7000,
    recommendedPeople: 1,
    skillPrerequisites: [
      "Comfortable operating a power drill and driver",
      "Able to measure and mark boards accurately",
    ],
    tools: [
      { toolId: "tool-drill", optional: false },
      { toolId: "tool-screwdriver", optional: true, note: "For final tightening if you prefer hand control." },
      { toolId: "tool-clamps", optional: false, note: "Clamps hold boards square while you drive the first screws." },
      { toolId: "tool-tape-measure", optional: false },
      { toolId: "tool-pencil", optional: false },
      { toolId: "tool-sanding-block", optional: false },
      { toolId: "tool-sandpaper", optional: false, note: "Medium grit to knock off splinters and ease sharp edges." },
    ],
    materials: [
      { materialId: "mat-cedar-boards", quantity: 1, note: "Cedar resists rot outdoors; buy pre-cut to size if you can." },
      { materialId: "mat-wood-glue", quantity: 1, note: "Use an exterior/waterproof wood glue for weather resistance." },
      { materialId: "mat-exterior-screws", quantity: 1, note: "Exterior-rated screws will not rust and streak the wood." },
      { materialId: "mat-landscape-fabric", quantity: 1, note: "Lines the box to hold soil while letting water drain." },
    ],
    preparation: [
      "Lay out and check your cedar boards against the cut list before assembling.",
      "Work on a flat, stable surface with room to clamp and drill.",
      "Dry-fit the pieces once to confirm everything lines up square.",
      "Pre-plan where drainage holes will go in the base.",
      "Set up outdoors or in a ventilated space since sanding creates dust.",
    ],
    safetyEquipment: ["Safety glasses", "Work gloves", "Dust mask"],
    commonMistakes: [
      "Assembling the frame out of square so the box rocks or gaps at the corners.",
      "Driving screws into cedar without pilot holes, splitting the board ends.",
      "Forgetting drainage holes, which drowns the plants and rots the box.",
    ],
    doNotAttemptIf: [
      "You have no safe, stable surface to clamp and drill on.",
      "The lumber is treated with chemicals not rated for growing edible plants and you intend to grow food.",
    ],
    callProfessionalIf: [
      "The design has grown into a large structural planter or raised bed you are unsure how to support.",
      "You need power tools you are not trained to operate safely.",
    ],
    steps: [
      {
        id: "proj-planter-box-step-1",
        order: 1,
        title: "Sand the boards and ease the edges",
        instructions:
          "Sand each board's faces and, importantly, the sharp edges and ends to remove splinters. Cedar can be splintery, and smoothing it now makes the box nicer to handle and finish. Wipe off the dust before assembly.",
        estimatedMinutes: 12,
        tools: [{ toolId: "tool-sanding-block" }, { toolId: "tool-sandpaper" }],
        materials: [{ materialId: "mat-cedar-boards", quantity: 1 }],
        safetyWarnings: [
          {
            id: "proj-planter-box-warn-1",
            level: "moderate",
            title: "Wear a dust mask while sanding",
            detail:
              "Wood dust irritates the lungs and eyes. Wear a dust mask and safety glasses, and sand in a ventilated area or outdoors.",
            requiresAcknowledgment: true,
          },
        ],
        whyItMatters:
          "Smoothing edges now is far easier than after assembly, and it prevents splinters when you handle and plant the box.",
        beginnerTip: "Sand with the grain, not across it, to avoid leaving scratches that show once the wood weathers.",
        commonMistake: "Skipping the ends and edges, leaving sharp splintery corners on the finished box.",
        imageAlt: "A cedar board being smoothed with a sanding block to remove splinters from its edge.",
      },
      {
        id: "proj-planter-box-step-2",
        order: 2,
        title: "Dry-fit and mark the assembly",
        instructions:
          "Arrange the four side boards into the box shape and check that the corners meet squarely. Use your tape measure to confirm the box is the right size and the diagonals are equal, which means it is square. Mark where each screw will go along the corner joints.",
        estimatedMinutes: 12,
        tools: [{ toolId: "tool-tape-measure" }, { toolId: "tool-pencil" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "A dry fit catches sizing problems before glue and screws lock everything in place, and equal diagonals confirm a square box.",
        beginnerTip: "Measure both diagonals corner to corner — when they match, the box is truly square.",
        commonMistake: "Assuming the corners are square by eye and ending up with a box that rocks.",
        imageAlt: "Four cedar boards arranged into a box shape being checked for square with a tape measure.",
      },
      {
        id: "proj-planter-box-step-3",
        order: 3,
        title: "Glue and clamp the corners",
        instructions:
          "Apply a thin, even bead of exterior wood glue to the mating surfaces of each corner joint. Press the boards together and clamp them so the corners stay square while you work. Wipe away any glue that squeezes out.",
        estimatedMinutes: 12,
        tools: [{ toolId: "tool-clamps" }],
        materials: [{ materialId: "mat-wood-glue", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "Glue adds strength and stiffness to the joints, and clamping keeps everything aligned so the screws go in square.",
        beginnerTip: "Keep a damp rag handy — wiping squeeze-out now saves you from sanding dried glue later.",
        commonMistake: "Using too much glue so it runs everywhere, or skipping clamps so the corners shift.",
        imageAlt: "Two cedar boards glued at a corner and held square with a clamp.",
      },
      {
        id: "proj-planter-box-step-4",
        order: 4,
        title: "Drill pilot holes and drive the screws",
        instructions:
          "At each marked point, drill a pilot hole slightly smaller than your screws to prevent the cedar from splitting. Drive exterior screws through the pilot holes to fasten the corners tight. Two or three screws per corner is plenty for a planter this size.",
        estimatedMinutes: 15,
        tools: [{ toolId: "tool-drill" }, { toolId: "tool-screwdriver" }],
        materials: [{ materialId: "mat-exterior-screws", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "Pilot holes stop the board ends from splitting, and exterior screws hold without rusting and staining the wood.",
        beginnerTip: "Keep pilot holes back from the very end of the board — screws too close to the end still split cedar.",
        commonMistake: "Skipping pilot holes and cracking the ends of the boards as the screws go in.",
        imageAlt: "A drill driving an exterior screw through a pilot hole into the corner of a cedar planter.",
      },
      {
        id: "proj-planter-box-step-5",
        order: 5,
        title: "Attach the base and add drainage",
        instructions:
          "Fasten the base board(s) to the bottom of the frame with glue and screws the same way. Then drill several drainage holes through the base so excess water can escape. Space the holes evenly across the bottom.",
        estimatedMinutes: 12,
        tools: [{ toolId: "tool-drill" }],
        materials: [
          { materialId: "mat-exterior-screws", quantity: 1 },
          { materialId: "mat-wood-glue", quantity: 1 },
        ],
        safetyWarnings: [],
        whyItMatters:
          "Drainage holes are essential — without them, water pools, drowns the roots, and rots the box from the inside.",
        beginnerTip: "A half-dozen holes around a half inch across is a good starting point for a small planter.",
        commonMistake: "Building a watertight box with no drainage, which kills the plants and the wood.",
        imageAlt: "The bottom of a cedar planter box with several evenly spaced drainage holes drilled through it.",
      },
      {
        id: "proj-planter-box-step-6",
        order: 6,
        title: "Line the box and finish",
        instructions:
          "Cut landscape fabric to line the inside of the box, covering the walls and base but leaving the drainage holes able to drain. This holds the soil in while letting water pass through. Give the box a final sanding of any rough spots and it is ready to plant.",
        estimatedMinutes: 12,
        tools: [{ toolId: "tool-sanding-block" }],
        materials: [{ materialId: "mat-landscape-fabric", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "The fabric liner keeps soil from washing out the drainage holes and protects the wood from constant soil contact.",
        beginnerTip: "Poke the fabric down over each drainage hole rather than sealing them, so water still flows out.",
        commonMistake: "Lining so tightly that the drainage holes are blocked and water cannot escape.",
        imageAlt: "A finished cedar planter box lined with landscape fabric, ready to be filled with soil.",
      },
    ],
    troubleshooting: [
      {
        id: "proj-planter-box-ts-1",
        keywords: ["not square", "rocks", "wobbles", "gaps", "crooked"],
        stepId: "proj-planter-box-step-2",
        symptom: "The assembled box rocks or has gaps at the corners.",
        likelyCauses: [
          "The frame may have been fastened out of square.",
          "The boards may be slightly bowed or cut unevenly.",
        ],
        safeChecks: [
          "Measure both diagonals to see how far out of square it is.",
          "Set the box on a flat surface to find which corner lifts.",
        ],
        correctiveActions: [
          "If caught before glue sets, re-clamp square and refasten.",
          "For a set frame, add a small corner brace or shim the low foot.",
        ],
        stopIf: ["Disassembly would split the glued and screwed joints."],
        callProfessionalIf: ["The project has scaled up to a structural planter that must bear significant load."],
      },
      {
        id: "proj-planter-box-ts-2",
        keywords: ["split", "cracked", "board split", "screw split"],
        stepId: "proj-planter-box-step-4",
        symptom: "A board split when you drove a screw.",
        likelyCauses: [
          "The screw may have gone in without a pilot hole.",
          "The screw may have been placed too close to the board end.",
        ],
        safeChecks: [
          "Look at whether the split runs from a screw near the end.",
          "Check if pilot holes were drilled at that joint.",
        ],
        correctiveActions: [
          "Back the screw out, apply glue into the split, clamp it closed, and refasten with a pilot hole farther from the end.",
          "For a badly split board, replace that piece.",
        ],
        stopIf: ["The split runs the length of a structural board."],
        callProfessionalIf: ["The lumber keeps splitting and you are unsure how to fasten it safely."],
      },
      {
        id: "proj-planter-box-ts-3",
        keywords: ["waterlogged", "soggy", "no drainage", "water pooling", "roots rotting"],
        stepId: "proj-planter-box-step-5",
        symptom: "Water pools in the box and the soil stays soggy.",
        likelyCauses: [
          "There may be too few or no drainage holes.",
          "The fabric liner may be blocking the holes.",
        ],
        safeChecks: [
          "Pour a little water in and watch whether it drains out the bottom.",
          "Lift the liner to confirm the holes are open.",
        ],
        correctiveActions: [
          "Drill additional drainage holes across the base.",
          "Poke the fabric open over each hole so water can pass.",
        ],
        stopIf: ["The base wood is already soft and rotting from trapped water."],
        callProfessionalIf: ["Not applicable — but replace rotted lumber before replanting."],
      },
    ],
    imageAlt: "A finished cedar planter box sitting on a porch, filled with soil and a few small green plants.",
    featured: false,
  },

  /* ------------------------------------------------------------------ */
  /* 9. Install peel-and-stick backsplash                                */
  /* ------------------------------------------------------------------ */
  {
    id: "proj-backsplash",
    slug: "install-peel-and-stick-backsplash",
    title: "Install Peel-and-Stick Backsplash",
    category: "flooring",
    summary:
      "Give your kitchen or bathroom a tiled backsplash look with adhesive tiles — no grout, no mortar, and no tile saw.",
    description:
      "Peel-and-stick backsplash tiles deliver the look of a tiled wall with a fraction of the mess and skill. The adhesive backing sticks to a clean, smooth wall, and the tiles cut with a utility knife or scissors. Success comes down to a spotless surface, a dead-level first row, and careful cutting around outlets. It is an intermediate project mostly because of the layout planning and precise cuts.",
    difficulty: "intermediate",
    safetyLevel: "moderate",
    indoor: true,
    renterFriendly: false,
    requiresPermitOrPro: false,
    activeMinutes: 90,
    totalMinutes: 180,
    costBand: "75_200",
    estimatedCostLowCents: 8000,
    estimatedCostHighCents: 18000,
    recommendedPeople: 2,
    skillPrerequisites: [
      "Able to measure carefully and make straight cuts with a utility knife",
      "Comfortable planning a tile layout and working methodically",
    ],
    tools: [
      { toolId: "tool-utility-knife", optional: false, note: "A sharp blade gives clean tile cuts; change it often." },
      { toolId: "tool-tape-measure", optional: false },
      { toolId: "tool-level", optional: false, note: "A level first row is what keeps the whole wall straight." },
      { toolId: "tool-pencil", optional: false },
      { toolId: "tool-scissors", optional: true, note: "Useful for cutting the thinner, flexible tile sheets." },
      { toolId: "tool-sponge", optional: true },
    ],
    materials: [
      { materialId: "mat-peel-stick-tile", quantity: 1, note: "Measure your wall area and buy 10% extra for cuts and mistakes." },
      { materialId: "mat-rubbing-alcohol", quantity: 1, note: "Degreases the wall so the adhesive bonds properly." },
      { materialId: "mat-cleaner", quantity: 1 },
    ],
    preparation: [
      "Measure the backsplash area and calculate how many tiles you need, plus 10% extra.",
      "Clear the countertop and remove anything mounted on the wall in the work zone.",
      "Turn off power to outlets in the area at the breaker and remove their cover plates.",
      "Clean the wall thoroughly of grease, then wipe it with rubbing alcohol and let it dry.",
      "Plan your layout so cut tiles land in the least visible spots.",
    ],
    safetyEquipment: ["Safety glasses", "Work gloves"],
    commonMistakes: [
      "Sticking tiles to a greasy or damp wall so they peel off later.",
      "Starting the first row off-level, so the misalignment compounds upward.",
      "Cutting outlet openings too large so gaps show around the cover plate.",
    ],
    doNotAttemptIf: [
      "The wall is textured, glossy, or crumbling and the adhesive cannot grip it.",
      "You are not comfortable turning off the correct breaker before working near outlets.",
    ],
    callProfessionalIf: [
      "An outlet needs to be moved, extended, or rewired to sit flush with the new tile depth.",
      "The wall requires repair or skim-coating before tile will adhere.",
    ],
    steps: [
      {
        id: "proj-backsplash-step-1",
        order: 1,
        title: "Clean and degrease the wall",
        instructions:
          "Wash the entire backsplash area with cleaner to cut through cooking grease and grime. Rinse, then wipe the whole surface with rubbing alcohol and let it dry fully. The adhesive will only bond to a spotless, dry, oil-free wall.",
        estimatedMinutes: 15,
        tools: [{ toolId: "tool-sponge" }],
        materials: [
          { materialId: "mat-cleaner", quantity: 1 },
          { materialId: "mat-rubbing-alcohol", quantity: 1 },
        ],
        safetyWarnings: [
          {
            id: "proj-backsplash-warn-1",
            level: "moderate",
            title: "Ventilate and keep alcohol from flame",
            detail:
              "Work with a window open or fan running. Rubbing alcohol is flammable — keep it away from stove burners, pilot lights, and any open flame while cleaning.",
            requiresAcknowledgment: true,
          },
        ],
        whyItMatters:
          "Grease is invisible but everywhere in a kitchen, and it is the number one reason peel-and-stick tiles fail to hold.",
        beginnerTip: "Even walls that look clean carry a grease film near a stove — do not skip the alcohol wipe.",
        commonMistake: "Sticking tiles to a wall that still has an invisible grease layer, so they slide and fall.",
        imageAlt: "A sponge wiping down a kitchen wall to degrease it before tiling.",
      },
      {
        id: "proj-backsplash-step-2",
        order: 2,
        title: "Plan the layout and mark a level line",
        instructions:
          "Dry-lay a row of tiles on the counter to see how they fit and where cuts will fall. Decide your starting point, usually a bottom corner, and use a level to draw a straight horizontal guide line. This line, not the countertop, keeps your tiles running true.",
        estimatedMinutes: 15,
        tools: [{ toolId: "tool-level" }, { toolId: "tool-pencil" }, { toolId: "tool-tape-measure" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Countertops and cabinets are rarely perfectly level, so a level guide line prevents the tiles from drifting crooked as you go up.",
        beginnerTip: "Plan so that any narrow cut tiles land at the ends or behind fixtures rather than dead center.",
        commonMistake: "Trusting the countertop as level and building an increasingly slanted wall on top of it.",
        imageAlt: "A level being used to draw a straight horizontal reference line on a wall above a countertop.",
      },
      {
        id: "proj-backsplash-step-3",
        order: 3,
        title: "Apply the first row of tiles",
        instructions:
          "Peel the backing off the first tile and align its bottom edge with your level line, pressing from the center outward to avoid air bubbles. Set each following tile snug against the last. Take your time — the first row sets the standard for the whole wall.",
        estimatedMinutes: 20,
        tools: [],
        materials: [{ materialId: "mat-peel-stick-tile", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "Every tile above keys off the first row. Getting this row level and tight makes the rest of the job easy.",
        beginnerTip: "Press firmly across the whole tile, especially the edges and corners, to seat the adhesive fully.",
        commonMistake: "Rushing the first row so it starts off-level and throws off everything stacked above.",
        imageAlt: "The first row of peel-and-stick tiles being aligned along a level line on a kitchen wall.",
      },
      {
        id: "proj-backsplash-step-4",
        order: 4,
        title: "Work upward, row by row",
        instructions:
          "Continue applying tiles up and outward, matching the pattern and keeping seams tight. Periodically hold your level against the rows to confirm they are staying straight. Press each tile firmly, working out any bubbles toward the edges.",
        estimatedMinutes: 20,
        tools: [{ toolId: "tool-level" }],
        materials: [{ materialId: "mat-peel-stick-tile", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "Checking level as you rise catches small drifts before they compound into an obvious slant near the top.",
        beginnerTip: "A helper handing you peeled tiles keeps your momentum and lets you focus on placement.",
        commonMistake: "Not rechecking level partway up and discovering the drift only after many rows are stuck down.",
        imageAlt: "Rows of peel-and-stick backsplash tiles being applied upward on a wall in a running pattern.",
      },
      {
        id: "proj-backsplash-step-5",
        order: 5,
        title: "Measure and cut around outlets and edges",
        instructions:
          "For edges and around outlets, measure the space carefully and mark the tile, then cut it with a sharp utility knife against a straightedge. Test-fit before peeling the backing. Around outlets, cut so the plate will cover the edges but the receptacle still fits.",
        estimatedMinutes: 25,
        tools: [{ toolId: "tool-utility-knife" }, { toolId: "tool-scissors" }, { toolId: "tool-tape-measure" }, { toolId: "tool-pencil" }],
        materials: [{ materialId: "mat-peel-stick-tile", quantity: 1 }],
        safetyWarnings: [
          {
            id: "proj-backsplash-warn-2",
            level: "moderate",
            title: "Confirm outlet power is off",
            detail:
              "Before working around any outlet, switch off its circuit at the breaker and verify it is dead. Cut tiles to clear the receptacle so the metal blade never contacts live parts.",
            requiresAcknowledgment: true,
          },
        ],
        whyItMatters:
          "Clean, accurate cuts around outlets and edges are what make the finished wall look professionally installed.",
        beginnerTip: "Measure twice and cut a paper template first for tricky outlet shapes before cutting a real tile.",
        commonMistake: "Cutting the outlet opening oversized so gaps show around the cover plate.",
        imageAlt: "A utility knife cutting a peel-and-stick tile to fit around a kitchen outlet opening.",
      },
      {
        id: "proj-backsplash-step-6",
        order: 6,
        title: "Press, seal edges, and reinstall plates",
        instructions:
          "Go over the whole backsplash pressing firmly to seat every tile, paying special attention to edges and seams. Wipe away any adhesive residue. Once you are done, reinstall the outlet cover plates over the tile edges and restore power at the breaker.",
        estimatedMinutes: 15,
        tools: [{ toolId: "tool-sponge" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "A final firm press ensures long-term adhesion, and reinstalling plates over the tile edges gives a clean, finished border.",
        beginnerTip: "If a cover plate no longer reaches over the thicker tiled wall, a slightly deeper plate or spacer screws fix it.",
        commonMistake: "Restoring power before the cover plates are back on, leaving a live receptacle exposed.",
        imageAlt: "A finished peel-and-stick backsplash with outlet cover plates reinstalled over the tile edges.",
      },
    ],
    troubleshooting: [
      {
        id: "proj-backsplash-ts-1",
        keywords: ["peeling", "falling off", "wont stick", "lifting", "edges curling"],
        stepId: "proj-backsplash-step-3",
        symptom: "Tiles are lifting or peeling off the wall.",
        likelyCauses: [
          "The wall may still have had grease or moisture when tiles were applied.",
          "The wall texture may be too rough or glossy for the adhesive to grip.",
        ],
        safeChecks: [
          "Peel back a lifting corner and feel whether the wall is smooth and clean.",
          "Check whether the failure is worst near the stove where grease collects.",
        ],
        correctiveActions: [
          "Remove the tile, re-clean and degrease the spot, and reapply pressing firmly.",
          "For textured walls, a smooth primer or backer may be needed for adhesion.",
        ],
        stopIf: ["The wall surface itself is crumbling or shedding."],
        callProfessionalIf: ["The wall needs skim-coating or repair before any tile will hold."],
      },
      {
        id: "proj-backsplash-ts-2",
        keywords: ["crooked", "not level", "slanted", "drifting", "uneven rows"],
        stepId: "proj-backsplash-step-2",
        symptom: "The rows of tile are drifting crooked as they go up.",
        likelyCauses: [
          "The first row may have started off-level.",
          "Level was not rechecked as the rows built up.",
        ],
        safeChecks: [
          "Hold a level across several rows to measure the drift.",
          "Compare the tile line to your original guide line.",
        ],
        correctiveActions: [
          "If caught early, gently peel the recent tiles and realign to the level line.",
          "Re-strike a fresh level line and correct the next row before it compounds further.",
        ],
        stopIf: ["Peeling to fix would tear tiles or damage the wall surface."],
        callProfessionalIf: ["The wall is badly out of square and the layout will not resolve cleanly."],
      },
      {
        id: "proj-backsplash-ts-3",
        keywords: ["outlet", "cover wont fit", "plate", "gap around outlet", "receptacle"],
        stepId: "proj-backsplash-step-5",
        symptom: "The outlet cover plate will not sit right over the newly tiled wall.",
        likelyCauses: [
          "The tile added depth, so the receptacle now sits recessed relative to the plate.",
          "The tile cut around the outlet may be uneven, leaving gaps.",
        ],
        safeChecks: [
          "With power off, check how far the receptacle sits below the new tile surface.",
          "Look at the tile edges around the opening for gaps.",
        ],
        correctiveActions: [
          "Use an outlet spacer or longer screws to bring the plate flush over the tile.",
          "Trim the tile edges cleaner so the plate fully covers them.",
        ],
        stopIf: ["The receptacle needs to be moved forward or rewired to fit."],
        callProfessionalIf: ["The outlet must be repositioned, extended, or rewired to sit flush with the tile."],
      },
    ],
    imageAlt: "A kitchen wall covered in a neat peel-and-stick tile backsplash running level above the countertop.",
    featured: false,
  },

  /* ------------------------------------------------------------------ */
  /* 10. Weatherstrip an exterior door                                   */
  /* ------------------------------------------------------------------ */
  {
    id: "proj-weatherstrip-door",
    slug: "weatherstrip-an-exterior-door",
    title: "Weatherstrip an Exterior Door",
    category: "maintenance",
    summary:
      "Seal the drafts around an exterior door with new weatherstripping and a door sweep to cut energy loss and keep the weather out.",
    description:
      "If you feel a draft or see daylight around a closed exterior door, cold air and higher energy bills are sneaking in with it. Weatherstripping the frame and adding a door sweep along the bottom is an inexpensive, high-payoff fix any beginner can do in under an hour. This project shows you how to measure, cut, and apply the seals so the door closes snugly without sticking.",
    difficulty: "beginner",
    safetyLevel: "low",
    indoor: false,
    renterFriendly: true,
    requiresPermitOrPro: false,
    activeMinutes: 35,
    totalMinutes: 50,
    costBand: "under_25",
    estimatedCostLowCents: 1000,
    estimatedCostHighCents: 2500,
    recommendedPeople: 1,
    skillPrerequisites: [
      "Comfortable measuring and making straight cuts",
      "Able to use a screwdriver, and optionally a drill, for the door sweep",
    ],
    tools: [
      { toolId: "tool-tape-measure", optional: false },
      { toolId: "tool-utility-knife", optional: false, note: "For cleanly cutting adhesive weatherstrip to length." },
      { toolId: "tool-scissors", optional: true, note: "Works for softer foam or V-strip material." },
      { toolId: "tool-screwdriver", optional: false, note: "For mounting the door sweep." },
      { toolId: "tool-drill", optional: true, note: "Speeds up pilot holes for the sweep screws." },
      { toolId: "tool-pencil", optional: true },
    ],
    materials: [
      { materialId: "mat-weatherstrip", quantity: 1, note: "Buy enough to run both sides and the top of the frame." },
      { materialId: "mat-door-sweep", quantity: 1, note: "Sized to the door width; you can trim it slightly to fit." },
      { materialId: "mat-cleaner", quantity: 1 },
      { materialId: "mat-rubbing-alcohol", quantity: 1, note: "Cleans the frame so adhesive strip sticks well." },
    ],
    preparation: [
      "Close the door and note where you feel drafts or see daylight around it.",
      "Measure the two sides and top of the door frame, and the door width for the sweep.",
      "Clean the frame surfaces where adhesive strip will go and wipe with alcohol.",
      "Check that the door currently closes and latches properly before adding seals.",
    ],
    safetyEquipment: ["Safety glasses", "Work gloves"],
    commonMistakes: [
      "Applying weatherstrip too thick so the door will not close or latch.",
      "Sticking adhesive strip to a dusty frame so it peels off in days.",
      "Cutting the door sweep too short and leaving a gap at one corner.",
    ],
    doNotAttemptIf: [
      "The door itself is warped or rotted and no seal will close the gaps.",
      "The frame is so out of square that the door does not latch even now.",
    ],
    callProfessionalIf: [
      "The door or frame is rotted, warped, or misaligned enough to need rehanging or replacement.",
      "Gaps remain large after weatherstripping, pointing to a structural door problem.",
    ],
    steps: [
      {
        id: "proj-weatherstrip-door-step-1",
        order: 1,
        title: "Find the drafts and measure",
        instructions:
          "Close the door and run your hand around the edges to feel for drafts, or look for daylight showing through. Measure the length of each side and the top of the frame where weatherstrip will go, and measure the door's width for the sweep. Write the numbers down.",
        estimatedMinutes: 8,
        tools: [{ toolId: "tool-tape-measure" }, { toolId: "tool-pencil" }],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "Knowing exactly where the air leaks tells you where to focus, and accurate measurements mean you cut the strip and sweep to fit the first time.",
        beginnerTip: "On a bright day, turn off the lights inside and look for daylight around the closed door to spot every gap.",
        commonMistake: "Guessing at lengths and coming up short on the strip for the last side.",
        imageAlt: "A hand feeling along the edge of a closed exterior door to locate a draft.",
      },
      {
        id: "proj-weatherstrip-door-step-2",
        order: 2,
        title: "Clean the frame surfaces",
        instructions:
          "Wipe the frame surfaces where the adhesive weatherstrip will stick with cleaner, then rubbing alcohol, and let them dry. Dust, dirt, and old adhesive keep new strip from bonding. The cleaner and drier the surface, the longer the seal lasts.",
        estimatedMinutes: 6,
        tools: [],
        materials: [
          { materialId: "mat-cleaner", quantity: 1 },
          { materialId: "mat-rubbing-alcohol", quantity: 1 },
        ],
        safetyWarnings: [],
        whyItMatters:
          "Adhesive weatherstrip is only as good as the surface it sticks to. A clean, dry frame is what keeps it from peeling.",
        beginnerTip: "Give the alcohol a minute to fully evaporate before applying any adhesive strip.",
        commonMistake: "Applying strip to a dusty or damp frame so it lets go within days.",
        imageAlt: "A cloth wiping down the surface of a door frame to prepare it for adhesive weatherstripping.",
      },
      {
        id: "proj-weatherstrip-door-step-3",
        order: 3,
        title: "Cut and apply the weatherstripping",
        instructions:
          "Cut the weatherstrip to length for each side and the top using a utility knife or scissors. Peel the adhesive backing and press the strip firmly into place against the frame where the door meets it. Work one section at a time so the strip lines up straight.",
        estimatedMinutes: 12,
        tools: [{ toolId: "tool-utility-knife" }, { toolId: "tool-scissors" }],
        materials: [{ materialId: "mat-weatherstrip", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "Placing the strip where the door presses against the frame is what creates the airtight seal when the door closes.",
        beginnerTip: "Position the strip so the door compresses it slightly when closed, but not so much that it cannot latch.",
        commonMistake: "Applying strip so thick or so far in that the door no longer closes and latches.",
        imageAlt: "Adhesive weatherstripping being pressed into place along the inside edge of a door frame.",
      },
      {
        id: "proj-weatherstrip-door-step-4",
        order: 4,
        title: "Test the door closing",
        instructions:
          "Close the door and confirm it still latches smoothly and seals against the new strip. It should meet a bit of resistance from the seal but close and latch without slamming or forcing. If it will not latch, the strip may be too thick and needs a thinner profile.",
        estimatedMinutes: 5,
        tools: [],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "A door that seals but will not latch is worse than a small draft. Testing now confirms you got the balance right.",
        beginnerTip: "Slide a dollar bill between the door and the strip and pull — light drag means a good seal.",
        commonMistake: "Not testing until all sides are done and finding the whole door will not close.",
        imageAlt: "An exterior door being closed to test that it latches against the new weatherstripping.",
      },
      {
        id: "proj-weatherstrip-door-step-5",
        order: 5,
        title: "Install the door sweep",
        instructions:
          "Measure and cut the door sweep to the door width if needed. Hold it against the bottom of the door so it just touches the threshold, mark the screw holes, and fasten it with the screwdriver. It should brush the threshold and block the gap without dragging so hard the door is hard to open.",
        estimatedMinutes: 12,
        tools: [{ toolId: "tool-screwdriver" }, { toolId: "tool-drill" }, { toolId: "tool-tape-measure" }],
        materials: [{ materialId: "mat-door-sweep", quantity: 1 }],
        safetyWarnings: [],
        whyItMatters:
          "The gap under the door is often the biggest draft source, and a well-set sweep seals it while still letting the door swing freely.",
        beginnerTip: "Most sweeps have slotted holes so you can slide them up or down to fine-tune the height before final tightening.",
        commonMistake: "Setting the sweep so low it scrapes the floor and makes the door hard to open, or so high it seals nothing.",
        imageAlt: "A door sweep being screwed onto the bottom of an exterior door so it meets the threshold.",
      },
      {
        id: "proj-weatherstrip-door-step-6",
        order: 6,
        title: "Final draft check",
        instructions:
          "Close the door fully and check all around again for remaining drafts or daylight. Feel along the seams and under the sweep. If you still detect a leak, adjust the strip position or sweep height until the door seals evenly all the way around.",
        estimatedMinutes: 5,
        tools: [],
        materials: [],
        safetyWarnings: [],
        whyItMatters:
          "A final walkaround confirms the whole perimeter is sealed, which is where the real energy savings come from.",
        beginnerTip: "Hold a lit candle or an incense stick near the seams on a windy day — a wavering flame reveals leftover leaks.",
        commonMistake: "Stopping after the sweep is on without rechecking the top and hinge side for remaining gaps.",
        imageAlt: "An exterior door closed and sealed with new weatherstripping and a door sweep along the bottom.",
      },
    ],
    troubleshooting: [
      {
        id: "proj-weatherstrip-door-ts-1",
        keywords: ["wont close", "wont latch", "too thick", "sticks", "hard to close"],
        stepId: "proj-weatherstrip-door-step-4",
        symptom: "The door will not close or latch after adding weatherstrip.",
        likelyCauses: [
          "The weatherstrip profile may be too thick for the gap.",
          "The strip may be placed where it over-compresses against the door.",
        ],
        safeChecks: [
          "Close the door slowly to feel where it binds.",
          "Look at how far the strip compresses at the tight spot.",
        ],
        correctiveActions: [
          "Switch to a thinner weatherstrip profile in the tight areas.",
          "Reposition the strip slightly so the door compresses it less.",
        ],
        stopIf: ["Forcing the door risks damaging the latch or frame."],
        callProfessionalIf: ["Even thin stripping prevents latching, suggesting the door or frame is out of alignment."],
      },
      {
        id: "proj-weatherstrip-door-ts-2",
        keywords: ["peeling", "fell off", "wont stick", "adhesive failing"],
        stepId: "proj-weatherstrip-door-step-3",
        symptom: "The adhesive weatherstrip is peeling away from the frame.",
        likelyCauses: [
          "The frame may not have been fully clean and dry when applied.",
          "Cold temperatures may have prevented the adhesive from bonding.",
        ],
        safeChecks: [
          "Feel the frame surface for dust or residue where the strip lifted.",
          "Consider whether it was applied in cold or damp conditions.",
        ],
        correctiveActions: [
          "Remove the strip, re-clean with alcohol, and reapply on a dry, mild day.",
          "For exterior use, choose weatherstrip rated for outdoor temperatures.",
        ],
        stopIf: ["The frame surface is deteriorating and will not hold adhesive."],
        callProfessionalIf: ["The frame is rotted or damaged enough that no seal will adhere."],
      },
      {
        id: "proj-weatherstrip-door-ts-3",
        keywords: ["still drafty", "gap remains", "daylight", "cold air", "under door"],
        stepId: "proj-weatherstrip-door-step-6",
        symptom: "You still feel a draft after weatherstripping and adding the sweep.",
        likelyCauses: [
          "The sweep height may be set too high to close the bottom gap.",
          "A corner or the threshold may have an uneven gap the seal does not reach.",
        ],
        safeChecks: [
          "Look for daylight at the specific spot the draft is coming from.",
          "Check whether the sweep actually contacts the threshold along its whole length.",
        ],
        correctiveActions: [
          "Lower the sweep slightly so it brushes the threshold fully.",
          "Add a threshold seal or corner pad where a persistent gap remains.",
        ],
        stopIf: ["The gap is so large that no standard seal closes it."],
        callProfessionalIf: ["Large persistent gaps indicate the door is warped or the frame needs rework."],
      },
    ],
    imageAlt: "An exterior door fully sealed with fresh weatherstripping around the frame and a door sweep along the bottom.",
    featured: false,
  },
];

export const PROJECT_BY_SLUG = Object.fromEntries(PROJECTS.map((p) => [p.slug, p])) as Record<string, Project>;
export const PROJECT_BY_ID = Object.fromEntries(PROJECTS.map((p) => [p.id, p])) as Record<string, Project>;
