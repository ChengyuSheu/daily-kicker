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
  sw:0,                           // 0 or PI — riding switch, as a render offset
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
const POP=4.9, DRAG=0.0090, EDGE_SCRUB=3.0, BRAKE=9.0;
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
  R.wind=0;R.windF=0;R.windC=0;R.spin=0;R.flip=0;R.dist=0;R.sw=0;
  trailN=0;sprayN=0;
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
    R.v=Math.max(0.8,R.v+a*dt);
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
    if(R.skid>0.12&&R.v>5)emitSpray(R.skid>0.6?3:1,2.0+R.skid*2.4,1.3);
    else if(carve>0.45&&R.v>9)emitSpray(1,1.1,0.7);

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
    R.vy-=G*dt;
    R.y+=R.vy*dt;
    R.x+=Math.sin(R.drift)*R.v*dt;
    R.z+=Math.cos(R.drift)*R.v*dt;
    const g=terrainH(R.x,R.z);
    if(R.y<=g){R.y=g;land();}
  }
  R.dist=Math.max(R.dist,R.z);
  if(hitCool>0)hitCool-=dt;
  if(R.shake>0)R.shake=Math.max(0,R.shake-2.6*dt);
  if(!R.air&&crashT<=0)pushTrail();
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
  emitSpray(band==='stomp'?6:12,1.6+Math.min(6,-R.vy*0.30),1.5);
  R.shake=Math.min(1,Math.max(R.shake,(band==='crash'?0.7:0.28)));
  // The track begins again HERE. Skipping samples while airborne was not
  // enough: the ribbon is one continuous strip, so the quad joining the last
  // sample before the lip to the first one after it drew a plank of compressed
  // snow straight across the gap, through mid-air. Starting a fresh strip at
  // the landing is both correct and what you actually want to see.
  trailN=0;lastTrailX=R.x;lastTrailZ=R.z;
  // Land switch and you STAY switch — carried as a render offset so the board
  // does not visibly snap through 180 degrees the instant you touch down.
  const dir=qRot(R.q,[1,0,0]);
  const rel=Math.atan2(dir[0],dir[2])-R.drift;
  R.sw=(Math.round(rel/Math.PI)%2)?(R.sw+Math.PI)%(2*Math.PI):R.sw;
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
    if(dx*dx+dz*dz<rr*rr&&R.y<terrainH(p.x,p.z)+(p.tree?3.4:1.1)*p.s){
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
      emitSpray(14,3.4,2.4);
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
// Rock, not snow. A white boulder on a white hill is invisible until you are
// already in it — being able to READ the hazard is the point of drawing it.
const rockMat=new THREE.MeshStandardMaterial({color:0x6b5f55,roughness:1,flatShading:true});
const rockCapMat=new THREE.MeshStandardMaterial({color:0xeaf1fb,roughness:1,flatShading:true});
const barkMat=new THREE.MeshStandardMaterial({color:0x4b3a2e,roughness:1});
const pineMat=new THREE.MeshStandardMaterial({color:0x2f4636,roughness:1,flatShading:true});
const capMat =new THREE.MeshStandardMaterial({color:0xf4f8ff,roughness:0.9,flatShading:true});
const POOL=26;
const props=[];
for(let i=0;i<POOL;i++){
  const g=new THREE.Group();
  const rock=new THREE.Group();
  const stone=new THREE.Mesh(new THREE.DodecahedronGeometry(1,0),rockMat);
  const snowcap=new THREE.Mesh(new THREE.DodecahedronGeometry(0.82,0),rockCapMat);
  snowcap.position.y=0.42;snowcap.scale.set(1,0.5,1);   // snow sitting on top
  rock.add(stone,snowcap);
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

// ═══════════════════ THE TRACK YOU LEAVE ═══════════════════
// Riding over untouched snow without marking it is the single thing that made
// the board feel like it was gliding over glass. This is a ribbon of quads laid
// down behind the board: two edge vertices per sample, a new sample every
// ~0.4 m of travel, oldest recycled.
//
// Nothing is written while you are airborne, so the gap in the trench IS the
// jump — you can look back and see exactly where you took off and landed.
const TRAIL_MAX=300;                        // samples (2 verts each)
const trailPos=new Float32Array(TRAIL_MAX*2*3);
const trailCol=new Float32Array(TRAIL_MAX*2*3);
const trailIdx=[];
for(let i=0;i<TRAIL_MAX-1;i++){
  const a=i*2,b=a+1,c=a+2,d=a+3;
  trailIdx.push(a,c,b, b,c,d);
}
const trailGeo=new THREE.BufferGeometry();
trailGeo.setAttribute('position',new THREE.BufferAttribute(trailPos,3));
trailGeo.setAttribute('color',new THREE.BufferAttribute(trailCol,3));
trailGeo.setIndex(trailIdx);
const trailMat=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,
  opacity:0.62,depthWrite:false,polygonOffset:true,
  polygonOffsetFactor:-4,polygonOffsetUnits:-4});
const trail=new THREE.Mesh(trailGeo,trailMat);
trail.frustumCulled=false;trail.renderOrder=2;
scene.add(trail);
let trailN=0,lastTrailX=0,lastTrailZ=0;
function pushTrail(){
  const dx=R.x-lastTrailX, dz=R.z-lastTrailZ;
  if(dx*dx+dz*dz<0.16)return;                         // ~0.4 m spacing
  lastTrailX=R.x;lastTrailZ=R.z;
  // the trench is as wide as the board is edged over: a flat base leaves a
  // narrow line, a hard carve digs a broad one
  // A board is about 26 cm across. The trench widens a little on edge and a
  // little more in a skid, but it is a track — not a road.
  const w=0.16+Math.abs(R.edge)*0.09+Math.min(R.skid,1.5)*0.10;
  const nx=Math.cos(R.drift), nz=-Math.sin(R.drift);  // across the direction of travel
  if(trailN>=TRAIL_MAX){                              // scroll the ring down by one
    trailPos.copyWithin(0,6);trailCol.copyWithin(0,6);
    trailN=TRAIL_MAX-1;
  }
  const o=trailN*6;
  for(let s=0;s<2;s++){
    const sx=R.x+nx*w*(s?1:-1), sz=R.z+nz*w*(s?1:-1);
    trailPos[o+s*3]  =sx;
    // Sits well clear of the surface on purpose. The snow is drawn as flat
    // triangles across 2.2 m cells, so between vertices the DRAWN surface can
    // be a good few centimetres above the true height — a track laid at the
    // real height disappears inside the mesh everywhere the ground is concave.
    trailPos[o+s*3+1]=terrainH(sx,sz)+0.09;
    trailPos[o+s*3+2]=sz;
  }
  trailN++;
  // recolour: compressed snow reads BLUER and darker than the powder around
  // it, and older track fades back toward the surface
  for(let i=0;i<trailN;i++){
    const age=i/Math.max(1,trailN-1);                 // 0 oldest .. 1 newest
    const f=0.30+0.55*age;
    for(let s=0;s<2;s++){
      const p=(i*2+s)*3;
      trailCol[p]  =0.52*f+0.10;
      trailCol[p+1]=0.60*f+0.12;
      trailCol[p+2]=0.78*f+0.16;
    }
  }
  trailGeo.attributes.position.needsUpdate=true;
  trailGeo.attributes.color.needsUpdate=true;
  trailGeo.setDrawRange(0,Math.max(0,(trailN-1)*6));
}

// ── POWDER. Thrown off the edge when you carve, and kicked up on landing.
// Cheap points, no texture — on a white hill the silhouette is enough. ──
const SPRAY_MAX=260;
const sprayPos=new Float32Array(SPRAY_MAX*3);
const sprayVel=new Float32Array(SPRAY_MAX*3);
const sprayLife=new Float32Array(SPRAY_MAX);
const sprayGeo=new THREE.BufferGeometry();
sprayGeo.setAttribute('position',new THREE.BufferAttribute(sprayPos,3));
const sprayMat=new THREE.PointsMaterial({color:0xffffff,size:0.30,
  transparent:true,opacity:0.85,depthWrite:false,sizeAttenuation:true});
const spray=new THREE.Points(sprayGeo,sprayMat);
spray.frustumCulled=false;scene.add(spray);
let sprayN=0;
function emitSpray(n,speed,spread){
  for(let k=0;k<n;k++){
    const i=sprayN%SPRAY_MAX;sprayN++;
    const nx=Math.cos(R.drift), nz=-Math.sin(R.drift);
    const side=-Math.sign(R.edge||1);
    const o=i*3;
    sprayPos[o]  =R.x+nx*side*0.35;
    sprayPos[o+1]=R.y+0.10;
    sprayPos[o+2]=R.z+nz*side*0.35;
    sprayVel[o]  =nx*side*speed*(0.5+Math.random())+(Math.random()-0.5)*spread
                  -Math.sin(R.drift)*R.v*0.20;
    sprayVel[o+1]=speed*(0.55+Math.random()*0.8);
    sprayVel[o+2]=nz*side*speed*(0.5+Math.random())+(Math.random()-0.5)*spread
                  -Math.cos(R.drift)*R.v*0.20;
    sprayLife[i]=0.55+Math.random()*0.45;
  }
}
function stepSpray(dt){
  for(let i=0;i<SPRAY_MAX;i++){
    if(sprayLife[i]<=0){ sprayPos[i*3+1]=-9999; continue; }
    sprayLife[i]-=dt;
    const o=i*3;
    sprayVel[o+1]-=7.5*dt;                    // powder hangs, it does not fall like rock
    sprayVel[o]*=(1-1.8*dt);sprayVel[o+2]*=(1-1.8*dt);
    sprayPos[o]  +=sprayVel[o]*dt;
    sprayPos[o+1]+=sprayVel[o+1]*dt;
    sprayPos[o+2]+=sprayVel[o+2]*dt;
    if(sprayLife[i]<=0)sprayPos[o+1]=-9999;
  }
  sprayGeo.attributes.position.needsUpdate=true;
}

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
  // Impact shake. Applied to the camera rather than the rider so nothing about
  // the simulation is disturbed — it is a report of the hit, not part of it.
  if(R.shake>0.001){
    const s=R.shake*R.shake*0.55;
    camera.position.x+=(Math.random()-0.5)*s;
    camera.position.y+=(Math.random()-0.5)*s;
    camera.position.z+=(Math.random()-0.5)*s;
  }
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

  const parts=partsFromPose(currentPose());
  const bi=bodyInertia(parts);
  syncRider(parts,bi.com);
  rider.quaternion.set(R.q[1],R.q[2],R.q[3],R.q[0]);
  const bf=parts.bf;
  const lift=bf?dot3(sub3(bi.com,bf.c),bf.bn):0.9;
  rider.position.set(R.x,R.y+lift,R.z);

  stepSpray(dt);
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
  stepRide,reset,ollie,groundQ,squareQ,boardOffSquare,
  band:()=>lastBand, trailCount:()=>trailN, sprayCount:()=>sprayN,
  touch:()=>touchSteer};

reset();
// Dev aid: play.html#warp<seconds> fast-forwards the ride before the first
// frame, e.g. #warp20. Headless screenshots otherwise always catch the rider
// on the start line, which makes anything cumulative — the track especially —
// impossible to see.
{
  const m=/^#warp(\d+)?$/.exec(location.hash);
  if(m){
    const secs=Math.min(60,+(m[1]||15));
    for(let i=0;i<secs*120;i++)stepRide(1/120);
  }
}
// Warm the world up before the first frame. With vertexColors on, an
// unpopulated colour buffer is all zeroes — i.e. black snow — so the grid must
// be built once here rather than relying on the first animation frame.
buildSnow();placeProps();placeMarks();placePeaks();
requestAnimationFrame(tick);
})();
