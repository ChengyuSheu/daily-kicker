// ═══════════════════════════════════════════════════════════════════════
//  FREE RIDE — SIMULATION
//
//  The mountain, the rider, the controls and the HUD. Everything here is
//  renderer-agnostic: it computes where things ARE, never how they look.
//
//  Two renderers consume it — js/ride-view-three.js (WebGL, the compatible
//  one) and js/ride-view-webgpu.js — and they must agree exactly, because
//  both are driven by this one simulation and both read this one terrainH.
//  The snow you see has to be the snow you ride on.
//
//  Effects that belong to a renderer (the track you leave, the powder) are
//  raised as HOOKS rather than drawn here, so the simulation never reaches
//  into a scene graph it should know nothing about.
//
//  Shares js/engine.js with the daily game for the body model, the pose
//  library and the landing bands.
//
//  Wrapped in an IIFE: engine.js declares G, TAU and friends at top level,
//  and a second top-level `const G` would be a redeclaration SyntaxError.
// ═══════════════════════════════════════════════════════════════════════
(function(){
"use strict";

const $=id=>document.getElementById(id);
const canvas=$('c');
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,f)=>a+(b-a)*f;
const smooth=t=>t*t*(3-2*t);

// Renderer-owned effects. Default to no-ops so the simulation runs headless
// with no renderer attached at all — which is how it gets tested.
const HOOK={ trail(){}, trailBreak(){}, spray(){}, reset(){} };

// ═══════════════════ THE MOUNTAIN ═══════════════════
// Terrain is a pure function of (x,z) — no stored state, so the world is
// endless in both directions and always regenerates identically. Features
// are placed by hashing a cell index, which means "what is at z=4210" has
// an answer without having simulated the 4209 metres before it.
// The mountain is not a constant ramp. Pitch varies along the fall line from
// mellow blue to black-diamond steep. The height is the ANALYTIC INTEGRAL of
// the slope profile, so gradient and height can never disagree — gravity is
// taken from the same function that draws the snow.
//
//   dY/dz = -(PITCH0 + P1 sin(z/L1) + P2 sin(z/L2))
//
const PITCH0=0.40, P1=0.15, L1=140, P2=0.10, L2=53;
const gradBase=z=>-(PITCH0+P1*Math.sin(z/L1)+P2*Math.sin(z/L2));
const baseY=z=>-(PITCH0*z-P1*L1*Math.cos(z/L1)-P2*L2*Math.cos(z/L2))
               -(P1*L1+P2*L2);                       // so baseY(0)=0
// tan of the local pitch, always positive downhill: 0.15 .. 0.65 → 8.5°..33°
const pitchTan=z=>PITCH0+P1*Math.sin(z/L1)+P2*Math.sin(z/L2);
const gradeOf=deg=>deg<16?'blue':deg<25?'red':'black';

// Deterministic hash → [0,1). Uses Math.imul throughout: plain `*` on these
// constants overflows into double precision, the low bits are lost, and the
// result is heavily biased — the first cut of this produced a kicker in every
// single cell and never once a negative x.
function hash1(n){
  let h=Math.imul(n^0x9e3779b9,0x85ebca6b);
  h^=h>>>13; h=Math.imul(h,0xc2b2ae35); h^=h>>>16;
  return (h>>>0)/4294967296;
}
const hashAt=(k,salt)=>hash1(Math.imul(k|0,0x27d4eb2d)^Math.imul(salt|0,0x165667b1));
// 2-D cell hash. The world is a plane, not a corridor, so features are placed
// on a grid in BOTH axes: ride as far across the mountain as you like and it
// keeps generating. The first cut hashed only the z cell and pinned every
// feature within +/-12 m of x=0, so traversing left you on a blank sheet.
const hashAt2=(i,j,salt)=>hash1(Math.imul(i|0,0x27d4eb2d)^Math.imul(j|0,0x165667b1)
                                ^Math.imul(salt|0,0x9e3779b1));

// ── features: kickers, rollers and hips, one candidate per cell ──
// Columns are close together and the lateral jitter is modest: spread them too
// far and a rider going straight down the fall line meets almost nothing (54 m
// columns with +/-20 m jitter gave one jump in 90 seconds).
const FEAT_SX=30, FEAT_SZ=42;
function featureAt(i,j){
  const r=hashAt2(i,j,1);
  if(r<0.16)return null;                       // some cells stay open
  const kind=r<0.46?'kicker':r<0.66?'roller':r<0.82?'hip':'cliff';
  const sizeR=hashAt2(i,j,2);
  if(kind==='cliff')return{
    kind,
    x:i*FEAT_SX+(hashAt2(i,j,4)*2-1)*12,
    z:j*FEAT_SZ+hashAt2(i,j,3)*16,
    amp:3.5+sizeR*4.5,                        // 3.5-8 m of drop
    len:38+sizeR*14,
    wid:9+sizeR*7
  };
  return{
    kind,
    x:i*FEAT_SX+(hashAt2(i,j,4)*2-1)*12,
    z:j*FEAT_SZ+hashAt2(i,j,3)*16,
    amp:kind==='roller'?0.9+sizeR*1.6:1.3+sizeR*2.6,
    len:kind==='roller'?11+sizeR*7:7+sizeR*7,
    wid:kind==='hip'?5.5+sizeR*3:6.5+sizeR*4.5
  };
}
// height contributed by one feature at (x,z), plus nothing outside its box
function featH(f,x,z){
  const dx=Math.abs(x-f.x);
  if(dx>f.wid)return 0;
  const lat=1-(dx/f.wid)*(dx/f.wid);           // smooth lateral falloff
  const latW=lat*lat;
  if(f.kind==='roller'){
    const dz=(z-f.z)/f.len;
    if(Math.abs(dz)>1)return 0;
    const t=1-dz*dz;
    return f.amp*t*t*latW;
  }
  // CLIFF — a face to send. The ground drops away over a couple of metres and
  // then climbs back over the remaining thirty, so what you ride is a steep
  // drop followed by a flat run-out. It has to return to zero because features
  // are summed locally; a permanent step would tear at the cell boundary. The
  // long, gentle return is shallower than the mountain itself, so it just reads
  // as the slope easing off after the landing.
  if(f.kind==='cliff'){
    const u=(z-f.z)/f.len;
    if(u<0||u>1)return 0;
    const face=smooth(clamp((u-0.15)/0.10,0,1));   // the drop, ~4 m of run
    const back=smooth(clamp((u-0.40)/0.60,0,1));   // the long way back up
    return -f.amp*(face-back)*latW;
  }
  // kicker / hip: ramp whose slope INCREASES to the lip, then falls away.
  // The cliff at u=1 is the lip — that discontinuity is what launches you.
  const u=(z-f.z)/f.len;
  if(u<0||u>1)return 0;
  return f.amp*Math.pow(u,1.7)*latW;
}
// rolling ground texture so the run is never billiard-flat
function rollH(x,z){
  return 0.34*Math.sin(z*0.077+x*0.031)+0.22*Math.sin(z*0.031-x*0.058)
        +0.13*Math.sin(x*0.11+z*0.017);
}
// Gullies: in places the mountain funnels into a trough with walls rising at
// the sides, and in places it opens out flat again. Riding the wall of one is
// the most interesting line on the hill, so they fade in and out along z.
function gullyH(x,z){
  const env=Math.sin(z/97)*0.5+0.5;
  const amt=Math.max(0,env-0.42)/0.58;
  if(amt<=0)return 0;
  const t=clamp(x/17,-1.5,1.5);
  return amt*3.4*t*t;
}
function terrainH(x,z){
  let h=baseY(z)+rollH(x,z)+gullyH(x,z);
  const i0=Math.round(x/FEAT_SX), j0=Math.round(z/FEAT_SZ);
  for(let i=i0-1;i<=i0+1;i++)
    for(let j=j0-1;j<=j0+1;j++){
      const f=featureAt(i,j);
      if(f)h+=featH(f,x,z);
    }
  return h;
}

// ── props: snow-covered rocks and trees, also hash-placed ──
// Props are on a 2-D grid too, so glades and boulder fields exist wherever you
// ride. Cells near the fall line are thinned out so there is always a line
// through, rather than a wall of trees at x=0.
// Density matters more than it looks: at one prop per ~99 m2 a rider carving
// across the hill spent 35 seconds of every 60 sitting in the snow. These
// numbers give glades you can actually pick a line through.
const PROP_SX=15, PROP_SZ=13;
function propAt(i,j){
  const x0=i*PROP_SX, z0=j*PROP_SZ;
  const r=hashAt2(i,j,11);
  // Keep a genuinely rideable corridor. At 14% density inside 7 m the rider met
  // a tree roughly every 60 m and spent the run crashing instead of riding.
  const nearLine=Math.abs(x0)<11;
  if(r<(nearLine?0.95:0.62))return null;
  const isTree=hashAt2(i,j,14)<0.62;
  const s=0.7+hashAt2(i,j,15)*0.9;
  return{x:x0+(hashAt2(i,j,12)*2-1)*4, z:z0+hashAt2(i,j,16)*6,
         tree:isTree, s, r:isTree?0.7*s:0.9*s};
}

// ═══════════════════ RIDER ═══════════════════
// Position is the board's contact point. `y` is world height; on the snow it
// tracks terrainH, in the air it is integrated ballistically.
const R={
  x:0, z:0, y:0,
  v:8,                            // speed along the surface, m/s
  vy:0,
  yaw:0,                          // where the board points
  drift:0,                        // heading of travel; lags yaw on a carve
  edge:0,                         // -1 toe .. +1 heel
  air:false, airT:0,
  q:[1,0,0,0],                    // body orientation
  L:[0,0,0],                      // WORLD angular momentum — set at the lip,
                                  // conserved in the air, never added to
  w:[0,0,0],                      // derived ω = I⁻¹L, for display only
  wind:0, windF:0, windC:0,       // coils loaded on the ground: spin/flip/cork
  spin:0, flip:0, dist:0,
  sw:0,                           // 0 or PI — riding switch, as a render offset
  jib:null,                       // the prop you are currently riding along
  skid:0,                         // 0 = railed carve, >0 = washing out
  press:0,                        // nose-up tail press, from leaning back
  shake:0,                        // impact shake, decays
};
// A snowboarder rides SIDEWAYS. The body model is built with the board's
// long axis along local X, so the whole rider is turned a quarter turn to
// put the board along the direction of travel — which leaves the shoulders
// across the fall line, where a snowboarder's actually are.
const STANCE=-Math.PI/2;

let landCrouch=0, lastBand='', bandT=0, best=0, crashT=0;

// ═══════════════════ INPUT ═══════════════════
const K={};
const IN={steer:0,flip:0,cork:0,lean:0,grab:false,grabL:false,grabR:false};
addEventListener('keydown',e=>{
  if(e.code==='Space')e.preventDefault();
  if(!K[e.code]&&e.code==='Space')ollie();
  K[e.code]=true;
  if(e.code==='KeyR')reset();
});
addEventListener('keyup',e=>{K[e.code]=false;});
let touchSteer=null,touchGrab=false,touchFlip=false,touchLean=0,touchX0=0;
// Flip and cork get their OWN keys. They used to share W/S with tuck and
// brake, which meant the only way to set a flip was to be braking at the exact
// instant of takeoff — the two intents fought each other and flips were
// effectively unreachable.
function readInput(){
  const L=K.ArrowLeft||K.KeyA, Rt=K.ArrowRight||K.KeyD;
  IN.steer=(Rt?1:0)-(L?1:0);
  if(touchSteer!==null)IN.steer=touchSteer;
  IN.flip=(K.ArrowUp?1:0)-(K.ArrowDown?1:0)+(touchFlip?1:0);
  IN.cork=(K.KeyE?1:0)-(K.KeyQ?1:0);
  // LEAN, not tuck-and-brake. Forward puts weight on the nose and drives the
  // board; back lifts the nose into a tail press and scrubs speed. It is one
  // axis because on a board it IS one axis — where your weight is.
  IN.lean=(K.KeyW?1:0)-(K.KeyS?1:0)+(touchLean||0);
  // Which shift, which hand. The pose library says grabL for Indy and grabR
  // for Mute, so the two map straight onto the two keys.
  IN.grabL=!!K.ShiftLeft||touchGrab;
  IN.grabR=!!(K.ShiftRight||K.KeyG);
  IN.grab=IN.grabL||IN.grabR;
}
// Steering follows ONE pointer, and only while it is genuinely held down.
// Tracking merely "did a pointerdown happen" meant a mouse that had clicked
// once kept steering on every later move — the board wandered off the fall
// line and ended up riding back up the hill with no input at all.
let steerPtr=null;
// ── CARVE PAD ───────────────────────────────────────────────────────────
// An absolute pad, not a drag-from-wherever-you-touched gesture: your thumb
// lands somewhere on it and that position IS the edge angle, so you can go
// straight from a hard toe carve to a hard heel carve without lifting off.
// Dragging the 3D view for this was worse in two ways — it hid the run under
// your hand, and it stole the tap that should just make you jump.
const pad=$('pad'), padThumb=$('padThumb'), padCoil=$('padCoil');
let padPtr=null;
// The pad is two axes, because a snowboard is: across is your EDGE, up and
// down is your WEIGHT. Thumb forward drives the nose, thumb back lifts it into
// a press. One thumb, both controls, no extra button.
function padSet(e){
  const r=pad.getBoundingClientRect();
  touchSteer=clamp((e.clientX-(r.left+r.width/2))/(r.width*0.42),-1,1);
  touchLean =clamp(((r.top+r.height/2)-e.clientY)/(r.height*0.38),-1,1);
}
pad.addEventListener('pointerdown',e=>{
  e.preventDefault();padPtr=e.pointerId;padSet(e);
  if(pad.setPointerCapture)try{pad.setPointerCapture(e.pointerId);}catch(_){}
},{passive:false});
pad.addEventListener('pointermove',e=>{
  if(padPtr!==e.pointerId)return;
  if(e.pointerType==='mouse'&&!(e.buttons&1)){padEnd();return;}
  padSet(e);
},{passive:false});
const padEnd=()=>{padPtr=null;touchSteer=null;touchLean=0;};
pad.addEventListener('pointerup',padEnd);
pad.addEventListener('pointercancel',padEnd);

// Tap the snow to pop. The stage is the biggest target on the screen and the
// thumb is often already there, so the most common action gets the easiest
// gesture. It no longer steers, so a tap can mean exactly one thing.
canvas.addEventListener('pointerdown',e=>{e.preventDefault();ollie();},{passive:false});

// hold-to-load / hold-to-grab, with pointer capture so a thumb that slides off
// the button still counts as held — losing a grab mid-flight because your
// thumb drifted 3 px is not a skill test
function holdBtn(el,on,off){
  el.addEventListener('pointerdown',e=>{
    e.preventDefault();e.stopPropagation();on();
    if(el.setPointerCapture)try{el.setPointerCapture(e.pointerId);}catch(_){}
  },{passive:false});
  el.addEventListener('pointerup',e=>{e.stopPropagation();off();});
  el.addEventListener('pointercancel',off);
}
holdBtn($('grabBtn'),()=>{touchGrab=true;},()=>{touchGrab=false;});
holdBtn($('flipBtn'),()=>{touchFlip=true;},()=>{touchFlip=false;});
$('ollieBtn').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();ollie();},{passive:false});
$('resetBtn').addEventListener('click',e=>{e.stopPropagation();reset();});
// controls sheet
$('helpBtn').addEventListener('click',e=>{e.stopPropagation();
  document.body.classList.toggle('showhelp');});
$('helpClose').addEventListener('click',e=>{e.stopPropagation();
  document.body.classList.remove('showhelp');
  try{localStorage.setItem('freeride.seen','1');}catch(_){}});
// play.html#controls opens straight to the controls — handy for linking
// someone to "how do I spin" without making them find the button
if(location.hash==='#controls')document.body.classList.add('showhelp');
// First run opens the sheet once. The coil mechanic is not discoverable by
// experiment — a new player mashes the air controls, nothing happens, and they
// conclude the game is broken rather than that they needed to wind up first.
// Flagged on OPEN, not on dismiss: otherwise reloading the page shows the
// whole sheet again to someone who has already read it.
else{ try{ if(!localStorage.getItem('freeride.seen')){
  document.body.classList.add('showhelp');
  localStorage.setItem('freeride.seen','1');
} }catch(_){} }

// ═══════════════════ RIDE PHYSICS ═══════════════════
// Drag sets terminal speed, and terminal speed is what makes a grade mean
// something: with it too low the black pitches ran to 104 km/h, faster than
// anyone actually rides. At 0.009 a blue settles near 50 km/h and a black
// near 88 — the difference you can feel between the two.
const POP=4.4, DRAG=0.0090, EDGE_SCRUB=3.0, BRAKE=9.0;
// Ceiling on how hard any lip can throw you. 8.4 m/s is a big, real jump:
// about 3.6 m up and ~1.7 s of hang on flat ground. It reads as more than that
// here because the slope keeps dropping away underneath you, which is exactly
// how a real landing works — but the LAUNCH itself is now bounded.
const LAUNCH_MAX=8.4;
// A carve is a RADIUS, not a spin rate: yaw rate = v / radius. Driving yaw at
// a fixed rad/s made the board pivot like a turntable — full edge produced a
// 4 m circle and the rider never got down the hill.
const CARVE_R=17;                 // metres at full edge
// No heading clamp. You can turn all the way round and ride back up if you
// want to — gravity is taken from the local slope, so climbing simply bleeds
// speed until you stop, which is the honest outcome rather than an invisible
// wall at 66 degrees.
// Free ride is deliberately more forgiving than the daily challenge. That one
// is a puzzle you are meant to get exactly right; this is somewhere to mess
// about, and being punished for 15 degrees of drift just stops the run.
const CFG=defaultConfig({stompDeg:24,sketchDeg:48,washDeg:78});

// ── TAKEOFF: the only moment rotation is created ──────────────────────────
// You cannot torque yourself in mid-air; there is nothing to push against.
// Every bit of rotation comes from the ground, so it is set ONCE here, from
// the coil you wound up on the approach plus the yaw the carve already had.
// After this L is constant until you touch down again.
const WIND_REV=0.95, CARVE_REV=0.22, FLIP_REV=1.15, CORK_REV=0.95;
function takeoff(){
  const parts=partsFromPose(currentPose());
  const I=bodyInertia(parts).I;
  // body axes: board runs along X, up is Y, across the board is Z
  const spin=(R.wind*WIND_REV+R.edge*CARVE_REV)*TAU;   // yaw, about Y
  const flip=R.windF*FLIP_REV*TAU;                     // over the nose, about Z
  const cork=R.windC*CORK_REV*TAU;                     // along the board, about X
  R.L=qRot(R.q,mv3(I,[cork,spin,flip]));
  R.wind*=0.12;R.windF*=0.12;R.windC*=0.12;   // the coils are spent
  R.spin=0;R.flip=0;R.airT=0;
}
function ollie(){
  if(R.air||crashT>0)return;
  R.air=true;R.vy+=POP;R.y+=0.02;
  takeoff();
}
function reset(){
  R.x=0;R.z=0;R.v=8;R.vy=0;R.yaw=0;R.drift=0;R.edge=0;
  R.air=false;R.airT=0;R.q=[1,0,0,0];R.L=[0,0,0];R.w=[0,0,0];
  R.wind=0;R.windF=0;R.windC=0;R.spin=0;R.flip=0;R.dist=0;R.sw=0;R.jib=null;
  HOOK.reset();
  R.y=terrainH(0,0);landCrouch=0;lastBand='';bandT=0;crashT=0;
}

function stepRide(dt){
  // ── JIBBING. While you are on top of something, THAT is the ground: flat,
  // at the crown's height, no terrain following and no launch test. Ride off
  // the edge of it and you are simply in the air, which is how a jib turns
  // into a drop and then a landing.
  if(R.jib&&!R.air&&crashT<=0){
    readInput();
    R.edge=lerp(R.edge,IN.steer,1-Math.exp(-9*dt));
    R.yaw+=R.edge*(Math.max(R.v,3)/CARVE_R)*dt;
    R.drift=lerp(R.drift,R.yaw,1-Math.exp(-7*dt));
    R.v=Math.max(1.5,R.v-1.4*dt);            // a little drag along the top
    R.x+=Math.sin(R.drift)*R.v*dt;
    R.z+=Math.cos(R.drift)*R.v*dt;
    R.y=R.jib.top;R.vy=0;
    const jx=R.x-R.jib.x, jz=R.z-R.jib.z;
    if(jx*jx+jz*jz>R.jib.r*R.jib.r){          // rode off the end of it
      R.jib=null;R.air=true;R.airT=0;R.vy=0;
      takeoff();
    }
    R.q=groundQ();
    R.dist=Math.max(R.dist,R.z);
    if(hitCool>0)hitCool-=dt;
    if(R.shake>0)R.shake=Math.max(0,R.shake-2.6*dt);
    return;
  }
  if(crashT>0){                       // sitting in the snow after a crash
    crashT-=dt;R.v=Math.max(0,R.v-6*dt);
    R.x+=Math.sin(R.drift)*R.v*dt;R.z+=Math.cos(R.drift)*R.v*dt;
    R.y=terrainH(R.x,R.z);
    if(crashT<=0){
      // point back down the hill and get going again, so a crash costs you
      // time and speed rather than ending the run
      R.yaw=Math.round(R.yaw/TAU)*TAU;R.drift=R.yaw;
      R.v=Math.max(5,R.v);landCrouch=0.5;
    }
    R.q=groundQ();
    return;
  }
  if(!R.air){
    R.edge=lerp(R.edge,IN.steer,1-Math.exp(-9*dt));
    const carve=Math.abs(R.edge);
    // ── GRIP. An edge can only hold so much cornering force. Demand more than
    // it has and the board washes out into a skid: it still points where you
    // steered, but it stops going there, scrubs speed and throws snow.
    //
    // The trade the rider actually makes is speed against turn — a carve you
    // can hold at 30 km/h will let go at 70 — so grip is compared against the
    // lateral acceleration the turn is asking for, v * yawRate.
    const aLat=Math.abs(R.v*R.edge*(Math.max(R.v,3)/CARVE_R));
    const grip=G*(0.42+0.80*carve)*(1-0.22*Math.max(0,IN.lean<0?-IN.lean:0));
    R.skid=lerp(R.skid,clamp(aLat/Math.max(0.1,grip)-1,0,2.5),1-Math.exp(-8*dt));
    // Gravity comes from the slope ACTUALLY under the board, sampled from the
    // same terrain function that draws the snow — so a black-diamond pitch
    // really does accelerate you harder than a blue one, and a roller robs
    // speed on the way up. A fixed G*sin(SLOPE) could not do either.
    const ds=Math.max(0.6,R.v*dt);
    const hHere=terrainH(R.x,R.z);
    const hAhead=terrainH(R.x+Math.sin(R.drift)*ds,R.z+Math.cos(R.drift)*ds);
    const theta=Math.atan(-(hAhead-hHere)/ds);      // + descending, - climbing
    let a=G*Math.sin(theta)-DRAG*R.v*R.v-EDGE_SCRUB*carve*carve;
    // A railed carve costs little; a skid costs a lot. That IS the trade —
    // ask for more turn than the edge can hold and you pay for it in speed.
    a-=R.skid*5.2;
    // lean: forward drives the board, back scrubs into a tail press
    a+=IN.lean>0?1.6*IN.lean:BRAKE*0.62*IN.lean;
    // Let it actually stall. The floor of 0.8 m/s meant a rider who ran out of
    // speed part-way up a rise was still shoved forward over it — the hill
    // stopped mattering. Now you can come to a genuine standstill; the
    // slip-to-the-fall-line below then turns the board downhill and gravity
    // does the rest, so stopping costs you time without stranding you.
    R.v=Math.max(0,R.v+a*dt);
    R.press=lerp(R.press,IN.lean<0?-IN.lean:0,1-Math.exp(-7*dt));
    R.yaw+=R.edge*(Math.max(R.v,3)/CARVE_R)*dt;
    // You cannot hold a traverse at walking pace — the board slips round to
    // the fall line. Without this, removing the heading clamp let you carve
    // all the way uphill, stall at zero, and stay there facing up the hill
    // with no way to recover.
    if(R.v<2.6){
      const down=Math.round(R.yaw/TAU)*TAU;      // nearest downhill heading
      R.yaw=lerp(R.yaw,down,Math.min(1,2.2*dt*(2.6-R.v)/2.6));
    }
    // A carve makes travel follow the board almost at once. A skid does not:
    // the board points one way and you keep sliding the other, which is what
    // washing out actually looks and feels like.
    R.drift=lerp(R.drift,R.yaw,1-Math.exp(-(7/(1+2.6*R.skid))*dt));
    if(R.skid>0.12&&R.v>5)HOOK.spray(R.skid>0.6?3:1,2.0+R.skid*2.4,1.3);
    else if(carve>0.45&&R.v>9)HOOK.spray(1,1.1,0.7);

    const h0=terrainH(R.x,R.z);
    R.x+=Math.sin(R.drift)*R.v*dt;
    R.z+=Math.cos(R.drift)*R.v*dt;
    const h1=terrainH(R.x,R.z);
    const vyT=(h1-h0)/dt;                     // vertical rate of the snow itself
    // Would following the ground require falling faster than gravity? If the
    // terrain drops away harder than a free body would, you have left it.
    // WIND UP, on three axes. Holding an edge coils the torso for a SPIN; the
    // flip and cork keys load those axes the same way. All of it is set up on
    // the ground because none of it can be created in the air.
    //
    // They decay slowly rather than instantly, which doubles as the buffer for
    // a kicker you did not see coming: load a flip, and it is still there a
    // second later when the lip arrives.
    R.wind =clamp(R.wind +IN.steer*1.15*dt,-1,1);
    R.windF=clamp(R.windF+IN.flip *1.45*dt,-1,1);
    R.windC=clamp(R.windC+IN.cork *1.45*dt,-1,1);
    if(IN.steer===0)R.wind -=R.wind *Math.min(1,1.6*dt);
    if(IN.flip ===0)R.windF-=R.windF*Math.min(1,0.8*dt);
    if(IN.cork ===0)R.windC-=R.windC*Math.min(1,0.8*dt);

    // ── UNIVERSAL LAUNCH TEST ────────────────────────────────────────────
    // Two earlier versions were wrong in opposite directions. Looking one
    // SUB-STEP ahead made the lookahead depend on frame rate and speed, so the
    // same lip released you at 60 km/h but not at 20 and cliff rollovers slipped
    // through. Looking a fixed TIME ahead fired constantly on gentle rolls and
    // produced a stutter of hundredth-of-a-second hops.
    //
    // The real criterion is not a height comparison at all, it is CURVATURE.
    // To stay on the snow the board must accelerate downward at
    //     a = (d2h/ds2) * v^2
    // and the only thing pushing it down is gravity. The moment the surface
    // needs more than g, contact is impossible and you are off it — at any
    // speed, on any feature, with no magic numbers. A gentle roll has tiny
    // curvature and holds you; a kicker lip or a cliff edge does not.
    // Sample the curvature over a distance that scales with speed. At a fixed
    // 1.1 m a rider doing 80 km/h steps most of the way across the window in a
    // single frame and can miss a cliff edge entirely.
    const dsC=clamp(R.v*0.09,0.9,2.6);
    const sD=Math.sin(R.drift), cD=Math.cos(R.drift);
    const hB2=terrainH(R.x-sD*dsC,R.z-cD*dsC);
    const hF2=terrainH(R.x+sD*dsC,R.z+cD*dsC);
    const curv=(hF2-2*h1+hB2)/(dsC*dsC);        // d2h/ds2 along the path
    const slope=(hF2-hB2)/(2*dsC);              // dh/ds along the path
    // Curvature says contact is IMPOSSIBLE; it does not say the result is a
    // jump. Over rippled snow the board is briefly unsupported hundreds of
    // times a minute and simply skims — chasing every one of those produced
    // 406 hundredth-of-a-second hops in five minutes. So also require the arc
    // to actually clear the snow by a hand's width an eighth of a second later.
    // Ripples fail that; lips and cliff edges pass it easily.
    let leaving=false;
    if(curv*R.v*R.v < -G){
      const T=0.12;
      const arc=h1+slope*R.v*T-0.5*G*T*T;
      const ahead=terrainH(R.x+sD*R.v*T,R.z+cD*R.v*T);
      leaving=(arc-ahead)>0.08;
    }
    if(leaving){
      R.air=true;
      // CLAMP THE LAUNCH. vyT is the terrain's own vertical rate, and terrain
      // is a SUM of overlapping features — on the 2-D cell grid two kickers can
      // land in the same place and stack into a slope no real ramp has, which
      // is what fired the rider into the sky. A big lip gives 6-9 m/s off the
      // top; nothing on this mountain should give more.
      // leave at the speed you were already travelling along the surface
      R.vy=clamp(slope*R.v,-16,LAUNCH_MAX);
      R.y=h1;
      takeoff();                    // a lip sets rotation the same way a pop does
    }else{
      R.y=h1;R.vy=vyT;
    }
    landCrouch=Math.max(0,landCrouch-dt);
    // Orientation is part of the simulation, not a rendering detail: takeoff()
    // reads R.q to build the angular momentum, so if the render loop owned it
    // the launch used the PREVIOUS frame's attitude — and a kicker that fires
    // mid-step launched off an identity quaternion entirely.
    if(!R.air)R.q=groundQ();
  }else{
    R.airT+=dt;
    // ── CONSERVED ROTATION ──────────────────────────────────────────────
    // L is fixed. What you control is the moment of inertia: tuck or grab and
    // I falls, so ω = I⁻¹L rises and you spin FASTER for the same momentum;
    // sprawl out and you slow down. That is the whole of mid-air control, and
    // it is why a rider grabs to bring a spin round and opens up to check it.
    const parts=partsFromPose(currentPose());
    const Lb=qRotInv(R.q,R.L);                 // momentum in body axes
    const wb=mv3(inv3(bodyInertia(parts).I),Lb);
    R.w=wb;
    R.q=qStep(R.q,qRot(R.q,wb),dt);

    // ── SPOTTING THE LANDING ────────────────────────────────────────────
    // A real rider does not fly as a free rigid body all the way to the snow.
    // They pick out the landing, check the rotation and set the board down.
    // Without any of that the board arrives at whatever angle the tumble left
    // it — which is why the rotation felt arbitrary rather than skilful.
    //
    // Only engages on the way down and close to the ground, and only bleeds
    // rotation toward square; it will never ADD a rotation you did not throw.
    const drop=R.y-terrainH(R.x,R.z);
    if(R.vy<0&&drop<9){
      const tLand=drop/Math.max(1,-R.vy);
      // Tuned to CLOSE a landing, not to hand you one. Turn it up and every
      // trick stomps regardless of what you threw, which makes the grade
      // meaningless; turn it off and the tumble decides for you. This much
      // rescues a near miss and leaves a badly judged rotation still messy.
      if(tLand<0.60){
        const k=clamp(1-tLand/0.60,0,1);
        const bleed=Math.min(1,3.4*k*dt);
        for(let i=0;i<3;i++)R.L[i]*=(1-bleed);   // check the spin
        R.q=qSlerp(R.q,squareQ(),Math.min(1,3.2*k*k*dt));
      }
    }
    R.spin+=Math.abs(wb[1])/TAU*dt;            // revolutions of yaw
    R.flip+=Math.abs(wb[2])/TAU*dt;            // revolutions over the nose
    // Slightly heavier than gravity in flight. This is a deliberate game-feel
    // choice, not physics: on a slope this steep an honest parabola glides for
    // seconds because the mountain falls away almost as fast as you do. 1.18x
    // brings hang time back to what riding actually feels like without
    // touching the launch, the rotation or the landing.
    R.vy-=G*1.22*dt;
    R.y+=R.vy*dt;
    R.x+=Math.sin(R.drift)*R.v*dt;
    R.z+=Math.cos(R.drift)*R.v*dt;
    // Hysteresis on touchdown. Without it a launch that clears the snow by a
    // few centimetres re-contacts on the very next step and relaunches, and the
    // rider judders down the hill in a blur of hundredth-second hops instead of
    // either riding or flying. Once committed to the air, stay there briefly.
    const g=terrainH(R.x,R.z);
    // Note it does NOT prop the rider up — forcing vy upward here added energy
    // and doubled hang time. It only defers the landing decision; the arc is
    // untouched.
    if(R.y<=g){ if(R.airT>0.06){R.y=g;land();} else R.y=g; }
  }
  R.dist=Math.max(R.dist,R.z);
  if(hitCool>0)hitCool-=dt;
  if(R.shake>0)R.shake=Math.max(0,R.shake-2.6*dt);
  if(!R.air&&crashT<=0)HOOK.trail();
  hitProps();
}

// Landing is graded by the ENGINE's thresholds, so free ride and the daily
// game agree on what a stomp is.
// How far the board is from square with the direction of travel, in degrees.
//
// This used to grade on R.spin — the integral of |omega_y| — which is the
// TOTAL rotation travelled, not where the board ended up. Spin up and back and
// that integral is large while the board is dead straight; it graded honest
// landings as crashes and vice versa. Read the actual orientation instead.
// Landing switch (180 deg out) is a real landing, so squareness is measured to
// the nearest half turn.
function boardOffSquare(){
  const dir=qRot(R.q,[1,0,0]);                 // board's long axis, world
  const head=Math.atan2(dir[0],dir[2]);
  let d=(head-R.drift)*180/Math.PI;
  d=((d%180)+270)%180-90;                      // fold onto -90..90
  return Math.abs(d);
}
function land(){
  R.air=false;
  const off=boardOffSquare();
  const band=off<=CFG.stompDeg?'stomp':off<=CFG.sketchDeg?'sketchy'
            :off<=CFG.washDeg?'wash-out':'crash';
  lastBand=band;bandT=1.5;
  // a bad landing should cost you speed and style, not end the run
  R.v=Math.max(3.5,R.v*({stomp:1,'sketchy':0.94,'wash-out':0.8,crash:0.55})[band]);
  if(band!=='crash'&&R.spin>0.2){
    const score=Math.round(R.spin*360/90)*90;
    if(score>best)best=score;
  }
  if(band==='crash')crashT=0.75;
  buzz(band==='stomp'?18:band==='sketchy'?[12,40,12]:band==='wash-out'?55:[30,60,90]);
  // landing throws snow — more of it the harder you come down
  HOOK.spray(band==='stomp'?6:12,1.6+Math.min(6,-R.vy*0.30),1.5);
  R.shake=Math.min(1,Math.max(R.shake,(band==='crash'?0.7:0.28)));
  // The track begins again HERE. Skipping samples while airborne was not
  // enough: the ribbon is one continuous strip, so the quad joining the last
  // sample before the lip to the first one after it drew a plank of compressed
  // snow straight across the gap, through mid-air. Starting a fresh strip at
  // the landing is both correct and what you actually want to see.
  HOOK.trailBreak(R.x,R.z);
  // Land switch and you STAY switch — carried as a render offset so the board
  // does not visibly snap through 180 degrees the instant you touch down.
  // NORMALISE FIRST. R.drift accumulates without bound (there is no heading
  // clamp any more), while atan2 returns -PI..PI. Subtracting them gave values
  // like -9 rad, and rounding THAT to the nearest half turn flipped the stance
  // essentially at random — which is why the rider kept spontaneously landing
  // switch. Fold the difference into -PI..PI before deciding anything.
  const dir=qRot(R.q,[1,0,0]);
  let rel=Math.atan2(dir[0],dir[2])-R.drift;
  rel=Math.atan2(Math.sin(rel),Math.cos(rel));
  if(Math.abs(rel)>Math.PI/2)R.sw=(R.sw+Math.PI)%(2*Math.PI);
  // touching down is what kills the rotation — the snow takes the momentum
  R.yaw=R.drift;R.L=[0,0,0];R.w=[0,0,0];R.vy=0;
  R.spin=0;R.flip=0;R.wind=0;R.windF=0;R.windC=0;
  landCrouch=band==='crash'?1.0:0.42;
}

let hitCool=0;
function hitProps(){
  // Below walking pace there is no impact to have — and without this guard a
  // rider who stops inside a tree's radius re-triggers the collision every
  // frame, pinning speed at zero forever with no way out. hitCool then keeps
  // it from firing again while you are still sliding past the same trunk.
  if(crashT>0||hitCool>0||R.v<3)return;
  const i0=Math.round(R.x/PROP_SX), j0=Math.round(R.z/PROP_SZ);
  for(let i=i0-1;i<=i0+1;i++)for(let j=j0-1;j<=j0+1;j++){
    const p=propAt(i,j);if(!p)continue;
    const dx=R.x-p.x,dz=R.z-p.z;
    const rr=p.r+0.5;
    if(dx*dx+dz*dz>=rr*rr)continue;
    const base=terrainH(p.x,p.z);
    const top=base+(p.tree?3.4:1.1)*p.s;
    // JIB. Come down onto the TOP of a tree or a boulder and you bonk it
    // rather than hit it: the board taps the crown, you get a little pop and
    // ride away with most of your speed. Only counts from above and on the way
    // down — clipping the trunk at chest height is still a hit.
    if(R.air&&R.vy<0&&R.y>top-0.55){
      // You LAND on it and ride it. A jib is a surface, not a springboard —
      // popping the rider upward was the wrong verb entirely. Contact sets the
      // board down on the crown and holds it there; you glide across and drop
      // off the far side, which is where the air (and the landing) comes from.
      R.jib={x:p.x,z:p.z,r:p.r+0.55,top};
      R.air=false;R.vy=0;R.y=top;
      R.v*=0.97;                       // barely any cost — it is a smooth ride
      lastBand='jib!';bandT=1.1;
      hitCool=0.35;
      HOOK.spray(5,1.4,1.0);
      buzz(10);
      return;
    }
    if(R.y<top){
      // You clipped something — you did not die. The run continues: a hard
      // knock, a shove off line, snow everywhere and a shaken camera, but you
      // ride out of it. Stopping the world dead for a second was the single
      // most run-ending thing in here.
      lastBand='clipped!';bandT=1.1;
      R.v=Math.max(4.5,R.v*0.62);
      R.yaw+=(dx>0?1:-1)*0.30;              // knocked off your line
      R.shake=Math.min(1,0.55+R.v*0.02);
      R.skid=Math.max(R.skid,1.1);
      landCrouch=Math.max(landCrouch,0.42);
      hitCool=0.6;                          // no re-hit while you slide past
      HOOK.spray(14,3.4,2.4);
      buzz([25,35,25]);
      return;
    }
  }
}

function qStep(q,w,dt){
  const h=qMul(q,[0,w[0],w[1],w[2]]);
  return qNorm([q[0]+0.5*h[0]*dt,q[1]+0.5*h[1]*dt,q[2]+0.5*h[2]*dt,q[3]+0.5*h[3]*dt]);
}
function qAxis(ax,ang){
  const s=Math.sin(ang/2);
  return[Math.cos(ang/2),ax[0]*s,ax[1]*s,ax[2]*s];
}
// grounded orientation: point along travel, pitch onto the snow, bank into
// the carve, then the quarter-turn that makes it a snowboard stance
// The orientation the board WANTS on touchdown: square to travel (or switch,
// whichever is nearer), pitched onto the snow, no bank.
function squareQ(){
  const dir=qRot(R.q,[1,0,0]);
  const head=Math.atan2(dir[0],dir[2]);
  const rel=head-R.drift;
  const snap=Math.round(rel/Math.PI)*Math.PI;      // nearest half turn
  const eps=1.2;
  const hF=terrainH(R.x+Math.sin(R.drift)*eps,R.z+Math.cos(R.drift)*eps);
  const hB=terrainH(R.x-Math.sin(R.drift)*eps,R.z-Math.cos(R.drift)*eps);
  let q=qAxis([0,1,0],R.drift+snap);
  q=qMul(q,qAxis([1,0,0],Math.atan2(hF-hB,2*eps)));
  q=qMul(q,qAxis([0,1,0],STANCE));
  return qNorm(q);
}
function groundQ(){
  const eps=1.2;
  const hF=terrainH(R.x+Math.sin(R.drift)*eps,R.z+Math.cos(R.drift)*eps);
  const hB=terrainH(R.x-Math.sin(R.drift)*eps,R.z-Math.cos(R.drift)*eps);
  // Terrain pitch, plus where the rider's weight is. Leaning forward drops the
  // nose onto the snow; leaning back lifts it into a press. Switch flips which
  // end of the board is the nose, so the tilt has to flip with it.
  const swSign=Math.cos(R.sw)>=0?1:-1;
  const pitch=Math.atan2(hF-hB,2*eps)
             +swSign*(IN.lean>0?-0.09*IN.lean:0.34*R.press);
  let q=qAxis([0,1,0],R.yaw+R.sw);
  q=qMul(q,qAxis([1,0,0],pitch));
  q=qMul(q,qAxis([0,0,1],-R.edge*0.40));
  q=qMul(q,qAxis([0,1,0],STANCE));
  return qNorm(q);
}

// ═══════════════════ POSE (from the shared library) ═══════════════════
function currentPose(){
  let base=poseOf('Athletic stance');
  if(crashT>0){
    base=poseOf('Sprawl');
  }else if(landCrouch>0){
    base=blendPose(poseOf('Landing crouch'),base,1-clamp(landCrouch/0.6,0,1));
  }else if(R.air){
    // These pose choices are not cosmetic: they change the inertia tensor,
    // which is the only thing that can change a rotation RATE once you are in
    // the air. Measured from the shared pose library:
    //
    //   stance  Ixx 15.75  Iyy 4.02  Izz 18.48
    //   grab    Ixx  5.04  Iyy 5.10  Izz  6.58
    //   sprawl  Ixx 16.59  Iyy 5.80  Izz 19.96
    //
    // So a grab does NOT speed up a flat spin — folding over moves mass away
    // from the vertical axis and yaw actually slows slightly. What it collapses
    // is the flip and cork axes, ~3x, which is why a rider tucks to bring a
    // corked rotation round. Yaw is fastest standing tall; sprawling checks it.
    // Which hand you press is which hand grabs: the library stores Indy as a
    // LEFT-hand grab (grabL) and Mute as a RIGHT-hand one (grabR), so the two
    // shift keys map straight onto them instead of both doing the same thing.
    if(IN.grabL)      base=blendPose(base,poseOf('Indy grab'),0.92);
    else if(IN.grabR) base=blendPose(base,poseOf('Mute grab'),0.92);
    else if(IN.lean>0)base=blendPose(base,poseOf('Tuck'),0.8);
    else if(IN.lean<0)base=blendPose(base,poseOf('Sprawl'),0.75);
  }else if(IN.lean>0){
    base=blendPose(poseOf('Athletic stance'),poseOf('Tuck'),0.85*IN.lean);
  }else if(R.press>0.05){
    // weight back over the tail — the body sits back as the nose comes up
    base=blendPose(poseOf('Athletic stance'),poseOf('Counter-rotate'),0.3*R.press);
  }else if(Math.abs(R.wind)>0.05){
    // show the coil: the torso winds against the board before it unwinds
    base=blendPose(base,poseOf(R.wind>0?'Wind-up':'Counter-rotate'),
                   Math.min(0.85,Math.abs(R.wind)));
  }
  return resolvePose(base);
}

// ═══════════════════ HUD ═══════════════════
function updHUD(){
  $('spd').textContent=(R.v*3.6).toFixed(0);
  $('air').textContent=R.air?R.airT.toFixed(2):'—';
  $('spin').textContent=(R.spin*360).toFixed(0)+'°';
  $('flipv').textContent=(R.flip*360).toFixed(0)+'°';
  // the coils ARE the setup — none of this can be made in the air
  const c=$('coil');
  if(R.air){
    c.textContent=(Math.abs(R.w[1])/TAU).toFixed(1)+'/'+(Math.abs(R.w[2])/TAU).toFixed(1)+' r/s';
    c.className='mono';
  }else{
    const s=Math.round(Math.abs(R.wind)*100), f=Math.round(Math.abs(R.windF)*100),
          k=Math.round(Math.abs(R.windC)*100), top=Math.max(s,f,k);
    c.textContent=(R.wind>0.02?'R':R.wind<-0.02?'L':'')+s+' ⟳'+f+' ⟲'+k;
    c.className='mono '+(top>60?'grade-red':top>25?'grade-blue':'');
  }
  $('best').textContent=best?best+'°':'—';
  $('dist').textContent=(R.dist/1000).toFixed(2);
  const deg=Math.atan(pitchTan(R.z))*180/Math.PI;
  const gr=gradeOf(deg);
  const ge=$('grade');
  ge.textContent=deg.toFixed(0)+'° '+gr;
  ge.className='mono grade-'+gr;
  const b=$('band');
  if(bandT>0){b.textContent=lastBand;b.className='big '+lastBand;}
  else{b.textContent='';b.className='big';}
  $('grabBtn').classList.toggle('held',IN.grab);
  $('flipBtn').classList.toggle('held',Math.abs(R.windF)>0.03);
  // carve pad: the thumb marks the edge, the bar behind it is the coil, so the
  // one mechanic that decides your trick is visible under your thumb instead
  // of buried in a number at the top of the screen
  const st=(touchSteer!==null?touchSteer:IN.steer);
  padThumb.style.left=(50+st*42)+'%';
  padThumb.style.top=(50-(IN.lean||0)*30)+'%';
  pad.classList.toggle('skidding',R.skid>0.25);
  padCoil.style.width=(Math.abs(R.wind)*50)+'%';
  padCoil.style.transform=R.wind<0?'translateX(-100%)':'none';
  pad.classList.toggle('charged',Math.abs(R.wind)>0.55);
  $('padLbl').textContent=R.air?'IN THE AIR':
    R.skid>0.25?'SKIDDING':
    R.press>0.25?'TAIL PRESS':
    Math.abs(R.wind)>0.05?'COIL '+Math.round(Math.abs(R.wind)*100)+'%':'CARVE · LEAN';
}

// short haptic cues — the one channel a phone has that a desktop does not
function buzz(ms){ try{ if(navigator.vibrate)navigator.vibrate(ms); }catch(_){} }

// ═══════════════════ PUBLIC INTERFACE ═══════════════════
// Renderers read state and call step(); tests drive stepRide directly. The
// accessors exist because these are `let` bindings that change every frame,
// so handing out the value once would hand out a stale copy.
window.Ride={
  R,IN,HOOK,canvas,
  clamp,lerp,smooth,STANCE,
  terrainH,baseY,pitchTan,gradeOf,gullyH,featureAt,propAt,
  hashAt,hashAt2,FEAT_SX,FEAT_SZ,PROP_SX,PROP_SZ,
  stepRide,reset,ollie,takeoff,groundQ,squareQ,boardOffSquare,currentPose,
  readInput,updHUD,buzz,
  band:()=>lastBand, bandTime:()=>bandT, best:()=>best,
  crashTime:()=>crashT, touch:()=>touchSteer,
  // advance the whole simulation by dt, in stable sub-steps
  step(dt){
    if(bandT>0)bandT=Math.max(0,bandT-dt);
    readInput();
    const n=Math.max(1,Math.ceil(dt/0.006));
    for(let i=0;i<n;i++)stepRide(dt/n);
  },
  // play.html#warp<seconds> fast-forwards before the first frame. Headless
  // screenshots otherwise always catch the rider on the start line, which
  // makes anything cumulative — the track especially — impossible to see.
  warpFromHash(){
    const m=/^#warp(\d+)?$/.exec(location.hash);
    if(!m)return 0;
    const secs=Math.min(60,+(m[1]||15));
    for(let i=0;i<secs*120;i++)stepRide(1/120);
    return secs;
  }
};
})();
