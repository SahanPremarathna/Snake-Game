"use strict";

// ═══════════════════════════════════════════════════════
//  DIFFICULTY  (tickMs = time between logic steps)
// ═══════════════════════════════════════════════════════
import { DIFF, DEFAULT_DIFF } from "./config.js";
import { rnd, lerp, storageGet, storageSet, hexToRgb, hexA } from "./utils.js";

let curDiff = DEFAULT_DIFF;

// ═══════════════════════════════════════════════════════
//  CANVAS
// ═══════════════════════════════════════════════════════
let COLS = 0, ROWS = 0;
let CELL_W = 24, CELL_H = 24;
const canvas = document.getElementById("gameCanvas");
const ctx    = canvas.getContext("2d");
const canvasWrapper = document.getElementById("canvasWrapper");
updateBoardLayout();
window.addEventListener("resize", updateBoardLayout);

function resizeBoard(){
  const w = Math.max(120, Math.floor(canvasWrapper.clientWidth));
  const h = Math.max(120, Math.floor(canvasWrapper.clientHeight));
  canvas.width = w;
  canvas.height = h;
  const target = Math.max(18, Math.min(46, Math.floor(Math.min(w, h) / 22)));
  COLS = Math.max(16, Math.floor(canvas.width / target));
  ROWS = Math.max(12, Math.floor(canvas.height / target));
  CELL_W = canvas.width / COLS;
  CELL_H = canvas.height / ROWS;
}

function updateBoardLayout(){
  const topEls = [
    document.querySelector(".header"),
    document.querySelector(".score-panel"),
    document.querySelector(".diff-row"),
    document.querySelector(".status-bar"),
  ].filter(Boolean);
  const bottomEls = [
    document.querySelector(".progress-wrap"),
    document.querySelector(".controls-hint"),
  ].filter(Boolean);

  const topEdge = topEls.length
    ? Math.max(...topEls.map(el=>el.getBoundingClientRect().bottom))
    : 0;
  const bottomStart = bottomEls.length
    ? Math.min(...bottomEls.map(el=>el.getBoundingClientRect().top))
    : window.innerHeight;

  let topPad = Math.max(8, Math.ceil(topEdge + 8));
  let bottomPad = Math.max(8, Math.ceil(window.innerHeight - bottomStart + 8));
  const minPlayHeight = 140;
  const avail = window.innerHeight - topPad - bottomPad;
  if(avail < minPlayHeight){
    const deficit = minPlayHeight - avail;
    const cutBottom = Math.min(deficit, Math.max(0, bottomPad - 8));
    bottomPad -= cutBottom;
    topPad = Math.max(8, topPad - Math.max(0, deficit - cutBottom));
  }

  canvasWrapper.style.top = topPad + "px";
  canvasWrapper.style.bottom = bottomPad + "px";
  resizeBoard();
}

// ═══════════════════════════════════════════════════════
//  THEME
// ═══════════════════════════════════════════════════════
const root = document.documentElement;
let theme = storageGet("synx_theme", "dark");
root.setAttribute("data-theme", theme);
syncThemeUI();

document.getElementById("themeToggle").addEventListener("click", ()=>{
  theme = theme==="dark" ? "light" : "dark";
  root.setAttribute("data-theme", theme);
  storageSet("synx_theme", theme);
  syncThemeUI();
});
function syncThemeUI(){
  document.getElementById("toggleIcon").textContent  = theme==="dark" ? "☀" : "◑";
  document.getElementById("toggleLabel").textContent = theme==="dark" ? "LIGHT MODE" : "DARK MODE";
}
function cssVar(v){ return getComputedStyle(root).getPropertyValue(v).trim(); }

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
let snake, prevSnake, dir, nextDirs, fruit;
let score=0, hiScore=parseInt(storageGet("synx_hi","0"),10)||0;
let fruitsEaten=0, level=1;
let gameState = "idle";  // idle | running | paused | dead | won

// Smooth animation
let rafId=null, lastFrame=0, accum=0, interp=0;
document.getElementById("hiVal").textContent = hiScore;

// ═══════════════════════════════════════════════════════
//  DIFFICULTY BUTTONS
// ═══════════════════════════════════════════════════════
document.querySelectorAll(".diff-btn").forEach(b=>{
  b.addEventListener("click",()=>{
    document.querySelectorAll(".diff-btn").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    curDiff = b.dataset.diff;
    if(gameState==="running"){
      setStatus("", "RUNNING - "+curDiff.toUpperCase()+" - LV "+String(level).padStart(2,"0"));
    } else if(gameState==="paused"){
      setStatus("paused", "SUSPENDED - "+curDiff.toUpperCase()+" - PRESS P OR SPACE TO RESUME");
    }
  });
});

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════
function spawnFruit(){
  const occ = new Set(snake.map(s=>s.x+","+s.y));
  let x,y; do{ x=rnd(COLS); y=rnd(ROWS); }while(occ.has(x+","+y));
  fruit = {x, y};
}

function getTickMs(){
  const d=DIFF[curDiff];
  return d.speedUp ? Math.max(40, d.tickMs-(level-1)*6) : d.tickMs;
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
function initGame(){
  const cx=Math.floor(COLS/2), cy=Math.floor(ROWS/2);
  snake = [{x:cx,y:cy}];
  prevSnake = snake.map(s=>({x:s.x,y:s.y}));
  dir  = {x:1,y:0};
  nextDirs = [];
  score=0; fruitsEaten=0; level=1;
  spawnFruit();
  updateHUD();
}

// ═══════════════════════════════════════════════════════
//  LOGIC TICK  (fixed time step)
// ═══════════════════════════════════════════════════════
function logicTick(){
  if(gameState!=="running") return;
  prevSnake = snake.map(s=>({x:s.x,y:s.y}));

  // Pull next direction from queue (skip reversal)
  while(nextDirs.length){
    const nd = nextDirs.shift();
    if(nd.x !== -dir.x || nd.y !== -dir.y){ dir=nd; break; }
  }

  const head = {x:snake[0].x+dir.x, y:snake[0].y+dir.y};

  // Wall check
  if(head.x<0||head.x>=COLS||head.y<0||head.y>=ROWS) return triggerDeath();
  const ate = head.x===fruit.x && head.y===fruit.y;
  // Self check (allow moving into current tail cell if not growing this tick)
  const bodyLimit = snake.length - (ate ? 0 : 1);
  for(let i=0;i<bodyLimit;i++){
    if(snake[i].x===head.x&&snake[i].y===head.y) return triggerDeath();
  }
  snake.unshift(head);
  if(!ate) snake.pop();

  if(ate){
    fruitsEaten++;
    score += 10*level;
    level = Math.floor(fruitsEaten/5)+1;
    pulseScore();
    if(snake.length >= COLS*ROWS) return triggerWin();
    spawnFruit();
  }
  updateHUD();
}

// ═══════════════════════════════════════════════════════
//  RAF LOOP  — smooth 60fps rendering
// ═══════════════════════════════════════════════════════
function rafLoop(ts){
  rafId = requestAnimationFrame(rafLoop);
  if(!lastFrame) lastFrame = ts;
  const dt = Math.min(100, ts - lastFrame);
  lastFrame = ts;
  if(gameState==="running"){
    accum += dt;
    const tick = getTickMs();
    while(accum >= tick){
      logicTick();
      accum -= tick;
      if(gameState!=="running") break;
    }
    interp = Math.max(0, Math.min(1, accum / tick));
  }
  if(gameState==="running"||gameState==="paused"||gameState==="dead"){
    render(interp);
  }
}

function startRaf(ts){
  lastFrame = ts || performance.now();
  accum = 0;
  interp=0;
  if(rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(rafLoop);
}

// ═══════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════
function render(t){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawGrid();
  if(fruit) drawFruit();
  if(snake&&snake.length) drawSnake(t);
}

// ─── Grid ───────────────────────────────────────────────
function drawGrid(){
  ctx.strokeStyle = cssVar("--grid-line");
  ctx.lineWidth = 0.5;
  for(let i=0;i<=COLS;i++){
    const x = i * CELL_W;
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();
  }
  for(let i=0;i<=ROWS;i++){
    const y = i * CELL_H;
    ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();
  }
}

// ─── Fruit ──────────────────────────────────────────────
function drawFruit(){
  const now = performance.now();
  const cellMin = Math.min(CELL_W, CELL_H);
  const px = fruit.x*CELL_W+CELL_W/2, py = fruit.y*CELL_H+CELL_H/2;
  const pulse = 0.82 + Math.sin(now*0.004)*0.18;
  const r = cellMin*0.34*pulse;
  const fc = cssVar("--fruit");

  // Outer ambient glow
  const g = ctx.createRadialGradient(px,py,0,px,py,r*2.8);
  g.addColorStop(0, hexA(fc,0.22));
  g.addColorStop(1,"transparent");
  ctx.fillStyle=g;
  ctx.beginPath();ctx.arc(px,py,r*2.8,0,Math.PI*2);ctx.fill();

  // Rotating diamond
  ctx.save();
  ctx.translate(px,py);
  ctx.rotate(Math.PI/4 + now*0.001);
  const s=r*0.78;
  ctx.beginPath();ctx.rect(-s,-s,s*2,s*2);
  ctx.fillStyle=fc;
  ctx.shadowBlur=18; ctx.shadowColor=fc;
  ctx.fill();
  // Shine
  ctx.fillStyle="rgba(255,255,255,0.3)";
  ctx.fillRect(-s*.5,-s*.5,s*.82,s*.82);
  ctx.shadowBlur=0;
  ctx.restore();
}

// ─── Snake ──────────────────────────────────────────────
/*
  SMOOTH APPROACH:
  - Each frame the head is interpolated forward by (dir * interp * CELL)
  - Each following segment is smoothly pulled toward its leader
  - The whole body is rendered as a continuous tapered tube using quad strips
    + circle joints, giving a real organic snake appearance
*/
function drawSnake(t){
  const pts = buildPoints(t);
  if(!pts||pts.length<1) return;

  const isDead = gameState==="dead";
  const headColor = cssVar("--sh");
  const HALF_W = Math.min(CELL_W, CELL_H)*0.46; // max tube half-width

  // ── Tube body (tail → neck) ────────────────────────────
  ctx.save();
  for(let i=pts.length-1; i>=1; i--){
    const f  = 1-(i/(pts.length-1));   // 0=tail 1=head
    const p0 = pts[i], p1 = pts[i-1];
    const dx=p1.x-p0.x, dy=p1.y-p0.y;
    const len=Math.sqrt(dx*dx+dy*dy)||1;
    const nx=-dy/len, ny=dx/len;       // perpendicular

    const w0 = HALF_W*(0.28+0.72*f);   // taper: narrow at tail
    const w1 = HALF_W*(0.28+0.72*(1-Math.max(0,(i-1)/(pts.length-1))));

    ctx.beginPath();
    ctx.moveTo(p0.x+nx*w0, p0.y+ny*w0);
    ctx.lineTo(p1.x+nx*w1, p1.y+ny*w1);
    ctx.lineTo(p1.x-nx*w1, p1.y-ny*w1);
    ctx.lineTo(p0.x-nx*w0, p0.y-ny*w0);
    ctx.closePath();
    ctx.fillStyle = snakeColor(f, isDead);
    ctx.shadowBlur = isDead ? 0 : 8*f;
    ctx.shadowColor = headColor;
    ctx.fill();
  }

  // Joint circles smooth out any gaps between quads
  for(let i=1;i<pts.length-1;i++){
    const f = 1-(i/(pts.length-1));
    const w = HALF_W*(0.3+0.7*f);
    ctx.beginPath();
    ctx.arc(pts[i].x,pts[i].y,w,0,Math.PI*2);
    ctx.fillStyle = snakeColor(f, isDead);
    ctx.shadowBlur = 0;
    ctx.fill();
  }

  // Tail cap
  if(pts.length>1){
    const tail=pts[pts.length-1];
    ctx.beginPath(); ctx.arc(tail.x,tail.y,HALF_W*0.28,0,Math.PI*2);
    ctx.fillStyle=cssVar("--st"); ctx.fill();
  }
  ctx.shadowBlur=0;
  ctx.restore();

  // ── Head circle ───────────────────────────────────────
  const hpt = pts[0];
  const hW  = HALF_W*1.08;
  ctx.save();
  ctx.beginPath();ctx.arc(hpt.x,hpt.y,hW,0,Math.PI*2);
  ctx.fillStyle = isDead ? cssVar("--dead") : headColor;
  ctx.shadowBlur= isDead ? 24 : 26;
  ctx.shadowColor= isDead ? cssVar("--dead-glow") : headColor;
  ctx.fill();
  ctx.shadowBlur=0;

  // Head scales/gloss
  ctx.beginPath();
  ctx.arc(hpt.x-hW*.2,hpt.y-hW*.2,hW*.38,0,Math.PI*2);
  ctx.fillStyle="rgba(255,255,255,0.2)"; ctx.fill();
  ctx.restore();

  // Eyes
  drawEyes(hpt, hW, isDead);
}

// Build smoothed pixel-space spine points
function buildPoints(t){
  if(!snake||snake.length===0) return [];
  const curr = snake.map(s=>({x:s.x*CELL_W+CELL_W/2, y:s.y*CELL_H+CELL_H/2}));
  const prev = (prevSnake && prevSnake.length)
    ? prevSnake.map(s=>({x:s.x*CELL_W+CELL_W/2, y:s.y*CELL_H+CELL_H/2}))
    : curr;
  const pts = [];
  for(let i=0;i<curr.length;i++){
    const p0 = prev[i] || curr[i];
    const p1 = curr[i];
    pts.push({ x: lerp(p0.x,p1.x,t), y: lerp(p0.y,p1.y,t) });
  }
  return pts;
}

function snakeColor(f, isDead){
  // f: 0=tail dim, 1=head bright
  if(isDead){
    const a=0.4+f*0.5;
    return `rgba(255,34,68,${a.toFixed(2)})`;
  }
  const h=hexToRgb(cssVar("--sh"));
  const b=hexToRgb(cssVar("--sb"));
  const st=hexToRgb(cssVar("--st"));

  let c;
  if(f>0.5){ const u=(f-.5)*2; c={r:lerp(b.r,h.r,u),g:lerp(b.g,h.g,u),bb:lerp(b.b,h.b,u)}; }
  else      { const u=f*2;     c={r:lerp(st.r,b.r,u),g:lerp(st.g,b.g,u),bb:lerp(st.b,b.b,u)}; }
  const a=0.45+f*0.55;
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.bb)},${a.toFixed(2)})`;
}

function drawEyes(hpt, hW, isDead){
  const d=dir;
  const off=hW*0.5, eyeR=hW*0.21;
  let e1,e2;
  if(d.x===1)      {e1={x:hpt.x+off*.55,y:hpt.y-off*.55};e2={x:hpt.x+off*.55,y:hpt.y+off*.55};}
  else if(d.x===-1){e1={x:hpt.x-off*.55,y:hpt.y-off*.55};e2={x:hpt.x-off*.55,y:hpt.y+off*.55};}
  else if(d.y===-1){e1={x:hpt.x-off*.55,y:hpt.y-off*.55};e2={x:hpt.x+off*.55,y:hpt.y-off*.55};}
  else             {e1={x:hpt.x-off*.55,y:hpt.y+off*.55};e2={x:hpt.x+off*.55,y:hpt.y+off*.55};}

  [e1,e2].forEach(e=>{
    ctx.beginPath();ctx.arc(e.x,e.y,eyeR,0,Math.PI*2);
    ctx.fillStyle = isDead ? cssVar("--dead") : cssVar("--bg");
    ctx.shadowBlur= isDead?10:0; ctx.shadowColor=cssVar("--dead");
    ctx.fill(); ctx.shadowBlur=0;
    // Pupil
    ctx.beginPath();ctx.arc(e.x,e.y,eyeR*.52,0,Math.PI*2);
    ctx.fillStyle= isDead?"rgba(255,34,68,0.9)":cssVar("--sh");
    ctx.fill();
  });
}

// ═══════════════════════════════════════════════════════
//  HUD
// ═══════════════════════════════════════════════════════
function updateHUD(){
  document.getElementById("scoreVal").textContent  = score;
  document.getElementById("lengthVal").textContent = snake.length;
  document.getElementById("levelVal").textContent  = String(level).padStart(2,"0");
  const pct=((snake.length-1)/Math.max(1,COLS*ROWS-1))*100;
  document.getElementById("progressBar").style.width = pct.toFixed(1)+"%";
  document.getElementById("progLabel").textContent   = pct.toFixed(0)+"%";
}
function pulseScore(){
  const el=document.getElementById("scoreVal");
  el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse");
}
function setStatus(type,msg){
  const d=document.getElementById("statusDot");
  d.className="status-dot"+(type?" "+type:"");
  document.getElementById("statusText").textContent=msg;
}

// ═══════════════════════════════════════════════════════
//  GAME FLOW
// ═══════════════════════════════════════════════════════
function triggerDeath(){
  gameState="dead";
  if(score>hiScore){ hiScore=score; storageSet("synx_hi", hiScore); }
  document.getElementById("hiVal").textContent=hiScore;
  document.getElementById("deadScore").textContent=score;
  document.getElementById("deadOverlay").classList.add("visible");
  setStatus("dead","SYSTEM FAILURE — COLLISION DETECTED");
  render(0);
}
function triggerWin(){
  gameState="won";
  if(score>hiScore){ hiScore=score; storageSet("synx_hi", hiScore); }
  document.getElementById("hiVal").textContent=hiScore;
  document.getElementById("winScore").textContent=score;
  document.getElementById("winOverlay").classList.add("visible");
  setStatus("win","SINGULARITY ACHIEVED — MAX DENSITY");
}
function hideAll(){
  ["startOverlay","deadOverlay","winOverlay","pauseOverlay"]
    .forEach(id=>document.getElementById(id).classList.remove("visible"));
}
function beginGame(){
  hideAll();
  gameState="running";
  initGame();
  setStatus("","RUNNING · "+curDiff.toUpperCase()+" · LV 01");
  requestAnimationFrame(ts=>startRaf(ts));
}
function togglePause(){
  if(gameState==="running"){
    gameState="paused";
    document.getElementById("pauseOverlay").classList.add("visible");
    setStatus("paused","SUSPENDED — P OR SPACE TO RESUME");
  } else if(gameState==="paused"){
    gameState="running";
    document.getElementById("pauseOverlay").classList.remove("visible");
    setStatus("","RUNNING · "+curDiff.toUpperCase()+" · LV "+String(level).padStart(2,"0"));
    requestAnimationFrame(ts=>{ lastFrame=ts; accum=0; });
  }
}

// ═══════════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════════
const DMAP={
  ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},
  w:{x:0,y:-1},s:{x:0,y:1},a:{x:-1,y:0},d:{x:1,y:0},
  W:{x:0,y:-1},S:{x:0,y:1},A:{x:-1,y:0},D:{x:1,y:0},
};
document.addEventListener("keydown",e=>{
  const nd=DMAP[e.key];
  if(nd){
    e.preventDefault();
    if(gameState==="idle") return beginGame();
    if(gameState==="running"){
      const lastQueued = nextDirs.length ? nextDirs[nextDirs.length-1] : dir;
      if(nd.x===lastQueued.x && nd.y===lastQueued.y) return;
      if(nd.x===-lastQueued.x && nd.y===-lastQueued.y) return;
      if(nextDirs.length<3) nextDirs.push(nd);
    }
    return;
  }
  if(e.key==="p"||e.key==="P"||e.key===" "){
    e.preventDefault();
    if(gameState==="running"||gameState==="paused") togglePause();
  }
});

document.getElementById("startBtn").addEventListener("click",beginGame);
document.getElementById("restartBtn").addEventListener("click",beginGame);
document.getElementById("winRestartBtn").addEventListener("click",beginGame);

// ═══════════════════════════════════════════════════════
//  COLOR UTILS
// ═══════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════
//  BOOT — idle grid
// ═══════════════════════════════════════════════════════
function drawIdleGrid(){
  ctx.fillStyle=cssVar("--bg3");
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle=cssVar("--grid-line");ctx.lineWidth=0.5;
  for(let i=0;i<=COLS;i++){
    const x = i * CELL_W;
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();
  }
  for(let i=0;i<=ROWS;i++){
    const y = i * CELL_H;
    ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();
  }
}
drawIdleGrid();
requestAnimationFrame(updateBoardLayout);
(function idleLoop(){ if(gameState!=="idle") return; drawIdleGrid(); requestAnimationFrame(idleLoop); })();
