// ===========================================================
// Realms of Azora — main entry.
// Character creation, game loop, camera, input, combat.
// ===========================================================
import * as THREE from "three";
import { FACTIONS, RACES, CLASSES, ABILITIES, CLASS_KIT, SCHOOL_COLOR, getRace } from "./data.js";
import { buildCharacter } from "./characterModel.js";
import { World } from "./world.js";
import { Player } from "./player.js";
import { EnemyManager } from "./enemies.js";
import { UI } from "./ui.js";

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// Boot: fake-load then go to character creation.
// ---------------------------------------------------------------------------
function boot() {
  const fill = document.querySelector(".loading-fill");
  let pct = 0;
  const iv = setInterval(() => {
    pct = Math.min(100, pct + 6 + Math.random() * 12);
    fill.style.width = pct + "%";
    if (pct >= 100) {
      clearInterval(iv);
      setTimeout(() => {
        $("loading-screen").classList.add("hidden");
        $("char-create").classList.remove("hidden");
        initCharCreate();
      }, 350);
    }
  }, 130);
}

// ---------------------------------------------------------------------------
// Character creation
// ---------------------------------------------------------------------------
const sel = { faction: "alliance", raceId: null, classId: null };
let pvScene, pvCamera, pvRenderer, pvModel, pvRot = 0;

function initPreview() {
  const wrap = $("preview-canvas-wrap");
  pvScene = new THREE.Scene();
  pvCamera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.1, 100);
  pvCamera.position.set(0, 2.2, 6.5);
  pvCamera.lookAt(0, 1.6, 0);
  pvRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  pvRenderer.setSize(wrap.clientWidth, wrap.clientHeight);
  pvRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  pvRenderer.shadowMap.enabled = true;
  wrap.appendChild(pvRenderer.domElement);

  pvScene.add(new THREE.HemisphereLight(0xbcd6ff, 0x404040, 1.0));
  const key = new THREE.DirectionalLight(0xfff0d0, 1.6);
  key.position.set(3, 6, 5); key.castShadow = true; pvScene.add(key);
  const rim = new THREE.DirectionalLight(0x6aa0ff, 0.8);
  rim.position.set(-4, 3, -4); pvScene.add(rim);

  // pedestal
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.3, 0.4, 24),
    new THREE.MeshStandardMaterial({ color: 0x3a3450, roughness: 0.7 }));
  ped.position.y = -0.2; ped.receiveShadow = true; pvScene.add(ped);

  function loop() {
    requestAnimationFrame(loop);
    if (pvModel) { pvRot += 0.008; pvModel.rotation.y = pvRot; }
    pvRenderer.render(pvScene, pvCamera);
  }
  loop();

  new ResizeObserver(() => {
    pvCamera.aspect = wrap.clientWidth / wrap.clientHeight;
    pvCamera.updateProjectionMatrix();
    pvRenderer.setSize(wrap.clientWidth, wrap.clientHeight);
  }).observe(wrap);
}

function setPreviewModel(race, classId) {
  if (pvModel) pvScene.remove(pvModel);
  const color = classId ? CLASSES[classId].color : 0x8899aa;
  pvModel = buildCharacter(race, color);
  pvModel.position.y = 0;
  pvScene.add(pvModel);
}

function renderRaceList() {
  const list = $("race-list");
  list.innerHTML = "";
  const races = RACES.filter(r => r.faction === sel.faction);
  races.forEach(r => {
    const card = document.createElement("div");
    card.className = "race-card" + (r.id === sel.raceId ? " selected" : "");
    const fc = FACTIONS[r.faction].color;
    card.innerHTML = `
      <div class="race-emblem" style="background:#${new THREE.Color(r.color).getHexString()}">${r.emblem}</div>
      <div><h4>${r.name}</h4><small>${r.blurb}</small></div>`;
    card.onclick = () => selectRace(r.id);
    list.appendChild(card);
  });
  // default selection
  if (!races.find(r => r.id === sel.raceId)) selectRace(races[0].id);
}

function selectRace(id) {
  sel.raceId = id;
  const race = getRace(id);
  sel.classId = race.classes[0];
  renderRaceList();
  renderRaceInfo(race);
  renderClassList(race);
  setPreviewModel(race, sel.classId);
}

function renderRaceInfo(race) {
  $("race-info").innerHTML = `
    <h2>${race.name}</h2>
    <div class="lore">${race.lore}</div>
    <div class="racial-traits">
      ${race.traits.map(t => `<span class="trait-pill">${t}</span>`).join("")}
    </div>`;
}

function renderClassList(race) {
  const list = $("class-list");
  list.innerHTML = "";
  race.classes.forEach(cid => {
    const c = CLASSES[cid];
    const card = document.createElement("div");
    card.className = "class-card" + (cid === sel.classId ? " selected" : "");
    card.innerHTML = `<div class="cicon">${c.icon}</div><div class="cname">${c.name}</div>`;
    card.onclick = () => {
      sel.classId = cid;
      renderClassList(race);
      setPreviewModel(race, cid);
    };
    card.title = c.desc;
    list.appendChild(card);
  });
}

function initCharCreate() {
  initPreview();
  document.querySelectorAll(".faction-tab").forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll(".faction-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      sel.faction = tab.dataset.faction;
      sel.raceId = null;
      renderRaceList();
    };
  });
  renderRaceList();

  $("enter-world").onclick = () => {
    const name = $("char-name").value.trim() || getRace(sel.raceId).name;
    startGame(sel.raceId, sel.classId, name);
  };
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const G = {
  scene: null, camera: null, renderer: null, world: null, player: null,
  enemies: null, ui: null, clock: null, target: null, projectiles: [],
  running: false, camYaw: 0, camPitch: 0.5, camDist: 9,
  input: { keys: {}, cameraYaw: 0, jump: false, mouseDown: false },
  audio: null,
};

function startGame(raceId, classId, name) {
  $("char-create").classList.add("hidden");
  $("game-ui").classList.remove("hidden");

  const scene = new THREE.Scene();
  G.scene = scene;
  G.renderer = new THREE.WebGLRenderer({ antialias: true });
  G.renderer.setSize(innerWidth, innerHeight);
  G.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  G.renderer.shadowMap.enabled = true;
  G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(G.renderer.domElement);
  G.renderer.domElement.id = "game-canvas";

  G.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 600);

  G.world = new World(scene);
  G.player = new Player(scene, getRace(raceId), classId, name);
  G.enemies = new EnemyManager(scene, G.world);
  G.enemies.populate();
  G.ui = new UI();
  G.ui.bind(G.player, G.camera);
  G.ui.log("Welcome to Northshire Vale, " + name + ".", "log-crit");
  G.ui.log("Speak with the locals… or just go slay something.", "log-info");

  G.clock = new THREE.Clock();
  G.running = true;
  setupInput();
  initAudio();
  animate();

  // hide controls tip after a while
  setTimeout(() => $("controls-tip")?.classList.add("hidden"), 14000);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function setupInput() {
  const keys = G.input.keys;
  addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === " ") { G.input.jump = true; e.preventDefault(); }
    if (k === "tab") { e.preventDefault(); cycleTarget(); }
    if (k === "escape") toggleEscMenu();
    if (["1","2","3","4","5","6"].includes(k)) useAbility(parseInt(k) - 1);
    if (k === "shift") keys.shift = true;
  });
  addEventListener("keyup", e => {
    const k = e.key.toLowerCase();
    keys[k] = false;
    if (k === "shift") keys.shift = false;
  });

  const cvs = G.renderer.domElement;
  cvs.addEventListener("mousedown", e => {
    if (e.button === 2 || e.button === 0) { G.input.mouseDown = true; G._lastBtn = e.button; }
    if (e.button === 0) clickSelect(e);
  });
  addEventListener("mouseup", () => G.input.mouseDown = false);
  addEventListener("mousemove", e => {
    if (G.input.mouseDown) {
      G.camYaw -= e.movementX * 0.004;
      G.camPitch = THREE.MathUtils.clamp(G.camPitch + e.movementY * 0.004, 0.1, 1.3);
    }
  });
  cvs.addEventListener("contextmenu", e => e.preventDefault());
  cvs.addEventListener("wheel", e => {
    G.camDist = THREE.MathUtils.clamp(G.camDist + Math.sign(e.deltaY) * 0.8, 4, 18);
  });

  addEventListener("resize", () => {
    G.camera.aspect = innerWidth / innerHeight;
    G.camera.updateProjectionMatrix();
    G.renderer.setSize(innerWidth, innerHeight);
  });

  // action bar clicks
  $("action-bar").querySelectorAll(".action-slot").forEach(s => {
    s.onclick = () => useAbility(parseInt(s.dataset.index));
  });

  $("respawn-btn").onclick = () => {
    G.player.respawn();
    $("death-screen").classList.add("hidden");
    G.ui.log("You return to life at the spirit healer.", "log-info");
  };
  $("resume-btn").onclick = toggleEscMenu;
  $("back-to-select").onclick = () => location.reload();
  $("music-toggle").onchange = e => { if (G.audio) G.audio.setEnabled(e.target.checked); };
}

function toggleEscMenu() {
  const m = $("esc-menu");
  m.classList.toggle("hidden");
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
function clickSelect(e) {
  const ndc = new THREE.Vector2((e.clientX/innerWidth)*2-1, -(e.clientY/innerHeight)*2+1);
  raycaster.setFromCamera(ndc, G.camera);
  const meshes = [];
  G.enemies.enemies.forEach(en => { if (!en.dead) en.model.traverse(o => o.isMesh && meshes.push(o)); });
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length && hits[0].object.userData.enemy) {
    setTarget(hits[0].object.userData.enemy);
  }
}

function cycleTarget() {
  const alive = G.enemies.enemies.filter(e => !e.dead);
  if (!alive.length) return;
  alive.sort((a,b) => a.model.position.distanceTo(G.player.position) - b.model.position.distanceTo(G.player.position));
  // cycle to next nearest after current
  let idx = alive.indexOf(G.target);
  const next = alive[(idx + 1) % alive.length];
  setTarget(next);
}

function setTarget(enemy) {
  if (G.target && G.target !== enemy) G.target.setSelected(false);
  G.target = enemy;
  if (enemy) enemy.setSelected(true);
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------
function useAbility(index) {
  const p = G.player;
  if (p.dead || !G.running) return;
  const kit = CLASS_KIT[p.cls.id];
  const abId = kit[index];
  if (!abId) return;
  const ab = ABILITIES[abId];

  if (p.casting) return;                       // already casting
  if (ab.cd && p.gcd > 0) return;              // global cooldown
  if ((p.cooldowns[abId] || 0) > 0) return;    // on cooldown
  if (p.resource < (ab.cost || 0)) { G.ui.log("Not enough " + p.resourceType + ".", "log-info"); return; }

  // target requirements
  const needsTarget = ["melee","ranged","aoe","ranged_aoe","dash"].includes(ab.type);
  if (needsTarget && (!G.target || G.target.dead)) {
    // auto-acquire nearest in front
    cycleTarget();
    if (!G.target || G.target.dead) { G.ui.log("You have no target.", "log-info"); return; }
  }

  if (needsTarget) {
    const d = G.player.position.distanceTo(G.target.model.position);
    if (d > ab.range + 1.5) { G.ui.log(ab.name + ": target is too far away.", "log-info"); return; }
    if (ab.type === "melee" || ab.type === "aoe") {
      if (d > ab.range + 0.6) { G.ui.log("You are too far away.", "log-info"); return; }
    }
    // face target
    p.yaw = Math.atan2(G.target.model.position.x - p.position.x, G.target.model.position.z - p.position.z);
  }

  // casting (has cast time)
  if (ab.cast) {
    p.casting = { ability: ab, abId, total: ab.cast, elapsed: 0, target: G.target };
    return;
  }
  finishAbility(ab, abId, G.target);
}

function finishAbility(ab, abId, target) {
  const p = G.player;
  if (!p.spendResource(ab.cost || 0)) return;
  if (ab.cd) { p.gcd = 1.0; p.cooldowns[abId] = ab.cd; }
  else if (ab.type === "heal") p.gcd = 1.0;

  const schoolColor = SCHOOL_COLOR[ab.school] || 0xffffff;

  switch (ab.type) {
    case "heal": {
      const amt = rollDamage(ab);
      p.heal(amt.value, G.ui);
      G.ui.log(`Your ${ab.name} heals you for ${amt.value}.`, "log-heal");
      castFx(p.model.position, 0x6fff8a);
      break;
    }
    case "melee": {
      p.triggerSwing();
      if (target && !target.dead) dealDamage(target, ab, false);
      break;
    }
    case "aoe": {
      p.triggerSwing();
      castFx(p.position, schoolColor, 5);
      G.enemies.enemies.forEach(e => {
        if (!e.dead && p.position.distanceTo(e.model.position) <= ab.range) dealDamage(e, ab, true);
      });
      break;
    }
    case "dash": {
      // charge to target
      if (target) {
        const dir = new THREE.Vector3().subVectors(target.model.position, p.position);
        const d = dir.length();
        dir.normalize();
        const dest = target.model.position.clone().addScaledVector(dir, -2);
        const [nx, nz] = G.world.resolveCollision(dest.x, dest.z, 0.6);
        p.position.x = nx; p.position.z = nz;
        target.applySlow(1.5);
        dealDamage(target, ab, false);
        p.triggerSwing();
      }
      break;
    }
    case "ranged":
    case "ranged_aoe": {
      p.triggerSwing();
      spawnProjectile(p, target, ab, schoolColor);
      if (ab.type === "ranged_aoe") {
        // hit a couple extra nearby
        const extras = G.enemies.enemies.filter(e => !e.dead && e !== target &&
          target && e.model.position.distanceTo(target.model.position) < 8).slice(0, 2);
        extras.forEach(e => spawnProjectile(p, e, ab, schoolColor));
      }
      break;
    }
  }
}

function rollDamage(ab) {
  const p = G.player;
  let base = ab.min + Math.random() * (ab.max - ab.min);
  base += p.attackPower * 0.4;
  base *= 1 + (p.level - 1) * 0.05;
  // crit
  let critChance = 0.12 + (p.race.id === "wildkin" ? 0.05 : 0);
  const crit = Math.random() < critChance;
  if (crit) base *= 2;
  return { value: Math.round(base), crit };
}

function dealDamage(enemy, ab, isAoe) {
  const dmg = rollDamage(ab);
  enemy.takeDamage(dmg.value);
  if (ab.slow) enemy.applySlow(2.5);
  G.ui.floatText(dmg, "deal", enemy.model.position);
  const word = dmg.crit ? "crit " : "";
  G.ui.log(`Your ${ab.name} ${word}hits ${enemy.type.name} for ${dmg.value}.`, dmg.crit ? "log-crit" : "log-dmg");
  if (G.player.resourceType === "rage") G.player.addResource(8);
  if (enemy.dead) onEnemyKilled(enemy);
}

function onEnemyKilled(enemy) {
  G.ui.log(`You have slain ${enemy.type.name}.`, "log-info");
  G.player.gainXP(enemy.xp, G.ui);
  G.ui.questProgress(enemy.type.elite);
  if (G.target === enemy) { /* keep frame until it fades */ }
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------
function spawnProjectile(from, target, ab, color) {
  if (!target) return;
  const geo = new THREE.SphereGeometry(0.28, 10, 10);
  const matl = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 });
  const mesh = new THREE.Mesh(geo, matl);
  const start = from.position.clone(); start.y += 1.4;
  mesh.position.copy(start);
  const light = new THREE.PointLight(color, 2, 6);
  mesh.add(light);
  G.scene.add(mesh);
  G.projectiles.push({ mesh, target, ab, speed: 34, life: 3 });
}

function updateProjectiles(dt) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const pr = G.projectiles[i];
    pr.life -= dt;
    const valid = pr.target && !pr.target.dead;
    const dest = valid ? pr.target.model.position.clone().setY(pr.target.model.position.y + 1.2)
                       : pr.mesh.position.clone().add(new THREE.Vector3(0,0,-1));
    const dir = new THREE.Vector3().subVectors(dest, pr.mesh.position);
    const d = dir.length();
    if (valid && d < 1.0) {
      dealDamage(pr.target, pr.ab, pr.ab.type === "ranged_aoe");
      hitFx(pr.mesh.position, pr.mesh.material.color.getHex());
      cleanupProjectile(pr, i); continue;
    }
    if (pr.life <= 0) { cleanupProjectile(pr, i); continue; }
    dir.normalize();
    pr.mesh.position.addScaledVector(dir, pr.speed * dt);
  }
}
function cleanupProjectile(pr, i) { G.scene.remove(pr.mesh); pr.mesh.geometry.dispose(); G.projectiles.splice(i, 1); }

// ---------------------------------------------------------------------------
// FX
// ---------------------------------------------------------------------------
function castFx(pos, color, radius = 1.5) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.2, radius, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(pos); ring.position.y += 0.1;
  G.scene.add(ring);
  let s = 0;
  const grow = () => {
    s += 0.08; ring.scale.setScalar(1 + s); ring.material.opacity = 0.8 * (1 - s);
    if (s < 1) requestAnimationFrame(grow); else { G.scene.remove(ring); ring.geometry.dispose(); }
  };
  grow();
}
function hitFx(pos, color) {
  const flash = new THREE.PointLight(color, 4, 8);
  flash.position.copy(pos); G.scene.add(flash);
  setTimeout(() => G.scene.remove(flash), 120);
  castFx(pos, color, 1.2);
}

// ---------------------------------------------------------------------------
// Camera (third-person orbit follow)
// ---------------------------------------------------------------------------
function updateCamera(dt) {
  const p = G.player;
  const targetPos = p.position.clone(); targetPos.y += 1.6;
  const offset = new THREE.Vector3(
    Math.sin(G.camYaw) * Math.cos(G.camPitch),
    Math.sin(G.camPitch),
    Math.cos(G.camYaw) * Math.cos(G.camPitch)
  ).multiplyScalar(G.camDist);
  const desired = targetPos.clone().add(offset);
  G.camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
  G.camera.lookAt(targetPos);
  G.input.cameraYaw = G.camYaw;
}

// ---------------------------------------------------------------------------
// Audio (tiny procedural ambient pad)
// ---------------------------------------------------------------------------
function initAudio() {
  let ctx, gain, on = true, started = false;
  function start() {
    if (started || !on) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      gain = ctx.createGain(); gain.gain.value = 0.05; gain.connect(ctx.destination);
      const notes = [110, 164.81, 220, 277.18];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.value = 0.0;
        o.connect(g); g.connect(gain); o.start();
        // slow swell
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.02;
        const lg = ctx.createGain(); lg.gain.value = 0.5;
        lfo.connect(lg); lg.connect(g.gain); lfo.start();
        g.gain.value = 0.5;
      });
      started = true;
    } catch (e) { /* audio not available */ }
  }
  // start on first interaction (autoplay policy)
  addEventListener("pointerdown", start, { once: true });
  addEventListener("keydown", start, { once: true });
  G.audio = { setEnabled(v) { on = v; if (gain) gain.gain.value = v ? 0.05 : 0; if (v) start(); } };
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);
  if (!G.running) return;
  const dt = Math.min(G.clock.getDelta(), 0.05);
  const t = G.clock.elapsedTime;

  // casting progress
  const p = G.player;
  if (p.casting) {
    p.casting.elapsed += dt;
    if (p.casting.elapsed >= p.casting.total) {
      const c = p.casting; p.casting = null;
      // re-validate target/range
      const tgt = c.target;
      if (c.ability.type === "heal" || (tgt && !tgt.dead)) finishAbility(c.ability, c.abId, tgt);
    }
  }

  p.update(dt, G.input, G.world, G.camera);
  G.enemies.update(dt, p, t);
  G.world.update(t);
  updateProjectiles(dt);
  updateCamera(dt);

  // target validity
  if (G.target && G.target.dead && G.target.deathT > 2.5) setTarget(null);

  // death handling
  if (p.dead && $("death-screen").classList.contains("hidden")) {
    $("death-screen").classList.remove("hidden");
  }

  // UI
  G.ui.updatePlayerFrame();
  G.ui.updateTargetFrame(G.target);
  G.ui.updateCastBar();
  G.ui.refreshActionBar();
  G.ui.updateMinimap(p, G.enemies.enemies);

  G.renderer.render(G.scene, G.camera);
}

boot();
