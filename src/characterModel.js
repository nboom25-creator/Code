// ===========================================================
// Procedural stylized low-poly humanoid builder.
// Returns a THREE.Group with references for walk/attack animation.
// Style: exaggerated proportions + flat shading, à la WoW.
// ===========================================================
import * as THREE from "three";

function mat(color, flat = true) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.85, metalness: 0.05, flatShading: flat,
  });
}

// Build a humanoid from a race def + class color (armor accent).
export function buildCharacter(race, classColor = 0x8899aa) {
  const g = new THREE.Group();
  const skin = mat(race.color);
  const hairMat = mat(race.hair);
  const armor = mat(classColor);
  const armorDark = mat(new THREE.Color(classColor).multiplyScalar(0.6).getHex());
  const cloth = mat(new THREE.Color(classColor).multiplyScalar(0.45).getHex());

  const s = race.build;        // width scale
  const h = race.height;       // height scale

  // ---- Torso ----
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7 * s, 0.85 * h, 0.42 * s), armor);
  torso.position.y = 1.15 * h;
  torso.castShadow = true;
  g.add(torso);

  // belt / pelvis
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.66 * s, 0.3 * h, 0.4 * s), cloth);
  pelvis.position.y = 0.72 * h;
  pelvis.castShadow = true;
  g.add(pelvis);

  // shoulder pads (armor flair)
  for (const sx of [-1, 1]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.28 * s, 0.22 * h, 0.42 * s), armorDark);
    pad.position.set(sx * 0.46 * s, 1.5 * h, 0);
    pad.castShadow = true;
    g.add(pad);
  }

  // ---- Head ----
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.46 * s, 0.46 * h, 0.44 * s), skin);
  head.position.y = 1.85 * h;
  head.castShadow = true;
  g.add(head);

  // hair cap
  const hairCap = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.22 * h, 0.48 * s), hairMat);
  hairCap.position.y = 2.02 * h;
  g.add(hairCap);

  // eyes (glowing)
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x9ff0ff, emissive: 0x4fd0ff, emissiveIntensity: 1.2 });
  for (const ex of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08 * s, 0.06 * h, 0.04), eyeMat);
    eye.position.set(ex * 0.11 * s, 1.87 * h, 0.23 * s);
    g.add(eye);
  }

  // ears
  if (race.ears === "long") {
    for (const ex of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.07 * s, 0.1 * h, 0.05), skin);
      ear.position.set(ex * 0.27 * s, 1.92 * h, 0);
      ear.rotation.z = ex * -0.5;
      g.add(ear);
    }
  }

  // ---- Arms (pivot at shoulder) ----
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.5 * s, 1.5 * h, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.2 * s, 0.5 * h, 0.22 * s), armor);
    upper.position.y = -0.25 * h; upper.castShadow = true;
    pivot.add(upper);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.18 * s, 0.45 * h, 0.2 * s), skin);
    fore.position.y = -0.7 * h; fore.castShadow = true;
    pivot.add(fore);
    g.add(pivot);
    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // ---- Legs (pivot at hip) ----
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.2 * s, 0.6 * h, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.24 * s, 0.5 * h, 0.26 * s), cloth);
    thigh.position.y = -0.25 * h; thigh.castShadow = true;
    pivot.add(thigh);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.22 * s, 0.5 * h, 0.24 * s), armorDark);
    shin.position.y = -0.7 * h; shin.castShadow = true;
    pivot.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.24 * s, 0.14 * h, 0.36 * s), armorDark);
    foot.position.set(0, -0.95 * h, 0.06); foot.castShadow = true;
    pivot.add(foot);
    g.add(pivot);
    return pivot;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // ---- Weapon in right hand ----
  const weapon = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9 * h, 6), mat(0x3a2a18));
  weapon.add(handle);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12 * s, 0.7 * h, 0.04), mat(0xcfd6dd));
  blade.position.y = 0.7 * h;
  weapon.add(blade);
  weapon.position.set(0, -0.95 * h, 0.1);
  armR.add(weapon);

  // store animation refs
  g.userData.parts = { armL, armR, legL, legR, head, torso, weapon };
  g.userData.race = race;

  return g;
}

// Simple skeletal animation driven by a phase value.
export function animateCharacter(model, { moving, speed = 1, t, attackT = 0 }) {
  const p = model.userData.parts;
  if (!p) return;
  if (moving) {
    const sw = Math.sin(t * 9 * speed) * 0.7;
    p.legL.rotation.x = sw;
    p.legR.rotation.x = -sw;
    p.armL.rotation.x = -sw * 0.8;
    p.armR.rotation.x = sw * 0.8;
    model.position.y = Math.abs(Math.sin(t * 9 * speed)) * 0.06;
  } else {
    // idle breathing
    const br = Math.sin(t * 2) * 0.04;
    p.armL.rotation.x = THREE.MathUtils.lerp(p.armL.rotation.x, br, 0.1);
    p.armR.rotation.x = THREE.MathUtils.lerp(p.armR.rotation.x, -br, 0.1);
    p.legL.rotation.x = THREE.MathUtils.lerp(p.legL.rotation.x, 0, 0.2);
    p.legR.rotation.x = THREE.MathUtils.lerp(p.legR.rotation.x, 0, 0.2);
    model.position.y = THREE.MathUtils.lerp(model.position.y, 0, 0.1);
  }
  // attack swing overrides right arm
  if (attackT > 0) {
    const a = Math.sin(attackT * Math.PI); // 0->1->0
    p.armR.rotation.x = -2.2 * a;
    p.armR.rotation.z = 0.4 * a;
  } else {
    p.armR.rotation.z = THREE.MathUtils.lerp(p.armR.rotation.z, 0, 0.2);
  }
}
