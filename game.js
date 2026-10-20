// ============================================================
// JANTAR MANTAR: CHAOS PROTOCOL — CLIENT
// ============================================================

const SERVER_URL = "wss://your-render-app.onrender.com"; // <-- CHANGE THIS

// ---------- CONFIG ----------
const MAP_W = 1200, MAP_H = 900;
const CAPTURE_RADIUS = 140;
const NPC_RECRUIT_RADIUS = 50;
const NARA_COOLDOWN_MS = 4000;
const PUSH_COOLDOWN_MS = 1500;
const SHIELD_COOLDOWN_MS = 3000;
const LATHI_COOLDOWN_MS = 900;

const NARAS = [
  "Vasteguna Huiya!",
  "System is Cooked!",
  "Kuchupuchu, resign kar do!",
  "My ex & this govt are both heartless",
  "We are not cockroaches 🪳",
  "Subway Surfers: Delhi Edition"
];

// ---------- GLOBAL STATE ----------
let room = null;
let mySide = null;
let sceneReady = false;

// ---------- PHASER SCENE ----------
class MainScene extends Phaser.Scene {
  constructor() { super("MainScene"); }

  preload() {
    // No external assets — all graphics are generated at runtime.
  }

  create() {
    this.cameras.main.setBounds(0, 0, MAP_W, MAP_H);
    this.physics.world.setBounds(0, 0, MAP_W, MAP_H);

    this.drawGround();
    this.drawCaptureZone();
    this.drawBarricades();

    // Local player
    this.player = this.add.circle(400, 500, 14, mySide === "protestor" ? 0xff6600 : 0x3366ff);
    this.physics.add.existing(this.player);
    this.player.body.setCircle(14);
    this.player.setStrokeStyle(3, 0xffffff);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys("W,A,S,D");
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyE = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyF = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);

    // Cooldown timestamps
    this.lastNara = 0;
    this.lastPush = 0;
    this.lastShield = 0;
    this.lastLathi = 0;
    this.shieldActive = false;

    // Remote players map
    this.remotePlayers = {};

    // NPCs are server-authoritative — we render what the server sends.
    // But we keep a local mirror for smooth interpolation.
    this.npcSprites = {};

    // Register Colyseus listeners
    this.setupRoomListeners();

    sceneReady = true;
    document.getElementById("ui-overlay").classList.remove("hidden");
    this.updateUI();
  }

  // ---------- MAP DRAWING (code-generated) ----------
  drawGround() {
    const g = this.add.graphics();
    g.fillStyle(0x2d2d2d, 1); g.fillRect(0, 0, MAP_W, MAP_H);
    // Road lines
    g.lineStyle(4, 0x444444, 1);
    for (let x = 0; x < MAP_W; x += 80) g.lineBetween(x, 0, x, MAP_H);
    // Central "protest" texture: scattered dots
    g.fillStyle(0x3a3a3a, 1);
    for (let i = 0; i < 200; i++) {
      g.fillCircle(Phaser.Math.Between(0, MAP_W), Phaser.Math.Between(0, MAP_H), Phaser.Math.Between(2, 5));
    }
    // Jantar Mantar label
    this.add.text(MAP_W / 2, 80, "JANTAR MANTAR", {
      fontSize: "28px", color: "#ffcc00", fontStyle: "bold"
    }).setOrigin(0.5);
  }

  drawCaptureZone() {
    const cx = MAP_W / 2, cy = MAP_H / 2;
    this.captureGfx = this.add.graphics();
    this.captureGfx.lineStyle(6, 0xffcc00, 0.9);
    this.captureGfx.strokeCircle(cx, cy, CAPTURE_RADIUS);
    this.captureGfx.fillStyle(0xffcc00, 0.08);
    this.captureGfx.fillCircle(cx, cy, CAPTURE_RADIUS);
    this.add.text(cx, cy, "CAPTURE ZONE", {
      fontSize: "16px", color: "#ffcc00"
    }).setOrigin(0.5).setAlpha(0.6);
  }

  drawBarricades() {
    // Static barricades around the capture zone (visual only; server handles collision)
    const cx = MAP_W / 2, cy = MAP_H / 2;
    const g = this.add.graphics();
    g.lineStyle(6, 0xcccccc, 1);
    const points = [
      [cx - 200, cy - 200], [cx + 200, cy - 200],
      [cx + 200, cy + 200], [cx - 200, cy + 200],
      [cx - 200, cy - 200]
    ];
    for (let i = 0; i < points.length - 1; i++) {
      g.lineBetween(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    }
  }

  // ---------- COLYSEUS LISTENERS ----------
  setupRoomListeners() {
    room.onStateChange((state) => {
      // Sync remote players
      state.players.forEach((p, sessionId) => {
        if (sessionId === room.sessionId) return;
        if (!this.remotePlayers[sessionId]) {
          const color = p.side === "protestor" ? 0xff8844 : 0x4488ff;
          const sprite = this.add.circle(p.x, p.y, 14, color).setStrokeStyle(2, 0xffffff);
          this.remotePlayers[sessionId] = sprite;
        }
        // Linear interpolation
        const sprite = this.remotePlayers[sessionId];
        sprite.x = Phaser.Math.Linear(sprite.x, p.x, 0.3);
        sprite.y = Phaser.Math.Linear(sprite.y, p.y, 0.3);
      });
      // Remove disconnected
      Object.keys(this.remotePlayers).forEach(id => {
        if (!state.players.has(id)) {
          this.remotePlayers[id].destroy();
          delete this.remotePlayers[id];
        }
      });

      // Sync NPCs (server-authoritative)
      state.npcs.forEach((n, id) => {
        if (!this.npcSprites[id]) {
          this.npcSprites[id] = this.add.circle(n.x, n.y, 8, 0xaaaaaa).setStrokeStyle(1, 0xffffff);
        }
        const s = this.npcSprites[id];
        s.x = Phaser.Math.Linear(s.x, n.x, 0.25);
        s.y = Phaser.Math.Linear(s.y, n.y, 0.25);
        s.setFillStyle(n.recruitedBy === "protestor" ? 0xff6600 : n.recruitedBy === "police" ? 0x3366ff : 0xaaaaaa);
      });
      Object.keys(this.npcSprites).forEach(id => {
        if (!state.npcs.has(id)) { this.npcSprites[id].destroy(); delete this.npcSprites[id]; }
      });

      // Sync tug-of-war meter
      this.meterValue = state.meter;
      this.updateUI();
    });

    room.onMessage("nara", (data) => {
      // Floating text for nara
      const t = this.add.text(this.player.x, this.player.y - 30, data.text, {
        fontSize: "18px", color: "#ffcc00", fontStyle: "bold"
      }).setOrigin(0.5);
      this.tweens.add({ targets: t, y: t.y - 60, alpha: 0, duration: 1200, onComplete: () => t.destroy() });
    });

    room.onMessage("push", (data) => {
      // Visual shockwave for push
      const wave = this.add.circle(data.x, data.y, 10, 0xffffff, 0.6);
      this.tweens.add({ targets: wave, radius: 120, alpha: 0, duration: 400, onComplete: () => wave.destroy() });
    });
  }

  // ---------- UPDATE LOOP ----------
  update(time, delta) {
    if (!room || !sceneReady) return;

    // Movement
    let vx = 0, vy = 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) vy += 1;
    const speed = this.speedBoost && time < this.speedBoost ? 280 : 180;
    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy);
      vx = (vx / len) * speed; vy = (vy / len) * speed;
    }
    this.player.body.setVelocity(vx, vy);

    // Send position to server at ~20 Hz (every 50ms)
    if (time - (this.lastSend || 0) > 50) {
      room.send("move", { x: this.player.x, y: this.player.y });
      this.lastSend = time;
    }

    // --- ACTIONS ---
    if (mySide === "protestor") {
      // Nara (Space)
      if (Phaser.Input.Keyboard.JustDown(this.keySpace) && time > this.lastNara + NARA_COOLDOWN_MS) {
        this.lastNara = time;
        this.speedBoost = time + 2500;
        const nara = NARAS[Phaser.Math.Between(0, NARAS.length - 1)];
        room.send("nara", { text: nara, x: this.player.x, y: this.player.y });
      }
      // Push (E)
      if (Phaser.Input.Keyboard.JustDown(this.keyE) && time > this.lastPush + PUSH_COOLDOWN_MS) {
        this.lastPush = time;
        room.send("push", { x: this.player.x, y: this.player.y });
        // Local visual
        const wave = this.add.circle(this.player.x, this.player.y, 10, 0xff6600, 0.5);
        this.tweens.add({ targets: wave, radius: 100, alpha: 0, duration: 350, onComplete: () => wave.destroy() });
      }
    } else if (mySide === "police") {
      // Shield toggle (F) — cannot attack while active
      if (Phaser.Input.Keyboard.JustDown(this.keyF) && time > this.lastShield + SHIELD_COOLDOWN_MS) {
        this.lastShield = time;
        this.shieldActive = !this.shieldActive;
        room.send("shield", { active: this.shieldActive });
        this.player.setStrokeStyle(this.shieldActive ? 6 : 3, this.shieldActive ? 0x00ffcc : 0xffffff);
      }
      // Lathi hit (E) — only if shield is inactive
      if (Phaser.Input.Keyboard.JustDown(this.keyE) && !this.shieldActive && time > this.lastLathi + LATHI_COOLDOWN_MS) {
        this.lastLathi = time;
        room.send("lathi", { x: this.player.x, y: this.player.y });
        const wave = this.add.circle(this.player.x, this.player.y, 10, 0x3366ff, 0.5);
        this.tweens.add({ targets: wave, radius: 70, alpha: 0, duration: 250, onComplete: () => wave.destroy() });
      }
    }

    // Camera bounds
    this.cameras.main.scrollX = Phaser.Math.Clamp(this.cameras.main.scrollX, 0, MAP_W - this.cameras.main.width);
    this.cameras.main.scrollY = Phaser.Math.Clamp(this.cameras.main.scrollY, 0, MAP_H - this.cameras.main.height);
  }

  updateUI() {
    const overlay = document.getElementById("ui-overlay");
    const sideLabel = mySide === "protestor" ? "🪧 Protestor" : "🛡️ Police";
    const meter = this.meterValue || 50;
    overlay.innerHTML = `
      <div><strong>${sideLabel}</strong></div>
      <div>Tug-of-War: ${meter.toFixed(1)}%</div>
      <div style="font-size:11px; opacity:0.7; margin-top:6px;">
        ${mySide === "protestor" ? "Space: Nara (speed+XP) · E: Push" : "E: Lathi · F: Shield Toggle"}
      </div>
    `;
  }
}

// ---------- PHASER CONFIG ----------
const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  parent: "game-container",
  physics: { default: "arcade", arcade: { debug: false } },
  scene: [MainScene],
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH }
};
new Phaser.Game(config);

// ---------- LOBBY & COLYSEUS CONNECTION ----------
const statusEl = document.getElementById("status");
const lobbyEl = document.getElementById("lobby");

async function joinGame(side) {
  statusEl.textContent = "Connecting…";
  try {
    const client = new Colyseus.Client(SERVER_URL);
    const code = document.getElementById("room-code").value.trim().toUpperCase() || "JANTAR";
    room = await client.joinOrCreate(code, { side });
    mySide = side;
    lobbyEl.classList.add("hidden");
    statusEl.textContent = "Connected!";
    console.log("Joined room:", room.sessionId, "as", side);
  } catch (e) {
    statusEl.textContent = "Connection failed. Is the server awake?";
    console.error(e);
  }
}

document.getElementById("join-protestor").addEventListener("click", () => joinGame("protestor"));
document.getElementById("join-police").addEventListener("click", () => joinGame("police"));