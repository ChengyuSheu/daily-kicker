// ═══════════════════════════════════════════════════════════════════════
//  FREE RIDE — WebGL RENDERER (three.js r128)
//
//  The compatible renderer: runs anywhere WebGL2 does, which today still
//  means most phones. It draws the world js/ride-sim.js computes, and owns
//  nothing about the simulation itself.
//
//  Its sibling js/ride-view-webgpu.js draws the same world with WebGPU.
//  Both read the SAME terrainH, because the snow you see has to be the snow
//  you ride on.
// ═══════════════════════════════════════════════════════════════════════
(function(){
"use strict";
const S=window.Ride;
if(!S){console.error('ride-view-three: ride-sim.js must load first');return;}
const {R,IN,clamp,lerp,terrainH,baseY,featureAt,propAt,hashAt,hashAt2,
       FEAT_SX,FEAT_SZ,PROP_SX,PROP_SZ,canvas}=S;
const $=id=>document.getElementById(id);

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

// ═══════════════════ LOOP ═══════════════════
// The renderer owns the frame; the simulation owns the step. Effects the sim
// raises (the track, the powder) are wired to this renderer's versions here.
S.HOOK.trail=pushTrail;
S.HOOK.spray=emitSpray;
S.HOOK.reset=()=>{trailN=0;sprayN=0;};
S.HOOK.trailBreak=(x,z)=>{trailN=0;lastTrailX=x;lastTrailZ=z;};

let last=performance.now();
function tick(now){
  requestAnimationFrame(tick);
  resize();
  const dt=Math.min(0.033,(now-last)/1000);last=now;

  S.step(dt);

  const parts=partsFromPose(S.currentPose());
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
  S.updHUD();
  renderer.render(scene,camera);
}

// Debug handle, kept shape-compatible with what the tests already call.
window.RIDE=Object.assign({},S,{
  camera,scene,props,backend:'webgl',
  trailCount:()=>trailN, sprayCount:()=>sprayN});

S.reset();
S.warpFromHash();
// Warm the world up before the first frame. With vertexColors on, an
// unpopulated colour buffer is all zeroes — i.e. black snow — so the grid must
// be built once here rather than relying on the first animation frame.
buildSnow();placeProps();placeMarks();placePeaks();
requestAnimationFrame(tick);
})();
