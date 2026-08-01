// ═══════════════════════════════════════════════════════════════════════
//  FREE RIDE — an endless mountain you actually steer.
//
//  Shares js/engine.js with the daily game: same body model, same pose
//  library, same landing bands. Nothing about the simulation is duplicated
//  here. This file owns the scene, the controls, and the ride physics the
//  daily game does not need (steering, ollies, procedural terrain).
//
//  Wrapped in an IIFE on purpose. engine.js declares G, TAU and friends at
//  top level, and a second top-level `const G` in another classic script is
//  a redeclaration SyntaxError that would kill the whole page.
// ═══════════════════════════════════════════════════════════════════════
(function(){
"use strict";

const $=id=>document.getElementById(id);
const canvas=$('c');
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,f)=>a+(b-a)*f;
const smooth=t=>t*t*(3-2*t);

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
  const kind=r<0.52?'kicker':r<0.78?'roller':'hip';
  const sizeR=hashAt2(i,j,2);
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
};
// A snowboarder rides SIDEWAYS. The body model is built with the board's
// long axis along local X, so the whole rider is turned a quarter turn to
// put the board along the direction of travel — which leaves the shoulders
// across the fall line, where a snowboarder's actually are.
const STANCE=-Math.PI/2;

let landCrouch=0, lastBand='', bandT=0, best=0, crashT=0;

// ═══════════════════ INPUT ═══════════════════
const K={};
const IN={steer:0,flip:0,cork:0,tuck:false,brake:false,grab:false};
addEventListener('keydown',e=>{
  if(e.code==='Space')e.preventDefault();
  if(!K[e.code]&&e.code==='Space')ollie();
  K[e.code]=true;
  if(e.code==='KeyR')reset();
});
addEventListener('keyup',e=>{K[e.code]=false;});
let touchSteer=null,touchGrab=false,touchFlip=false,touchX0=0;
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
  IN.tuck=!!K.KeyW&&!R.air;
  IN.brake=!!K.KeyS;
  IN.grab=!!(K.ShiftLeft||K.ShiftRight||K.KeyG)||touchGrab;
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
function padSet(e){
  const r=pad.getBoundingClientRect();
  const half=r.width*0.42;
  touchSteer=clamp((e.clientX-(r.left+r.width/2))/half,-1,1);
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
const padEnd=()=>{padPtr=null;touchSteer=null;};
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
const POP=4.9, DRAG=0.0090, EDGE_SCRUB=3.0, BRAKE=9.0;
// A carve is a RADIUS, not a spin rate: yaw rate = v / radius. Driving yaw at
// a fixed rad/s made the board pivot like a turntable — full edge produced a
// 4 m circle and the rider never got down the hill.
const CARVE_R=17;                 // metres at full edge
// No heading clamp. You can turn all the way round and ride back up if you
// want to — gravity is taken from the local slope, so climbing simply bleeds
// speed until you stop, which is the honest outcome rather than an invisible
// wall at 66 degrees.
const CFG=defaultConfig();

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
  R.wind=0;R.windF=0;R.windC=0;R.spin=0;R.flip=0;R.dist=0;
  R.y=terrainH(0,0);landCrouch=0;lastBand='';bandT=0;crashT=0;
}

function stepRide(dt){
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
    return;
  }
  if(!R.air){
    R.edge=lerp(R.edge,IN.steer,1-Math.exp(-9*dt));
    const carve=Math.abs(R.edge);
    // Gravity comes from the slope ACTUALLY under the board, sampled from the
    // same terrain function that draws the snow — so a black-diamond pitch
    // really does accelerate you harder than a blue one, and a roller robs
    // speed on the way up. A fixed G*sin(SLOPE) could not do either.
    const ds=Math.max(0.6,R.v*dt);
    const hHere=terrainH(R.x,R.z);
    const hAhead=terrainH(R.x+Math.sin(R.drift)*ds,R.z+Math.cos(R.drift)*ds);
    const theta=Math.atan(-(hAhead-hHere)/ds);      // + descending, - climbing
    let a=G*Math.sin(theta)-DRAG*R.v*R.v-EDGE_SCRUB*carve*carve;
    if(IN.brake)a-=BRAKE;
    if(IN.tuck)a+=1.5;
    R.v=Math.max(0.8,R.v+a*dt);
    R.yaw+=R.edge*(Math.max(R.v,3)/CARVE_R)*dt;
    // You cannot hold a traverse at walking pace — the board slips round to
    // the fall line. Without this, removing the heading clamp let you carve
    // all the way uphill, stall at zero, and stay there facing up the hill
    // with no way to recover.
    if(R.v<2.6){
      const down=Math.round(R.yaw/TAU)*TAU;      // nearest downhill heading
      R.yaw=lerp(R.yaw,down,Math.min(1,2.2*dt*(2.6-R.v)/2.6));
    }
    R.drift=lerp(R.drift,R.yaw,1-Math.exp(-7*dt));

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

    const xN=R.x+Math.sin(R.drift)*R.v*dt, zN=R.z+Math.cos(R.drift)*R.v*dt;
    const hN=terrainH(xN,zN);
    if(h1+vyT*dt-0.5*G*dt*dt>hN+0.015){
      R.air=true;R.vy=vyT;R.y=h1;
      takeoff();                    // a lip sets rotation the same way a pop does
    }else{
      R.y=h1;R.vy=vyT;
    }
    landCrouch=Math.max(0,landCrouch-dt);
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
    R.spin+=Math.abs(wb[1])/TAU*dt;            // revolutions of yaw
    R.flip+=Math.abs(wb[2])/TAU*dt;            // revolutions over the nose
    R.vy-=G*dt;
    R.y+=R.vy*dt;
    R.x+=Math.sin(R.drift)*R.v*dt;
    R.z+=Math.cos(R.drift)*R.v*dt;
    const g=terrainH(R.x,R.z);
    if(R.y<=g){R.y=g;land();}
  }
  R.dist=Math.max(R.dist,R.z);
  hitProps();
}

// Landing is graded by the ENGINE's thresholds, so free ride and the daily
// game agree on what a stomp is.
function land(){
  R.air=false;
  const off=Math.abs(((R.spin%1)+1.5)%1-0.5)*360;      // degrees off square
  const band=off<=CFG.stompDeg?'stomp':off<=CFG.sketchDeg?'sketchy'
            :off<=CFG.washDeg?'wash-out':'crash';
  lastBand=band;bandT=1.5;
  R.v=Math.max(1.2,R.v*({stomp:1,'sketchy':0.88,'wash-out':0.62,crash:0.3})[band]);
  if(band!=='crash'&&R.spin>0.2){
    const score=Math.round(R.spin*360/90)*90;
    if(score>best)best=score;
  }
  if(band==='crash')crashT=1.1;
  buzz(band==='stomp'?18:band==='sketchy'?[12,40,12]:band==='wash-out'?55:[30,60,90]);
  // touching down is what kills the rotation — the snow takes the momentum
  R.yaw=R.drift;R.L=[0,0,0];R.w=[0,0,0];R.vy=0;
  R.spin=0;R.flip=0;R.wind=0;R.windF=0;R.windC=0;
  landCrouch=band==='crash'?1.0:0.42;
}

function hitProps(){
  // Below walking pace there is no crash to have — and without this guard a
  // rider who stops inside a tree's radius re-triggers the collision every
  // frame, pinning speed at zero forever with no way out.
  if(crashT>0||R.v<3)return;
  const i0=Math.round(R.x/PROP_SX), j0=Math.round(R.z/PROP_SZ);
  for(let i=i0-1;i<=i0+1;i++)for(let j=j0-1;j<=j0+1;j++){
    const p=propAt(i,j);if(!p)continue;
    const dx=R.x-p.x,dz=R.z-p.z;
    const rr=p.r+0.5;
    if(dx*dx+dz*dz<rr*rr&&R.y<terrainH(p.x,p.z)+(p.tree?3.4:1.1)*p.s){
      lastBand='crash';bandT=1.5;crashT=1.1;R.air=false;
      R.v*=0.25;R.L=[0,0,0];R.w=[0,0,0];R.spin=0;R.wind=0;landCrouch=1.0;
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
function groundQ(){
  const eps=1.2;
  const hF=terrainH(R.x+Math.sin(R.drift)*eps,R.z+Math.cos(R.drift)*eps);
  const hB=terrainH(R.x-Math.sin(R.drift)*eps,R.z-Math.cos(R.drift)*eps);
  const pitch=Math.atan2(hF-hB,2*eps);
  let q=qAxis([0,1,0],R.yaw);
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
    if(IN.grab)      base=blendPose(base,poseOf(GRAB_POSE.indy||'Indy grab'),0.92);
    else if(IN.tuck) base=blendPose(base,poseOf('Tuck'),0.8);
    else if(IN.brake)base=blendPose(base,poseOf('Sprawl'),0.75);
  }else if(IN.tuck){
    base=blendPose(poseOf('Athletic stance'),poseOf('Tuck'),0.85);
  }else if(Math.abs(R.wind)>0.05){
    // show the coil: the torso winds against the board before it unwinds
    base=blendPose(base,poseOf(R.wind>0?'Wind-up':'Counter-rotate'),
                   Math.min(0.85,Math.abs(R.wind)));
  }
  return resolvePose(base);
}

// ═══════════════════ SCENE ═══════════════════
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(2,devicePixelRatio));
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x8fb4dd);
// Fog is pulled in deliberately so it swallows the edge of the terrain grid
// before you can see it end. The peaks opt OUT of fog (below) so they still
// read as a horizon rather than dissolving with the ground.
scene.fog=new THREE.Fog(0xa8c6e6,70,215);
const camera=new THREE.PerspectiveCamera(52,1,0.1,900);
// Snow whites out under flat light: with ambient near 1.0 every facet returns
// the same value and the hill reads as a blank sheet. Keep ambient LOW and let
// a strong, low, side-on sun do the modelling — that is what makes a bump a
// bump. The sun is deliberately off-axis so slopes facing it and away from it
// separate instead of shading symmetrically.
scene.add(new THREE.AmbientLight(0x9fb4d0,0.30));
scene.add(new THREE.HemisphereLight(0xdae8fa,0x5b6b80,0.38));
const sun=new THREE.DirectionalLight(0xfff4e2,1.15);
sun.position.set(-26,20,-12);scene.add(sun);
const SUNDIR=new THREE.Vector3(-26,20,-12).normalize();

// ── the snow: a height-field mesh that follows the rider. Rebuilt only when
// the rider crosses a grid step, not every frame. ──
const GW=44, GL=120, GS=2.2;                   // cols, rows, metres per cell
const snowMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.94,metalness:0,
  flatShading:true,vertexColors:true});
const snowGeo=new THREE.BufferGeometry();
const vtx=new Float32Array(GW*GL*3);
const col=new Float32Array(GW*GL*3);
const idx=[];
for(let j=0;j<GL-1;j++)for(let i=0;i<GW-1;i++){
  const a=j*GW+i,b=a+1,c=a+GW,d=c+1;
  idx.push(a,c,b, b,c,d);
}
snowGeo.setAttribute('position',new THREE.BufferAttribute(vtx,3));
snowGeo.setAttribute('color',new THREE.BufferAttribute(col,3));
snowGeo.setIndex(idx);
const snow=new THREE.Mesh(snowGeo,snowMat);
snow.frustumCulled=false;
scene.add(snow);
let gridKey='';
// Vertex shading. Lighting alone still leaves a smooth field ambiguous, so
// each vertex is tinted by two extra cues a real snowfield gives you:
//   ASPECT    — how the local surface faces the sun (the modelling)
//   CURVATURE — how the point sits against its neighbours; hollows go blue,
//               crests go bright. This is what makes a bump legible as a bump
//               rather than a shade of white.
// Plus faint contour banding every metre of height, like light sluff lines,
// which gives the eye an absolute reference for where the ground is.
const C_LIT=[1.00,1.00,1.00], C_SHADE=[0.46,0.56,0.72];
function shadeAt(x,z,h){
  const e=GS;
  const hx=terrainH(x+e,z)-terrainH(x-e,z);
  const hz=terrainH(x,z+e)-terrainH(x,z-e);
  // surface normal of the height field
  let nx=-hx/(2*e), ny=1, nz=-hz/(2*e);
  const il=1/Math.hypot(nx,ny,nz); nx*=il;ny*=il;nz*=il;
  let lit=nx*SUNDIR.x+ny*SUNDIR.y+nz*SUNDIR.z;
  lit=clamp(lit*0.5+0.5,0,1);
  // curvature: mean of neighbours minus this point
  const avg=(terrainH(x+e,z)+terrainH(x-e,z)+terrainH(x,z+e)+terrainH(x,z-e))/4;
  const curv=clamp((h-avg)*1.9,-0.5,0.5);
  let f=clamp(lit*0.72+0.28+curv,0,1);
  const band=Math.abs((h*1.0)%1);                  // contour reference lines
  if(band<0.06)f*=0.90;
  return [C_SHADE[0]+(C_LIT[0]-C_SHADE[0])*f,
          C_SHADE[1]+(C_LIT[1]-C_SHADE[1])*f,
          C_SHADE[2]+(C_LIT[2]-C_SHADE[2])*f];
}
function buildSnow(){
  const ox=Math.round(R.x/GS)*GS, oz=Math.round(R.z/GS)*GS;
  const key=ox+'|'+oz;
  if(key===gridKey)return;
  gridKey=key;
  for(let j=0;j<GL;j++){
    const z=oz+(j-16)*GS;
    for(let i=0;i<GW;i++){
      const x=ox+(i-GW/2)*GS;
      const n=(j*GW+i)*3;
      const h=terrainH(x,z);
      vtx[n]=x;vtx[n+1]=h;vtx[n+2]=z;
      const c=shadeAt(x,z,h);
      col[n]=c[0];col[n+1]=c[1];col[n+2]=c[2];
    }
  }
  snowGeo.attributes.position.needsUpdate=true;
  snowGeo.attributes.color.needsUpdate=true;
  snowGeo.computeVertexNormals();
}

// ── props: pooled rocks and trees, snow-covered ──
const rockMat=new THREE.MeshStandardMaterial({color:0xdfe7f2,roughness:1,flatShading:true});
const barkMat=new THREE.MeshStandardMaterial({color:0x4b3a2e,roughness:1});
const pineMat=new THREE.MeshStandardMaterial({color:0x2f4636,roughness:1,flatShading:true});
const capMat =new THREE.MeshStandardMaterial({color:0xf4f8ff,roughness:0.9,flatShading:true});
const POOL=26;
const props=[];
for(let i=0;i<POOL;i++){
  const g=new THREE.Group();
  const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(1,0),rockMat);
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.22,1.5,6),barkMat);
  trunk.position.y=0.75;
  const pine=new THREE.Mesh(new THREE.ConeGeometry(1.15,3.2,7),pineMat);
  pine.position.y=2.5;
  const cap=new THREE.Mesh(new THREE.ConeGeometry(0.95,1.5,7),capMat);
  cap.position.y=3.5;
  const tree=new THREE.Group();tree.add(trunk,pine,cap);
  g.add(rock,tree);
  g.visible=false;scene.add(g);
  props.push({g,rock,tree});
}
function placeProps(){
  // walk the cells around the rider, nearest bands first, until the pool fills
  const i0=Math.round(R.x/PROP_SX), j0=Math.round(R.z/PROP_SZ);
  let n=0;
  for(let j=j0-3;j<=j0+14&&n<POOL;j++)
    for(let i=i0-4;i<=i0+4&&n<POOL;i++){
      const p=propAt(i,j);if(!p)continue;
      const it=props[n++];
      it.g.visible=true;
      it.g.position.set(p.x,terrainH(p.x,p.z)-0.25,p.z);
      it.g.scale.setScalar(p.s);
      it.g.rotation.y=hashAt2(i,j,17)*6.283;
      it.rock.visible=!p.tree;
      it.tree.visible=p.tree;
    }
  for(;n<POOL;n++)props[n].g.visible=false;
}

// ── piste markers: orange-topped poles down both sides of the run. These are
// the scale and speed reference. On an unbroken white field you genuinely
// cannot tell 30 km/h from 80 — you need fixed things going past. ──
const MARK_SPACING=22, MPOOL=20;
const poleMat=new THREE.MeshStandardMaterial({color:0x1b2430,roughness:0.9});
const flagMat=new THREE.MeshStandardMaterial({color:0xff7a1a,roughness:0.6,emissive:0x2e1000});
const marks=[];
for(let i=0;i<MPOOL;i++){
  const g=new THREE.Group();
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,2.6,6),poleMat);
  pole.position.y=1.3;
  const flag=new THREE.Mesh(new THREE.CylinderGeometry(0.17,0.17,0.5,6),flagMat);
  flag.position.y=2.5;
  g.add(pole,flag);g.visible=false;scene.add(g);marks.push(g);
}
// A lattice rather than two fixed lines: now that you can ride anywhere, the
// speed reference has to exist anywhere too.
const MARK_SX=44;
function placeMarks(){
  const i0=Math.round(R.x/MARK_SX), j0=Math.floor((R.z-24)/MARK_SPACING);
  for(let n=0;n<MPOOL;n++){
    const j=j0+(n>>1), i=i0+((n&1)?0:1);
    const x=i*MARK_SX-MARK_SX/2, z=j*MARK_SPACING;
    marks[n].visible=true;
    marks[n].position.set(x,terrainH(x,z),z);
  }
}

// ── distant peaks. They ride along with the rider at a fixed offset so they
// never arrive: parallax you cannot reach, the way a horizon behaves. ──
const peaks=new THREE.Group();
// fog:false — a horizon that fades into the same haze as the ground in front
// of you stops reading as distance. Sitting far out and unfogged, they behave
// like real mountains: always there, never closer.
const peakMat=new THREE.MeshStandardMaterial({color:0x9fb6d2,roughness:1,flatShading:true,fog:false});
const capMat2=new THREE.MeshStandardMaterial({color:0xdfeaf8,roughness:1,flatShading:true,fog:false});
for(let i=0;i<18;i++){
  const s=90+hashAt(i,31)*130;
  const ang=(i/18)*Math.PI*2+hashAt(i,33)*0.34;
  const rad2=900+hashAt(i,34)*380;             // far enough to sit ON the horizon
  const m=new THREE.Mesh(new THREE.ConeGeometry(s*0.85,s,5),peakMat);
  const cp=new THREE.Mesh(new THREE.ConeGeometry(s*0.33,s*0.40,5),capMat2);
  cp.position.y=s*0.30;
  const g=new THREE.Group();g.add(m,cp);
  // Offsets only — the height is recomputed every frame in placePeaks(),
  // because the mountain FALLS AWAY beneath them. A peak 900 m down the hill
  // sits ~360 m lower than the rider, and pinning it at a fixed offset left
  // the whole range hanging in the sky like cut-outs.
  g.userData={dx:Math.sin(ang)*rad2, dz:Math.cos(ang)*rad2, s};
  g.rotation.y=hashAt(i,35)*3.1;
  peaks.add(g);
}
// Peaks do NOT follow the slope down. If they did, everything downhill would
// sit below your sightline and there would be no horizon at all — which is
// geometrically true for an endless ramp and looks like nothing. Real ranges
// rise again across a valley, so they descend at a fraction of the fall line
// and end up roughly at eye level, far away.
const PEAK_DROP=0.28;
function placePeaks(){
  peaks.position.set(R.x,baseY(R.z),R.z);
  for(const g of peaks.children){
    const d=g.userData;
    g.position.set(d.dx, -PEAK_DROP*d.dz+d.s*0.16, d.dz);
  }
}
scene.add(peaks);

// ── rider meshes, built from the SHARED body model ──
const rider=new THREE.Group();scene.add(rider);
const bodyMat=new THREE.MeshStandardMaterial({color:0x2b3b52,metalness:0.15,roughness:0.55});
let segMeshes=[];
function buildRiderMeshes(parts){
  segMeshes.forEach(m=>{rider.remove(m);m.geometry.dispose();});segMeshes=[];
  parts.forEach(p=>{
    const g=p.shape==='box'?new THREE.BoxGeometry(p.dims[0],p.dims[1],p.dims[2])
      :p.shape==='sphere'?new THREE.SphereGeometry(p.dims[0],16,12)
      :new THREE.CylinderGeometry(p.dims[0],p.dims[0],p.dims[1],12);
    const mat=(p.color!==undefined)
      ? new THREE.MeshStandardMaterial({color:p.color,metalness:p.metal||0.4,roughness:0.4})
      : bodyMat.clone();
    const m=new THREE.Mesh(g,mat);
    if(p.shape==='sphere'&&(p.frac||0)>0)m.scale.set(0.92,1.12,0.98);
    segMeshes.push(m);rider.add(m);
  });
}
function syncRider(parts,com){
  if(parts.length!==segMeshes.length)buildRiderMeshes(parts);
  for(let i=0;i<parts.length;i++){
    const p=parts[i],m=segMeshes[i];
    m.position.set(p.pos[0]-com[0],p.pos[1]-com[1],p.pos[2]-com[2]);
    if(p.ori)m.quaternion.copy(p.ori);else m.quaternion.set(0,0,0,1);
  }
}

// ── camera: HIGH and behind, looking down the fall line. A low chase cam is
// useless here — on a 17° slope the snow in front of you fills the screen
// and hides every feature you are about to hit. Height is measured from the
// ground UNDER THE CAMERA, not under the rider, or the slope swallows it. ──
const camPos=new THREE.Vector3(),camTgt=new THREE.Vector3();
let camInit=false;
function stepCamera(dt){
  // Closer and a little lower than before: at 8.5 m back the rider was a speck
  // on a big screen. Still clearly above the slope, just near enough to read
  // what the board is doing.
  const back=6.4+R.v*0.11, up=3.4+R.v*0.075+Math.max(0,R.y-terrainH(R.x,R.z))*0.5;
  const cz=R.z-Math.cos(R.drift)*back, cx=R.x-Math.sin(R.drift)*back;
  // Height off the BASE plane sets the framing, but the camera must clear the
  // ACTUAL snow: baseY ignores gullies, kickers and rollers, so a camera sitting
  // 5 m above the base plane ends up inside a 3 m gully wall or behind a lip and
  // the view fills with the underside of the terrain.
  const wantY=Math.max(baseY(cz)+up, terrainH(cx,cz)+2.2);
  const want=new THREE.Vector3(cx,wantY,cz);
  // Aim at the SNOW well ahead, not at a point level with the rider. Looking
  // level on a slope that falls away fills most of the screen with sky; aiming
  // at the ground you are about to ride tilts the view down and shows the
  // features you actually need to see.
  const lx=R.x+Math.sin(R.drift)*22, lz=R.z+Math.cos(R.drift)*22;
  const look=new THREE.Vector3(lx, terrainH(lx,lz)+1.4, lz);
  if(!camInit){camPos.copy(want);camTgt.copy(look);camInit=true;}
  const k=1-Math.exp(-4.0*dt);
  camPos.lerp(want,k);camTgt.lerp(look,k);
  // and again AFTER easing — the lerp can trail through a rise that the target
  // position cleared, so the hard floor has to apply to where it actually is
  const floor=terrainH(camPos.x,camPos.z)+1.8;
  if(camPos.y<floor)camPos.y=floor;
  camera.position.copy(camPos);
  camera.lookAt(camTgt);
}

// ── sizing: measure the ELEMENT, not the window (the canvas is one row of a
// grid, not the whole screen), and compare CSS px — setPixelRatio means the
// backing buffer is w*dpr, so a buffer comparison never matches on retina. ──
let _vw=0,_vh=0;
function resize(){
  const host=canvas.parentNode;
  const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
  if(w===_vw&&h===_vh)return;
  _vw=w;_vh=h;
  renderer.setSize(w,h,false);
  camera.aspect=w/h;camera.updateProjectionMatrix();
}
addEventListener('resize',resize);
resize();

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
  padCoil.style.width=(Math.abs(R.wind)*50)+'%';
  padCoil.style.transform=R.wind<0?'translateX(-100%)':'none';
  pad.classList.toggle('charged',Math.abs(R.wind)>0.55);
  $('padLbl').textContent=R.air?'IN THE AIR':
    Math.abs(R.wind)>0.05?'COIL '+Math.round(Math.abs(R.wind)*100)+'%':'CARVE & COIL';
}
// short haptic cues — the one channel a phone has that a desktop does not
function buzz(ms){ try{ if(navigator.vibrate)navigator.vibrate(ms); }catch(_){} }

// ═══════════════════ LOOP ═══════════════════
let last=performance.now();
function tick(now){
  requestAnimationFrame(tick);
  resize();
  const dt=Math.min(0.033,(now-last)/1000);last=now;
  if(bandT>0)bandT=Math.max(0,bandT-dt);
  readInput();

  const n=Math.max(1,Math.ceil(dt/0.006));      // fixed sub-steps stay stable
  for(let i=0;i<n;i++)stepRide(dt/n);
  if(!R.air&&crashT<=0)R.q=groundQ();

  const parts=partsFromPose(currentPose());
  const bi=bodyInertia(parts);
  syncRider(parts,bi.com);
  rider.quaternion.set(R.q[1],R.q[2],R.q[3],R.q[0]);
  const bf=parts.bf;
  const lift=bf?dot3(sub3(bi.com,bf.c),bf.bn):0.9;
  rider.position.set(R.x,R.y+lift,R.z);

  buildSnow();
  placeProps();
  placeMarks();
  placePeaks();                             // horizon follows, never arrives
  stepCamera(dt);
  updHUD();
  renderer.render(scene,camera);
}
// Debug handle. Everything above is closed over by the IIFE, which is right
// for the page but leaves no way to inspect the world from a console. This
// exposes the pure world functions (and live rider state) read-only-ish.
// stepRide/reset are exposed so the ride can be driven headlessly — the page
// only animates while it is visible, and physics needs checking either way.
window.RIDE={R,IN,terrainH,featureAt,propAt,baseY,hashAt,camera,scene,props,
  stepRide,reset,ollie,groundQ,touch:()=>touchSteer};

reset();
// Warm the world up before the first frame. With vertexColors on, an
// unpopulated colour buffer is all zeroes — i.e. black snow — so the grid must
// be built once here rather than relying on the first animation frame.
buildSnow();placeProps();placeMarks();placePeaks();
requestAnimationFrame(tick);
})();
