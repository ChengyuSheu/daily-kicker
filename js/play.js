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

// ── features: kickers, rollers and hips, one candidate per 46 m cell ──
const FEAT_SPACING=46;
function featureAt(k){
  const r=hashAt(k,1);
  if(r<0.16)return null;                       // some cells stay open
  const kind=r<0.52?'kicker':r<0.78?'roller':'hip';
  const sizeR=hashAt(k,2);
  return{
    kind,
    z:k*FEAT_SPACING+hashAt(k,3)*16,
    x:(hashAt(k,4)*2-1)*(kind==='hip'?12:6),
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
  const k0=Math.floor((z-FEAT_SPACING)/FEAT_SPACING);
  for(let k=k0;k<=k0+2;k++){
    const f=featureAt(k);
    if(f)h+=featH(f,x,z);
  }
  return h;
}

// ── props: snow-covered rocks and trees, also hash-placed ──
const PROP_SPACING=9;
function propAt(k){
  const r=hashAt(k,11);
  if(r<0.45)return null;
  const side=hashAt(k,12)<0.5?-1:1;
  const lane=6+hashAt(k,13)*26;                // keep the middle rideable
  const isTree=hashAt(k,14)<0.62;
  const s=0.7+hashAt(k,15)*0.9;
  return{z:k*PROP_SPACING+hashAt(k,16)*6, x:side*lane,
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
  q:[1,0,0,0], w:[0,0,0],         // body orientation + angular rate (rev/s)
  spin:0, dist:0,
};
// A snowboarder rides SIDEWAYS. The body model is built with the board's
// long axis along local X, so the whole rider is turned a quarter turn to
// put the board along the direction of travel — which leaves the shoulders
// across the fall line, where a snowboarder's actually are.
const STANCE=-Math.PI/2;

let landCrouch=0, lastBand='', bandT=0, best=0, crashT=0;

// ═══════════════════ INPUT ═══════════════════
const K={};
const IN={steer:0,pitch:0,roll:0,tuck:false,brake:false,grab:false};
addEventListener('keydown',e=>{
  if(e.code==='Space')e.preventDefault();
  if(!K[e.code]&&e.code==='Space')ollie();
  K[e.code]=true;
  if(e.code==='KeyR')reset();
});
addEventListener('keyup',e=>{K[e.code]=false;});
let touchSteer=null,touchGrab=false,touchX0=0;
function readInput(){
  const L=K.ArrowLeft||K.KeyA, Rt=K.ArrowRight||K.KeyD;
  IN.steer=(Rt?1:0)-(L?1:0);
  if(touchSteer!==null)IN.steer=touchSteer;
  IN.pitch=(K.ArrowUp||K.KeyW?1:0)-(K.ArrowDown||K.KeyS?1:0);
  IN.roll=(K.KeyE?1:0)-(K.KeyQ?1:0);
  IN.tuck=!!(K.ArrowUp||K.KeyW)&&!R.air;
  IN.brake=!!(K.ArrowDown||K.KeyS)&&!R.air;
  IN.grab=!!(K.ShiftLeft||K.ShiftRight||K.KeyG)||touchGrab;
}
// Steering follows ONE pointer, and only while it is genuinely held down.
// Tracking merely "did a pointerdown happen" meant a mouse that had clicked
// once kept steering on every later move — the board wandered off the fall
// line and ended up riding back up the hill with no input at all.
let steerPtr=null;
canvas.addEventListener('pointerdown',e=>{
  e.preventDefault();
  steerPtr=e.pointerId;touchX0=e.clientX;touchSteer=0;
  if(canvas.setPointerCapture)try{canvas.setPointerCapture(e.pointerId);}catch(_){}
},{passive:false});
canvas.addEventListener('pointermove',e=>{
  if(steerPtr!==e.pointerId)return;
  if(e.pointerType==='mouse'&&!(e.buttons&1)){endTouch();return;}
  touchSteer=clamp((e.clientX-touchX0)/70,-1,1);
},{passive:false});
const endTouch=()=>{steerPtr=null;touchSteer=null;};
canvas.addEventListener('pointerup',endTouch);
canvas.addEventListener('pointercancel',endTouch);
canvas.addEventListener('pointerleave',endTouch);
$('ollieBtn').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();ollie();},{passive:false});
const grabOn=e=>{e.preventDefault();e.stopPropagation();touchGrab=true;};
const grabOff=()=>{touchGrab=false;};
$('grabBtn').addEventListener('pointerdown',grabOn,{passive:false});
$('grabBtn').addEventListener('pointerup',grabOff);
$('grabBtn').addEventListener('pointercancel',grabOff);
$('grabBtn').addEventListener('pointerleave',grabOff);
$('resetBtn').addEventListener('click',reset);

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
const YAW_LIMIT=1.15;             // ±66° from the fall line; no riding uphill
const CFG=defaultConfig();

function ollie(){
  if(R.air||crashT>0)return;
  R.air=true;R.airT=0;R.vy+=POP;R.y+=0.02;R.spin=0;R.w=[0,0,0];
}
function reset(){
  R.x=0;R.z=0;R.v=8;R.vy=0;R.yaw=0;R.drift=0;R.edge=0;
  R.air=false;R.airT=0;R.q=[1,0,0,0];R.w=[0,0,0];R.spin=0;R.dist=0;
  R.y=terrainH(0,0);landCrouch=0;lastBand='';bandT=0;crashT=0;
}

function stepRide(dt){
  if(crashT>0){                       // sitting in the snow after a crash
    crashT-=dt;R.v=Math.max(0,R.v-6*dt);
    R.x+=Math.sin(R.drift)*R.v*dt;R.z+=Math.cos(R.drift)*R.v*dt;
    R.y=terrainH(R.x,R.z);
    if(crashT<=0){R.v=Math.max(4,R.v);landCrouch=0.5;}
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
    R.yaw=clamp(R.yaw+R.edge*(Math.max(R.v,3)/CARVE_R)*dt,-YAW_LIMIT,YAW_LIMIT);
    R.drift=lerp(R.drift,R.yaw,1-Math.exp(-7*dt));

    const h0=terrainH(R.x,R.z);
    R.x+=Math.sin(R.drift)*R.v*dt;
    R.z+=Math.cos(R.drift)*R.v*dt;
    const h1=terrainH(R.x,R.z);
    const vyT=(h1-h0)/dt;                     // vertical rate of the snow itself
    // Would following the ground require falling faster than gravity? If the
    // terrain drops away harder than a free body would, you have left it.
    const xN=R.x+Math.sin(R.drift)*R.v*dt, zN=R.z+Math.cos(R.drift)*R.v*dt;
    const hN=terrainH(xN,zN);
    if(h1+vyT*dt-0.5*G*dt*dt>hN+0.015){
      R.air=true;R.airT=0;R.vy=vyT;R.y=h1;R.spin=0;R.w=[0,0,0];
    }else{
      R.y=h1;R.vy=vyT;
    }
    landCrouch=Math.max(0,landCrouch-dt);
  }else{
    R.airT+=dt;
    R.w[1]+=IN.steer*2.2*dt;
    R.w[0]+=IN.pitch*1.7*dt;
    R.w[2]+=IN.roll*1.7*dt;
    for(let i=0;i<3;i++)R.w[i]=clamp(R.w[i],-2.6,2.6);
    R.q=qStep(R.q,[R.w[0]*TAU,R.w[1]*TAU,R.w[2]*TAU],dt);
    R.spin+=Math.abs(R.w[1])*dt;
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
  R.yaw=R.drift;R.w=[0,0,0];R.vy=0;R.spin=0;
  landCrouch=band==='crash'?1.0:0.42;
}

function hitProps(){
  if(crashT>0)return;
  const k0=Math.floor((R.z-PROP_SPACING)/PROP_SPACING);
  for(let k=k0;k<=k0+2;k++){
    const p=propAt(k);if(!p)continue;
    const dx=R.x-p.x,dz=R.z-p.z;
    const rr=p.r+0.5;
    if(dx*dx+dz*dz<rr*rr&&R.y<terrainH(p.x,p.z)+(p.tree?3.4:1.1)*p.s){
      lastBand='crash';bandT=1.5;crashT=1.1;R.air=false;
      R.v*=0.25;R.w=[0,0,0];R.spin=0;landCrouch=1.0;
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
    base=IN.grab?poseOf(GRAB_POSE.indy||'Indy grab'):poseOf('Athletic stance');
    if(!IN.grab&&Math.abs(R.w[1])>0.6)
      base=blendPose(base,poseOf(R.w[1]>0?'Wind-up':'Counter-rotate'),0.35);
  }else if(IN.tuck){
    base=blendPose(poseOf('Athletic stance'),poseOf('Tuck'),0.85);
  }
  return resolvePose(base);
}

// ═══════════════════ SCENE ═══════════════════
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(2,devicePixelRatio));
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x8fb4dd);
scene.fog=new THREE.Fog(0xa8c6e6,120,340);
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
  const k0=Math.floor((R.z-30)/PROP_SPACING);
  let n=0;
  for(let k=k0;k<k0+POOL*2&&n<POOL;k++){
    const p=propAt(k);if(!p)continue;
    const it=props[n++];
    it.g.visible=true;
    it.g.position.set(p.x,terrainH(p.x,p.z)-0.25,p.z);
    it.g.scale.setScalar(p.s);
    it.g.rotation.y=hashAt(k,17)*6.283;
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
function placeMarks(){
  const k0=Math.floor((R.z-24)/MARK_SPACING);
  for(let n=0;n<MPOOL;n++){
    const k=k0+(n>>1), side=(n&1)?1:-1, z=k*MARK_SPACING, x=side*22;
    marks[n].visible=true;
    marks[n].position.set(x,terrainH(x,z),z);
  }
}

// ── distant peaks. They ride along with the rider at a fixed offset so they
// never arrive: parallax you cannot reach, the way a horizon behaves. ──
const peaks=new THREE.Group();
const peakMat=new THREE.MeshStandardMaterial({color:0xbccfe6,roughness:1,flatShading:true});
const capMat2=new THREE.MeshStandardMaterial({color:0xf2f7ff,roughness:1,flatShading:true});
for(let i=0;i<16;i++){
  const s=40+hashAt(i,31)*70;
  const ang=(i/16)*Math.PI*2+hashAt(i,33)*0.3;
  const rad2=300+hashAt(i,34)*90;
  const m=new THREE.Mesh(new THREE.ConeGeometry(s*0.8,s,5),peakMat);
  const cp=new THREE.Mesh(new THREE.ConeGeometry(s*0.34,s*0.42,5),capMat2);
  cp.position.y=s*0.29;
  const g=new THREE.Group();g.add(m,cp);
  g.position.set(Math.sin(ang)*rad2,s*0.30,Math.cos(ang)*rad2);
  peaks.add(g);
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
  const back=8.5+R.v*0.16, up=5.2+R.v*0.10+Math.max(0,R.y-terrainH(R.x,R.z))*0.5;
  const cz=R.z-Math.cos(R.drift)*back, cx=R.x-Math.sin(R.drift)*back;
  const want=new THREE.Vector3(cx,baseY(cz)+up,cz);
  const look=new THREE.Vector3(
    R.x+Math.sin(R.drift)*13, R.y+1.0, R.z+Math.cos(R.drift)*13);
  if(!camInit){camPos.copy(want);camTgt.copy(look);camInit=true;}
  const k=1-Math.exp(-4.0*dt);
  camPos.lerp(want,k);camTgt.lerp(look,k);
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
}

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
  peaks.position.set(R.x,baseY(R.z),R.z);   // horizon follows, never arrives
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
buildSnow();placeProps();placeMarks();
requestAnimationFrame(tick);
})();
