// ── Constants ────────────────────────────────────────────────────────────────
const CANVAS_W = 560;
const CANVAS_H = 560;
const FUR_SIZE = 6;
const STARTING_TIME = 30;
const CLEAN_BONUS_TIME = 3;

// Roller types
const ROLLER_TYPES = [
  {
    id: 'basic',
    name: 'Basic Roller',
    radius: 30,
    maxUses: 100,
    reloadTime: 240,   // 4s at 60fps
    stickiness: 1,     // multiplier: 1 = normal
    color: '#e94560',
    colorActive: '#ff6b6b',
    cost: 0,
  },
  {
    id: 'wide',
    name: 'Wide Roller',
    radius: 50,
    maxUses: 75,
    reloadTime: 240,
    stickiness: 1,
    color: '#4a90d9',
    colorActive: '#6ab0ff',
    cost: 30,
  },
  {
    id: 'reusable',
    name: 'Reusable Roller',
    radius: 30,
    maxUses: Infinity,
    reloadTime: 0,
    stickiness: 0.4,   // less sticky — only 40% chance to pick up each fur
    color: '#4ecca3',
    colorActive: '#6eeec3',
    cost: 50,
  },
];

// Clothing items: name, color, fur count
const CLOTHING_TYPES = [
  { name: 'T-Shirt',  color: '#3a86a8', furCount: 50,  shape: 'tshirt',  timeBonus: 4 },
  { name: 'Sweater',  color: '#6a4c93', furCount: 80,  shape: 'sweater', timeBonus: 5 },
  { name: 'Pants',    color: '#4a6741', furCount: 60,  shape: 'pants',   timeBonus: 3 },
  { name: 'Socks',    color: '#b07d62', furCount: 35,  shape: 'socks',   timeBonus: 2 },
];

// ── State ────────────────────────────────────────────────────────────────────
let canvas, ctx;
let score = 0;
let timeLeft = STARTING_TIME;
let timerInterval = null;
let furParticles = [];
let currentClothing = null;
let clothingPath = null;       // Path2D for current clothing shape
let mouseX = -100, mouseY = -100;
let mouseDown = false;
let gameRunning = false;

// Roller state
let ownedRollers = ['basic'];  // roller IDs the player owns
let equippedRollers = ['basic']; // rollers in the player's active loadout
let activeRollerIndex = 0;    // index into equippedRollers
let rollerUses = 0;
let rollerReloading = false;
let rollerReloadTimer = 0;

// Currency
let lintPoints = 0;            // persistent across rounds

// Cat interruption state
let catEvents = [];            // array of active cat events
let catCooldown = 0;           // frames until next cat event can trigger
const CAT_COOLDOWN_BASE = 180;    // ~3s at 60fps, decreases with score
const CAT_COOLDOWN_MIN = 60;      // minimum ~1s cooldown
const CAT_EVENT_CHANCE_BASE = 0.003; // per-frame chance, increases with score
const CAT_EVENT_CHANCE_MAX = 0.015;
const DOUBLE_CAT_CHANCE_BASE = 0.3;  // increases with score
const DOUBLE_CAT_CHANCE_MAX = 0.7;

// Cat colors
const CAT_COLORS = [
  { body: '#555', name: 'gray' },
  { body: '#d4822a', name: 'orange' },
];

// ── DOM refs ─────────────────────────────────────────────────────────────────
const titleScreen    = document.getElementById('title-screen');
const gameScreen     = document.getElementById('game-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const shopScreen     = document.getElementById('shop-screen');
const scoreEl        = document.getElementById('score');
const timerEl        = document.getElementById('timer');
const finalScoreEl   = document.getElementById('final-score');
const earnedPointsEl = document.getElementById('earned-points');
const shopPointsEl   = document.getElementById('shop-points');
const shopItemsEl    = document.getElementById('shop-items');
const itemLabelEl    = document.getElementById('item-label');
const bonusPopup     = document.getElementById('bonus-popup');
const startBtn       = document.getElementById('start-btn');
const replayBtn      = document.getElementById('replay-btn');
const shopBtn        = document.getElementById('shop-btn');
const shopBackBtn    = document.getElementById('shop-back-btn');

// ── Screens ──────────────────────────────────────────────────────────────────
function showScreen(screen) {
  [titleScreen, gameScreen, gameoverScreen, shopScreen].forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

// ── Init ─────────────────────────────────────────────────────────────────────
function init() {
  canvas = document.getElementById('game-canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  ctx = canvas.getContext('2d');

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    mouseY = (e.clientY - rect.top) * (CANVAS_H / rect.height);
  });
  canvas.addEventListener('mousedown', () => { mouseDown = true; });
  canvas.addEventListener('mouseup',   () => { mouseDown = false; });
  canvas.addEventListener('mouseleave', () => { mouseDown = false; });

  // Touch support
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    mouseDown = true;
    updateTouchPos(e);
  });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    updateTouchPos(e);
  });
  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    mouseDown = false;
  });

  // Tool switching
  document.addEventListener('keydown', e => {
    if (e.key === 'q' || e.key === 'Q') {
      if (gameRunning && equippedRollers.length > 1) {
        activeRollerIndex = (activeRollerIndex + 1) % equippedRollers.length;
        const roller = getActiveRoller();
        rollerUses = roller.maxUses;
        rollerReloading = false;
        rollerReloadTimer = 0;
      }
    }
  });

  startBtn.addEventListener('click', startGame);
  replayBtn.addEventListener('click', startGame);
  shopBtn.addEventListener('click', openShop);
  shopBackBtn.addEventListener('click', () => showScreen(gameoverScreen));
}

function updateTouchPos(e) {
  const touch = e.touches[0];
  if (!touch) return;
  const rect = canvas.getBoundingClientRect();
  mouseX = (touch.clientX - rect.left) * (CANVAS_W / rect.width);
  mouseY = (touch.clientY - rect.top) * (CANVAS_H / rect.height);
}

// ── Roller helpers ───────────────────────────────────────────────────────────
function getActiveRoller() {
  const id = equippedRollers[activeRollerIndex];
  return ROLLER_TYPES.find(r => r.id === id);
}

// ── Game start / end ─────────────────────────────────────────────────────────
function startGame() {
  score = 0;
  timeLeft = STARTING_TIME;
  scoreEl.textContent = score;
  timerEl.textContent = timeLeft;
  catEvents = [];
  catCooldown = CAT_COOLDOWN_BASE;

  // Build equipped rollers from owned ones
  equippedRollers = [...ownedRollers];
  activeRollerIndex = 0;
  const roller = getActiveRoller();
  rollerUses = roller.maxUses;
  rollerReloading = false;
  rollerReloadTimer = 0;
  gameRunning = true;

  showScreen(gameScreen);
  spawnClothing();
  startTimer();
  requestAnimationFrame(gameLoop);
}

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeLeft--;
    timerEl.textContent = Math.max(0, timeLeft);
    if (timeLeft <= 0) endGame();
  }, 1000);
}

function endGame() {
  gameRunning = false;
  clearInterval(timerInterval);
  finalScoreEl.textContent = score;
  const earned = score; // 1 lint point per cleaned item
  lintPoints += earned;
  earnedPointsEl.textContent = earned;
  showScreen(gameoverScreen);
}

// ── Clothing ─────────────────────────────────────────────────────────────────
function spawnClothing() {
  currentClothing = CLOTHING_TYPES[Math.floor(Math.random() * CLOTHING_TYPES.length)];
  itemLabelEl.textContent = currentClothing.name;
  clothingPath = buildClothingPath(currentClothing.shape);
  furParticles = generateFur(currentClothing.furCount);
}

function buildClothingPath(shape) {
  const p = new Path2D();
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;

  switch (shape) {
    case 'tshirt':
      // Simple T-shirt outline
      p.moveTo(cx - 80, cy - 100);
      p.lineTo(cx - 130, cy - 60);
      p.lineTo(cx - 100, cy - 30);
      p.lineTo(cx - 80, cy - 50);
      p.lineTo(cx - 80, cy + 110);
      p.lineTo(cx + 80, cy + 110);
      p.lineTo(cx + 80, cy - 50);
      p.lineTo(cx + 100, cy - 30);
      p.lineTo(cx + 130, cy - 60);
      p.lineTo(cx + 80, cy - 100);
      p.closePath();
      break;
    case 'sweater':
      // Wider, boxier sweater with longer sleeves
      p.moveTo(cx - 90, cy - 110);
      p.lineTo(cx - 150, cy - 50);
      p.lineTo(cx - 150, cy - 10);
      p.lineTo(cx - 110, cy - 20);
      p.lineTo(cx - 90, cy - 50);
      p.lineTo(cx - 90, cy + 120);
      p.lineTo(cx + 90, cy + 120);
      p.lineTo(cx + 90, cy - 50);
      p.lineTo(cx + 110, cy - 20);
      p.lineTo(cx + 150, cy - 10);
      p.lineTo(cx + 150, cy - 50);
      p.lineTo(cx + 90, cy - 110);
      p.closePath();
      break;
    case 'pants':
      // Pants shape
      p.moveTo(cx - 70, cy - 120);
      p.lineTo(cx - 70, cy + 10);
      p.lineTo(cx - 90, cy + 130);
      p.lineTo(cx - 30, cy + 130);
      p.lineTo(cx, cy + 20);
      p.lineTo(cx + 30, cy + 130);
      p.lineTo(cx + 90, cy + 130);
      p.lineTo(cx + 70, cy + 10);
      p.lineTo(cx + 70, cy - 120);
      p.closePath();
      break;
    case 'socks':
      // Pair of socks side by side
      // Left sock
      p.moveTo(cx - 100, cy - 100);
      p.lineTo(cx - 100, cy + 40);
      p.quadraticCurveTo(cx - 100, cy + 90, cx - 60, cy + 90);
      p.lineTo(cx - 30, cy + 90);
      p.quadraticCurveTo(cx - 20, cy + 90, cx - 20, cy + 60);
      p.lineTo(cx - 20, cy + 40);
      p.lineTo(cx - 50, cy + 40);
      p.lineTo(cx - 50, cy - 100);
      p.closePath();
      // Right sock
      p.moveTo(cx + 50, cy - 100);
      p.lineTo(cx + 50, cy + 40);
      p.lineTo(cx + 20, cy + 40);
      p.lineTo(cx + 20, cy + 60);
      p.quadraticCurveTo(cx + 20, cy + 90, cx + 30, cy + 90);
      p.lineTo(cx + 60, cy + 90);
      p.quadraticCurveTo(cx + 100, cy + 90, cx + 100, cy + 40);
      p.lineTo(cx + 100, cy - 100);
      p.closePath();
      break;
  }
  return p;
}

function generateFur(count) {
  const particles = [];
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  // Scatter fur within a bounding box, keep only those inside the clothing path
  let attempts = 0;
  while (particles.length < count && attempts < count * 20) {
    attempts++;
    const x = cx + (Math.random() - 0.5) * 320;
    const y = cy + (Math.random() - 0.5) * 300;
    if (ctx.isPointInPath(clothingPath, x, y)) {
      particles.push({
        x, y,
        size: FUR_SIZE + Math.random() * 3,
        angle: Math.random() * Math.PI * 2,
        color: randomFurColor(),
        alive: true,
      });
    }
  }
  return particles;
}

function randomFurColor() {
  const colors = ['#f5e6ca', '#d4a76a', '#c4c4c4', '#888', '#e8d5b7', '#f0f0f0'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function generateFurAt(centerX, centerY, count) {
  const particles = [];
  let attempts = 0;
  while (particles.length < count && attempts < count * 20) {
    attempts++;
    const x = centerX + (Math.random() - 0.5) * 80;
    const y = centerY + (Math.random() - 0.5) * 80;
    if (ctx.isPointInPath(clothingPath, x, y)) {
      particles.push({
        x, y,
        size: FUR_SIZE + Math.random() * 3,
        angle: Math.random() * Math.PI * 2,
        color: randomFurColor(),
        alive: true,
      });
    }
  }
  return particles;
}

// ── Cat Events ───────────────────────────────────────────────────────────────
function randomCatColor() {
  return CAT_COLORS[Math.floor(Math.random() * CAT_COLORS.length)];
}

// Difficulty scaling: ramps up over the first ~10 items cleaned
function getDifficulty() {
  const t = Math.min(score / 10, 1); // 0 to 1 over 10 items
  return {
    cooldown: Math.round(CAT_COOLDOWN_BASE - (CAT_COOLDOWN_BASE - CAT_COOLDOWN_MIN) * t),
    spawnChance: CAT_EVENT_CHANCE_BASE + (CAT_EVENT_CHANCE_MAX - CAT_EVENT_CHANCE_BASE) * t,
    doubleCatChance: DOUBLE_CAT_CHANCE_BASE + (DOUBLE_CAT_CHANCE_MAX - DOUBLE_CAT_CHANCE_BASE) * t,
  };
}

function updateCatEvents() {
  if (catEvents.length > 0) return; // already active

  if (catCooldown > 0) {
    catCooldown--;
    return;
  }

  const diff = getDifficulty();
  if (Math.random() < diff.spawnChance) {
    if (Math.random() < 0.5) {
      startCatWalkAcross();
    } else {
      startCatSit();
    }
  }
}

function startCatWalkAcross() {
  const baseY = CANVAS_H / 2 + (Math.random() - 0.5) * 100;
  const cat1 = {
    type: 'walkacross',
    x: -80,
    y: baseY,
    speed: 3 + Math.random() * 2,
    deposited: false,
    color: randomCatColor(),
  };
  catEvents.push(cat1);

  // Chance for a second cat walking across at a different height
  if (Math.random() < getDifficulty().doubleCatChance) {
    const offsetY = baseY + (Math.random() < 0.5 ? -70 : 70);
    const cat2 = {
      type: 'walkacross',
      x: -80 - 60 - Math.random() * 40, // staggered start
      y: Math.max(80, Math.min(CANVAS_H - 80, offsetY)),
      speed: 3 + Math.random() * 2,
      deposited: false,
      color: randomCatColor(),
    };
    catEvents.push(cat2);
  }
}

function startCatSit() {
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  const targetX = cx + (Math.random() - 0.5) * 160;
  const targetY = cy + (Math.random() - 0.5) * 120;
  const fromLeft = Math.random() < 0.5;
  catEvents.push({
    type: 'sit',
    phase: 'walking_in',       // 'walking_in' -> 'sitting'
    x: fromLeft ? -80 : CANVAS_W + 80,
    y: targetY,
    targetX,
    targetY,
    speed: 3 + Math.random() * 1.5,
    direction: fromLeft ? 1 : -1,
    hits: 0,
    hitsNeeded: 15,
    shakeTimer: 0,
    deposited: false,
    color: randomCatColor(),
  });
}

function updateAllCatEvents() {
  const hadCats = catEvents.length > 0;

  for (let i = catEvents.length - 1; i >= 0; i--) {
    const cat = catEvents[i];

    if (cat.type === 'walkacross') {
      cat.x += cat.speed;

      // Deposit fur when cat is over the clothing
      if (!cat.deposited && cat.x > CANVAS_W / 2 - 50) {
        cat.deposited = true;
        const extraFur = generateFur(Math.floor(currentClothing.furCount * 0.4));
        furParticles.push(...extraFur);
      }

      // Cat has walked off screen
      if (cat.x > CANVAS_W + 80) {
        catEvents.splice(i, 1);
      }
    } else if (cat.type === 'sit') {
      if (cat.phase === 'walking_in') {
        // Walk toward target position
        cat.x += cat.speed * cat.direction;
        const reached = cat.direction === 1
          ? cat.x >= cat.targetX
          : cat.x <= cat.targetX;
        if (reached) {
          cat.x = cat.targetX;
          cat.phase = 'sitting';
          // Deposit fur around where the cat sits
          if (!cat.deposited) {
            cat.deposited = true;
            const sitFur = generateFurAt(cat.x, cat.y, Math.floor(currentClothing.furCount * 0.3));
            furParticles.push(...sitFur);
          }
        }
      } else {
        // Sitting phase — check if player is rolling on the cat
        if (mouseDown) {
          const dx = mouseX - cat.x;
          const dy = mouseY - cat.y;
          if (Math.sqrt(dx * dx + dy * dy) < 50) {
            cat.hits++;
            cat.shakeTimer = 10;
            if (cat.hits >= cat.hitsNeeded) {
              catEvents.splice(i, 1);
              continue;
            }
          }
        }
        if (cat.shakeTimer > 0) {
          cat.shakeTimer--;
        }
      }
    }
  }

  // Reset cooldown only when cats just finished leaving this frame
  if (hadCats && catEvents.length === 0) {
    catCooldown = getDifficulty().cooldown;
  }
}

// ── Drawing ──────────────────────────────────────────────────────────────────
function drawClothing() {
  ctx.save();
  ctx.fillStyle = currentClothing.color;
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetY = 5;
  ctx.fill(clothingPath);
  ctx.restore();

  // Outline
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 2;
  ctx.stroke(clothingPath);
}

function drawFur() {
  for (const f of furParticles) {
    if (!f.alive) continue;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    ctx.fillStyle = f.color;
    ctx.beginPath();
    // Draw wispy fur strand
    ctx.ellipse(0, 0, f.size * 0.3, f.size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawRoller() {
  const roller = getActiveRoller();
  const radius = roller.radius;

  ctx.save();
  // Shadow
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 10;

  // Handle
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(mouseX, mouseY - radius - 5);
  ctx.lineTo(mouseX, mouseY - radius - 35);
  ctx.stroke();

  // Roller body — grayed out when reloading
  if (rollerReloading) {
    ctx.fillStyle = '#666';
  } else {
    ctx.fillStyle = mouseDown ? roller.colorActive : roller.color;
  }
  ctx.beginPath();
  ctx.roundRect(mouseX - radius, mouseY - radius * 0.6,
                radius * 2, radius * 1.2, 6);
  ctx.fill();

  // Sticky surface highlight
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.roundRect(mouseX - radius + 4, mouseY - radius * 0.6 + 3,
                radius * 2 - 8, radius * 0.4, 3);
  ctx.fill();

  ctx.restore();

  // Roller uses indicator (below roller)
  ctx.save();
  if (rollerReloading) {
    const reloadPct = 1 - rollerReloadTimer / roller.reloadTime;
    const barW = radius * 2;
    const barX = mouseX - radius;
    const barY = mouseY + radius * 0.8;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(barX, barY, barW, 6);
    ctx.fillStyle = '#ffa500';
    ctx.fillRect(barX, barY, barW * reloadPct, 6);
    ctx.fillStyle = '#ffa500';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Reloading...', mouseX, barY + 18);
  } else if (roller.maxUses !== Infinity) {
    const usesPct = rollerUses / roller.maxUses;
    const barW = radius * 2;
    const barX = mouseX - radius;
    const barY = mouseY + radius * 0.8;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(barX, barY, barW, 4);
    const r = Math.floor(255 * (1 - usesPct));
    const g = Math.floor(200 * usesPct);
    ctx.fillStyle = `rgb(${r},${g},50)`;
    ctx.fillRect(barX, barY, barW * usesPct, 4);
  }
  ctx.restore();
}

function drawCat() {
  for (const cat of catEvents) {
    drawSingleCat(cat);
  }
}

function drawSingleCat(cat) {
  ctx.save();
  const cx = cat.x;
  const cy = cat.y;
  const bodyColor = cat.color.body;

  if (cat.type === 'sit' && cat.phase === 'sitting' && cat.shakeTimer > 0) {
    ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
  }

  // Cat body
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  if (cat.type === 'walkacross' || (cat.type === 'sit' && cat.phase === 'walking_in')) {
    // Flip cat to face walking direction
    const dir = cat.type === 'walkacross' ? 1 : cat.direction;
    // Mirror horizontally if walking right-to-left
    ctx.translate(cx, cy);
    ctx.scale(dir, 1);
    ctx.translate(-cx, -cy);
    // Walking cat (side view)
    ctx.ellipse(cx, cy, 40, 25, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.beginPath();
    ctx.fillStyle = bodyColor;
    ctx.arc(cx + 35, cy - 10, 18, 0, Math.PI * 2);
    ctx.fill();
    // Ears
    ctx.beginPath();
    ctx.moveTo(cx + 25, cy - 25);
    ctx.lineTo(cx + 30, cy - 40);
    ctx.lineTo(cx + 38, cy - 25);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 35, cy - 25);
    ctx.lineTo(cx + 42, cy - 40);
    ctx.lineTo(cx + 48, cy - 25);
    ctx.fill();
    // Tail
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy - 5);
    ctx.quadraticCurveTo(cx - 65, cy - 40, cx - 50, cy - 50);
    ctx.stroke();
    // Eyes
    ctx.fillStyle = cat.color.name === 'orange' ? '#4a4' : '#ff0';
    ctx.beginPath();
    ctx.arc(cx + 30, cy - 14, 3, 0, Math.PI * 2);
    ctx.arc(cx + 42, cy - 14, 3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Sitting cat (front view)
    ctx.ellipse(cx, cy, 35, 40, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.beginPath();
    ctx.fillStyle = bodyColor;
    ctx.arc(cx, cy - 45, 22, 0, Math.PI * 2);
    ctx.fill();
    // Ears
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy - 55);
    ctx.lineTo(cx - 12, cy - 75);
    ctx.lineTo(cx - 2, cy - 55);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 2, cy - 55);
    ctx.lineTo(cx + 12, cy - 75);
    ctx.lineTo(cx + 18, cy - 55);
    ctx.fill();
    // Eyes
    ctx.fillStyle = cat.color.name === 'orange' ? '#4a4' : '#ff0';
    ctx.beginPath();
    ctx.arc(cx - 8, cy - 48, 4, 0, Math.PI * 2);
    ctx.arc(cx + 8, cy - 48, 4, 0, Math.PI * 2);
    ctx.fill();
    // Pupils
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx - 8, cy - 48, 2, 3, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 8, cy - 48, 2, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Hit indicator
    if (cat.hitsNeeded > 0) {
      ctx.fillStyle = '#e94560';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Roll me away! (${cat.hits}/${cat.hitsNeeded})`, cx, cy + 55);
    }
  }

  ctx.restore();
}

function showBonus(seconds) {
  bonusPopup.classList.remove('show');
  bonusPopup.textContent = `+${seconds}s`;
  // Force reflow
  void bonusPopup.offsetWidth;
  bonusPopup.classList.add('show');
  setTimeout(() => bonusPopup.classList.remove('show'), 800);
}

// ── Game Logic ───────────────────────────────────────────────────────────────
function updateRoller() {
  const roller = getActiveRoller();
  if (rollerReloading) {
    rollerReloadTimer--;
    if (rollerReloadTimer <= 0) {
      rollerReloading = false;
      rollerUses = roller.maxUses;
    }
  } else if (roller.maxUses !== Infinity && rollerUses <= 0) {
    rollerReloading = true;
    rollerReloadTimer = roller.reloadTime;
  }
}

function cleanFur() {
  if (!mouseDown) return;
  if (rollerReloading) return;
  if (catEvents.some(c => c.type === 'sit' && c.phase === 'sitting')) return; // blocked by sitting cat

  const roller = getActiveRoller();
  const r = roller.radius;
  for (const f of furParticles) {
    if (!f.alive) continue;
    const dx = mouseX - f.x;
    const dy = mouseY - f.y;
    if (dx * dx + dy * dy < r * r) {
      // Stickiness check for reusable roller
      if (roller.stickiness < 1 && Math.random() > roller.stickiness) continue;
      f.alive = false;
      if (roller.maxUses !== Infinity) rollerUses--;
    }
  }
}

function checkClean() {
  const alive = furParticles.filter(f => f.alive).length;
  if (alive === 0 && furParticles.length > 0) {
    score++;
    scoreEl.textContent = score;
    const bonus = currentClothing.timeBonus;
    timeLeft += bonus;
    timerEl.textContent = timeLeft;
    showBonus(bonus);
    catEvents = []; // clear any active cat events on item clear
    spawnClothing();
  }
}

// ── Game Loop ────────────────────────────────────────────────────────────────
function gameLoop() {
  if (!gameRunning) return;

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Background pattern
  ctx.fillStyle = '#16213e';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  drawClothing();
  drawFur();

  updateCatEvents();
  updateAllCatEvents();
  drawCat();

  updateRoller();
  cleanFur();
  checkClean();

  drawRoller();

  // Roller uses counter (bottom-left)
  const roller = getActiveRoller();
  ctx.save();
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'left';
  if (roller.maxUses === Infinity) {
    ctx.fillStyle = roller.color;
    ctx.fillText('Rolls: \u221E', 14, CANVAS_H - 24);
  } else {
    const usesDisplay = Math.max(0, rollerUses);
    if (rollerReloading) {
      ctx.fillStyle = '#ffa500';
    } else if (usesDisplay <= 20) {
      ctx.fillStyle = '#e94560';
    } else {
      ctx.fillStyle = '#ccc';
    }
    ctx.fillText(`Rolls: ${usesDisplay}/${roller.maxUses}`, 14, CANVAS_H - 24);
  }
  ctx.restore();

  // Tool inventory (top-right)
  drawToolInventory();

  // Progress indicator
  const alive = furParticles.filter(f => f.alive).length;
  const total = furParticles.length;
  if (total > 0) {
    const pct = 1 - alive / total;
    ctx.fillStyle = 'rgba(78, 204, 163, 0.8)';
    ctx.fillRect(10, CANVAS_H - 14, (CANVAS_W - 20) * pct, 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.strokeRect(10, CANVAS_H - 14, CANVAS_W - 20, 6);
  }

  requestAnimationFrame(gameLoop);
}

// ── Tool Inventory HUD ──────────────────────────────────────────────────────
function drawToolInventory() {
  if (equippedRollers.length <= 1) return;

  ctx.save();
  const startX = CANVAS_W - 14;
  const y = 14;

  for (let i = equippedRollers.length - 1; i >= 0; i--) {
    const rt = ROLLER_TYPES.find(r => r.id === equippedRollers[i]);
    const isActive = i === activeRollerIndex;
    const boxW = 50;
    const boxH = 28;
    const bx = startX - (equippedRollers.length - i) * (boxW + 6);
    const by = y;

    // Background
    ctx.fillStyle = isActive ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.3)';
    ctx.strokeStyle = isActive ? rt.color : 'rgba(255,255,255,0.2)';
    ctx.lineWidth = isActive ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 4);
    ctx.fill();
    ctx.stroke();

    // Mini roller icon
    ctx.fillStyle = rt.color;
    const iconW = Math.min(rt.radius * 0.6, 20);
    ctx.beginPath();
    ctx.roundRect(bx + (boxW - iconW) / 2, by + 8, iconW, 12, 3);
    ctx.fill();
  }

  // Q hint
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Press Q to switch', startX, y + 42);
  ctx.restore();
}

// ── Shop ────────────────────────────────────────────────────────────────────
function openShop() {
  shopPointsEl.textContent = lintPoints;
  shopItemsEl.innerHTML = '';

  for (const rt of ROLLER_TYPES) {
    if (rt.id === 'basic') continue; // always owned, don't show

    const owned = ownedRollers.includes(rt.id);
    const canAfford = lintPoints >= rt.cost;

    const item = document.createElement('div');
    item.className = 'shop-item' + (owned ? ' owned' : '');

    const info = document.createElement('div');
    info.className = 'shop-item-info';

    const name = document.createElement('div');
    name.className = 'shop-item-name';
    name.style.color = rt.color;
    name.textContent = rt.name;

    const desc = document.createElement('div');
    desc.className = 'shop-item-desc';
    if (rt.id === 'wide') {
      desc.textContent = `Wider coverage (radius ${rt.radius}), ${rt.maxUses} rolls per sheet`;
    } else if (rt.id === 'reusable') {
      desc.textContent = 'Unlimited rolls, but less sticky (requires more passes)';
    }

    info.appendChild(name);
    info.appendChild(desc);
    item.appendChild(info);

    const btn = document.createElement('button');
    btn.className = 'shop-item-btn';
    if (owned) {
      btn.className += ' owned-label';
      btn.textContent = 'Owned';
    } else {
      btn.className += ' buy';
      btn.textContent = `${rt.cost} LP`;
      btn.disabled = !canAfford;
      btn.addEventListener('click', () => {
        if (lintPoints >= rt.cost) {
          lintPoints -= rt.cost;
          ownedRollers.push(rt.id);
          openShop(); // refresh
        }
      });
    }
    item.appendChild(btn);
    shopItemsEl.appendChild(item);
  }

  showScreen(shopScreen);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
init();
