// ═══════════════════════════════════════════════════════════════════════
//  FREE RIDE — RAW WebGPU RENDERER
//
//  A second renderer for the same simulation (js/ride-sim.js). No engine,
//  no framework: a device, some buffers, four pipelines and hand-written
//  WGSL. Its sibling js/ride-view-three.js draws the identical world with
//  WebGL, and play.html still uses that one — this is the high-end path.
//
//  Approach borrowed from Noniv/snowflow_demo (MIT), which generates its
//  snow on the GPU rather than shipping meshes: the terrain here is a flat
//  grid whose height is evaluated in the VERTEX SHADER, with the surface
//  normal taken analytically from the same function. Nothing about the
//  mountain is stored as geometry.
//
//  One deliberate departure. Snowflow hashes its terrain features on the
//  GPU. Doing that here would desynchronise the render from the physics:
//  the simulation hashes cells in JS doubles, WGSL only has f32, and a
//  threshold like `r < 0.46` lands differently often enough that the GPU
//  would draw a kicker the rider can ride straight through. So the feature
//  PARAMETERS are computed on the CPU by the simulation's own featureAt()
//  and uploaded; the GPU still does all the displacement. The snow you see
//  is provably the snow you ride on.
// ═══════════════════════════════════════════════════════════════════════
(function(){
"use strict";
const S=window.Ride;
if(!S){console.error('ride-view-webgpu: ride-sim.js must load first');return;}
const {R,IN,clamp,lerp,terrainH,baseY,featureAt,propAt,hashAt2,
       FEAT_SX,FEAT_SZ,PROP_SX,PROP_SZ,canvas}=S;
const $=id=>document.getElementById(id);

function fail(msg,detail){
  const el=$('gpuFail');
  if(el){
    el.hidden=false;
    el.querySelector('.why').textContent=msg;
    if(detail)el.querySelector('.detail').textContent=detail;
  }
  console.error('ride-view-webgpu:',msg,detail||'');
}

// ═══════════════════ MATH (no engine, so we carry our own) ═══════════════
function mat4(){return new Float32Array(16);}
function ident(m){m.fill(0);m[0]=m[5]=m[10]=m[15]=1;return m;}
function mul(out,a,b){                       // out = a * b
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){
    let s=0;
    for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];
    out[c*4+r]=s;
  }
  return out;
}
function perspective(out,fovy,aspect,near,far){
  const f=1/Math.tan(fovy/2);
  out.fill(0);
  out[0]=f/aspect; out[5]=f; out[11]=-1;
  out[10]=far/(near-far); out[14]=(far*near)/(near-far);   // WebGPU depth 0..1
  return out;
}
function lookAt(out,eye,tgt,up){
  let zx=eye[0]-tgt[0],zy=eye[1]-tgt[1],zz=eye[2]-tgt[2];
  let l=Math.hypot(zx,zy,zz)||1; zx/=l;zy/=l;zz/=l;
  let xx=up[1]*zz-up[2]*zy, xy=up[2]*zx-up[0]*zz, xz=up[0]*zy-up[1]*zx;
  l=Math.hypot(xx,xy,xz)||1; xx/=l;xy/=l;xz/=l;
  const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
  out[0]=xx; out[4]=xy; out[8]=xz;  out[12]=-(xx*eye[0]+xy*eye[1]+xz*eye[2]);
  out[1]=yx; out[5]=yy; out[9]=yz;  out[13]=-(yx*eye[0]+yy*eye[1]+yz*eye[2]);
  out[2]=zx; out[6]=zy; out[10]=zz; out[14]=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);
  out[3]=0;  out[7]=0;  out[11]=0;  out[15]=1;
  return out;
}
// model matrix from position, quaternion (w,x,y,z) and per-axis scale
function trs(out,p,q,s){
  const w=q[0],x=q[1],y=q[2],z=q[3];
  const x2=x+x,y2=y+y,z2=z+z;
  const xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2;
  const wx=w*x2,wy=w*y2,wz=w*z2;
  out[0]=(1-(yy+zz))*s[0]; out[1]=(xy+wz)*s[0];     out[2]=(xz-wy)*s[0];     out[3]=0;
  out[4]=(xy-wz)*s[1];     out[5]=(1-(xx+zz))*s[1]; out[6]=(yz+wx)*s[1];     out[7]=0;
  out[8]=(xz+wy)*s[2];     out[9]=(yz-wx)*s[2];     out[10]=(1-(xx+yy))*s[2];out[11]=0;
  out[12]=p[0]; out[13]=p[1]; out[14]=p[2]; out[15]=1;
  return out;
}

// ═══════════════════ GEOMETRY (built once, on the CPU) ═══════════════════
// Positions + normals, non-indexed for simplicity; these are tiny.
function boxGeo(){
  const v=[],n=[];
  const F=[[[0,0,1],[-1,-1,1,1,-1,1,1,1,1,-1,1,1]],
           [[0,0,-1],[1,-1,-1,-1,-1,-1,-1,1,-1,1,1,-1]],
           [[1,0,0],[1,-1,1,1,-1,-1,1,1,-1,1,1,1]],
           [[-1,0,0],[-1,-1,-1,-1,-1,1,-1,1,1,-1,1,-1]],
           [[0,1,0],[-1,1,1,1,1,1,1,1,-1,-1,1,-1]],
           [[0,-1,0],[-1,-1,-1,1,-1,-1,1,-1,1,-1,-1,1]]];
  for(const [nor,q] of F){
    const p=[[q[0],q[1],q[2]],[q[3],q[4],q[5]],[q[6],q[7],q[8]],[q[9],q[10],q[11]]];
    for(const i of [0,1,2,0,2,3]){ v.push(p[i][0]*0.5,p[i][1]*0.5,p[i][2]*0.5); n.push(...nor); }
  }
  return interleave(v,n);
}
function cylGeo(seg){
  const v=[],n=[];
  for(let i=0;i<seg;i++){
    const a=i/seg*Math.PI*2, b=(i+1)/seg*Math.PI*2;
    const ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
    // side
    v.push(ca*0.5,-0.5,sa*0.5, cb*0.5,-0.5,sb*0.5, cb*0.5,0.5,sb*0.5);
    n.push(ca,0,sa, cb,0,sb, cb,0,sb);
    v.push(ca*0.5,-0.5,sa*0.5, cb*0.5,0.5,sb*0.5, ca*0.5,0.5,sa*0.5);
    n.push(ca,0,sa, cb,0,sb, ca,0,sa);
    // caps
    v.push(0,0.5,0, cb*0.5,0.5,sb*0.5, ca*0.5,0.5,sa*0.5); n.push(0,1,0, 0,1,0, 0,1,0);
    v.push(0,-0.5,0, ca*0.5,-0.5,sa*0.5, cb*0.5,-0.5,sb*0.5); n.push(0,-1,0, 0,-1,0, 0,-1,0);
  }
  return interleave(v,n);
}
function coneGeo(seg){
  const v=[],n=[];
  for(let i=0;i<seg;i++){
    const a=i/seg*Math.PI*2, b=(i+1)/seg*Math.PI*2;
    const ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
    v.push(0,0.5,0, cb*0.5,-0.5,sb*0.5, ca*0.5,-0.5,sa*0.5);
    n.push(ca,0.5,sa, cb,0.5,sb, ca,0.5,sa);
    v.push(0,-0.5,0, ca*0.5,-0.5,sa*0.5, cb*0.5,-0.5,sb*0.5);
    n.push(0,-1,0, 0,-1,0, 0,-1,0);
  }
  return interleave(v,n);
}
function sphereGeo(su,sv){
  const v=[],n=[];
  const P=(u,vv)=>{
    const th=u/su*Math.PI*2, ph=vv/sv*Math.PI;
    return [Math.sin(ph)*Math.cos(th)*0.5, Math.cos(ph)*0.5, Math.sin(ph)*Math.sin(th)*0.5];
  };
  for(let i=0;i<su;i++)for(let j=0;j<sv;j++){
    const a=P(i,j),b=P(i+1,j),c=P(i+1,j+1),d=P(i,j+1);
    for(const p of [a,b,c,a,c,d]){
      v.push(p[0],p[1],p[2]);
      const l=Math.hypot(p[0],p[1],p[2])||1;
      n.push(p[0]/l,p[1]/l,p[2]/l);
    }
  }
  return interleave(v,n);
}
function interleave(v,n){
  const out=new Float32Array(v.length*2);
  for(let i=0;i<v.length/3;i++){
    out[i*6]=v[i*3];out[i*6+1]=v[i*3+1];out[i*6+2]=v[i*3+2];
    out[i*6+3]=n[i*3];out[i*6+4]=n[i*3+1];out[i*6+5]=n[i*3+2];
  }
  return out;
}

// ═══════════════════ WGSL ═══════════════════
// Terrain: the grid arrives as flat (x,z) offsets from a local origin and the
// height comes out of the shader. Features are uploaded by the CPU (see the
// header) so the drawn surface matches terrainH() exactly.
const TERRAIN_WGSL=`
struct Feat {           // kind: 0 kicker/hip, 1 roller, 2 cliff
  pos : vec2<f32>,
  amp : f32,
  len : f32,
  wid : f32,
  kind: f32,
  _pad: vec2<f32>,
};
struct Uni {
  viewProj : mat4x4<f32>,
  camPos   : vec4<f32>,
  sun      : vec4<f32>,
  origin   : vec4<f32>,   // xy = local origin, z = feature count
  params   : vec4<f32>,   // PITCH0, P1, L1, P2
  params2  : vec4<f32>,   // L2, gullyAmp, _, _
};
@group(0) @binding(0) var<uniform> U : Uni;
@group(0) @binding(1) var<storage, read> feats : array<Feat>;

fn smoothstep01(t:f32)->f32{ let c=clamp(t,0.0,1.0); return c*c*(3.0-2.0*c); }

fn baseY(z:f32)->f32{
  let P0=U.params.x; let P1=U.params.y; let L1=U.params.z; let P2=U.params.w; let L2=U.params2.x;
  return -(P0*z - P1*L1*cos(z/L1) - P2*L2*cos(z/L2)) - (P1*L1 + P2*L2);
}
fn rollH(x:f32,z:f32)->f32{
  return 0.34*sin(z*0.077+x*0.031)+0.22*sin(z*0.031-x*0.058)+0.13*sin(x*0.11+z*0.017);
}
fn gullyH(x:f32,z:f32)->f32{
  let env=sin(z/97.0)*0.5+0.5;
  let amt=max(0.0,env-0.42)/0.58;
  if(amt<=0.0){ return 0.0; }
  let t=clamp(x/17.0,-1.5,1.5);
  return amt*U.params2.y*t*t;
}
fn featH(f:Feat,x:f32,z:f32)->f32{
  let dx=abs(x-f.pos.x);
  if(dx>f.wid){ return 0.0; }
  let lat=1.0-(dx/f.wid)*(dx/f.wid);
  let latW=lat*lat;
  if(f.kind<0.5){                                   // kicker / hip
    let u=(z-f.pos.y)/f.len;
    if(u<0.0 || u>1.0){ return 0.0; }
    return f.amp*pow(u,1.7)*latW;
  }
  if(f.kind<1.5){                                   // roller
    let dz=(z-f.pos.y)/f.len;
    if(abs(dz)>1.0){ return 0.0; }
    let t=1.0-dz*dz;
    return f.amp*t*t*latW;
  }
  let u=(z-f.pos.y)/f.len;                          // cliff
  if(u<0.0 || u>1.0){ return 0.0; }
  let face=smoothstep01((u-0.15)/0.10);
  let back=smoothstep01((u-0.40)/0.60);
  return -f.amp*(face-back)*latW;
}
fn terrainH(x:f32,z:f32)->f32{
  var h=baseY(z)+rollH(x,z)+gullyH(x,z);
  let n=u32(U.origin.z);
  for(var i:u32=0u;i<n;i=i+1u){ h=h+featH(feats[i],x,z); }
  return h;
}

struct VOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) world : vec3<f32>,
  @location(1) nrm   : vec3<f32>,
  @location(2) height: f32,
};

@vertex
fn vs(@location(0) xz : vec2<f32>) -> VOut {
  let wx=U.origin.x+xz.x;
  let wz=U.origin.y+xz.y;
  let h=terrainH(wx,wz);
  // analytic-ish normal: central differences on the same function
  let e=0.75;
  let hx=terrainH(wx+e,wz)-terrainH(wx-e,wz);
  let hz=terrainH(wx,wz+e)-terrainH(wx,wz-e);
  var o:VOut;
  o.world=vec3<f32>(wx,h,wz);
  o.nrm=normalize(vec3<f32>(-hx/(2.0*e),1.0,-hz/(2.0*e)));
  o.height=h;
  o.clip=U.viewProj*vec4<f32>(o.world,1.0);
  return o;
}

@fragment
fn fs(i:VOut) -> @location(0) vec4<f32> {
  let n=normalize(i.nrm);
  let lit=clamp(dot(n,normalize(U.sun.xyz))*0.5+0.5,0.0,1.0);
  // curvature-ish cue: how far the normal tilts from straight up reads as
  // relief, which is what stops a white field looking like a blank sheet
  let tilt=1.0-n.y;
  var f=clamp(lit*0.74+0.26-tilt*0.55,0.0,1.0);
  let band=abs(fract(i.height));                    // 1 m contour reference
  if(band<0.06){ f=f*0.9; }
  let shade=vec3<f32>(0.46,0.56,0.72);
  let col=mix(shade,vec3<f32>(1.0,1.0,1.0),f);
  // distance haze so the edge of the grid does not read as a cliff of nothing
  let d=length(i.world-U.camPos.xyz);
  let fog=clamp((d-70.0)/145.0,0.0,1.0);
  return vec4<f32>(mix(col,vec3<f32>(0.66,0.78,0.90),fog),1.0);
}`;

// Instanced solids: rider parts, rocks, trees, poles. One model matrix and
// one colour per instance.
const SOLID_WGSL=`
struct Uni {
  viewProj : mat4x4<f32>,
  camPos   : vec4<f32>,
  sun      : vec4<f32>,
};
@group(0) @binding(0) var<uniform> U : Uni;

struct VOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) nrm : vec3<f32>,
  @location(1) col : vec4<f32>,
  @location(2) world : vec3<f32>,
};

@vertex
fn vs(@location(0) pos:vec3<f32>, @location(1) nrm:vec3<f32>,
      @location(2) m0:vec4<f32>, @location(3) m1:vec4<f32>,
      @location(4) m2:vec4<f32>, @location(5) m3:vec4<f32>,
      @location(6) col:vec4<f32>) -> VOut {
  let M=mat4x4<f32>(m0,m1,m2,m3);
  let wp=M*vec4<f32>(pos,1.0);
  var o:VOut;
  o.world=wp.xyz;
  o.nrm=normalize((M*vec4<f32>(nrm,0.0)).xyz);
  o.col=col;
  o.clip=U.viewProj*wp;
  return o;
}

@fragment
fn fs(i:VOut) -> @location(0) vec4<f32> {
  let n=normalize(i.nrm);
  let lit=clamp(dot(n,normalize(U.sun.xyz))*0.55+0.45,0.0,1.0);
  let d=length(i.world-U.camPos.xyz);
  let fog=clamp((d-70.0)/145.0,0.0,1.0);
  let c=i.col.rgb*(0.35+0.75*lit);
  return vec4<f32>(mix(c,vec3<f32>(0.66,0.78,0.90),fog),i.col.a);
}`;

// Track ribbon and powder: plain coloured triangles, no lighting.
const FLAT_WGSL=`
struct Uni {
  viewProj : mat4x4<f32>,
  camPos   : vec4<f32>,
  sun      : vec4<f32>,
};
@group(0) @binding(0) var<uniform> U : Uni;
struct VOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) col : vec4<f32>,
};
@vertex
fn vs(@location(0) pos:vec3<f32>, @location(1) col:vec4<f32>) -> VOut {
  var o:VOut;
  o.col=col;
  o.clip=U.viewProj*vec4<f32>(pos,1.0);
  return o;
}
@fragment
fn fs(i:VOut) -> @location(0) vec4<f32> { return i.col; }`;

// ═══════════════════ BOOT ═══════════════════
let device=null,ctx=null,fmt=null;
let pipeTerrain=null,pipeSolid=null,pipeFlat=null;
let bgTerrain=null,bgSolid=null;
let uniTerrain=null,uniSolid=null;
let featBuf=null;
let depthTex=null,depthView=null;

// terrain grid: flat XZ offsets, displaced in the shader
const GW=150, GL=190, GS=1.9;
let gridBuf=null,gridCount=0;
let originX=0,originZ=0;

const GEO={};
const INST_MAX=900;
const instData=new Float32Array(INST_MAX*20);     // mat4 + rgba
let instBuf=null;

const TRAIL_MAX=300;
const trailVerts=new Float32Array(TRAIL_MAX*2*7); // pos3 + rgba4
let trailBuf=null,trailN=0,lastTrailX=0,lastTrailZ=0;

const SPRAY_MAX=260;
const sprayState=new Float32Array(SPRAY_MAX*7);   // pos3 vel3 life1
const sprayVerts=new Float32Array(SPRAY_MAX*6*7); // 2 triangles per particle
let sprayBuf=null,sprayN=0;

async function boot(){
  if(!('gpu' in navigator)){
    fail('This browser has no WebGPU.',
         'Chrome/Edge 113+, Firefox 141+ or Safari 26+ on a machine with a GPU. '+
         'The WebGL version at play.html runs everywhere.');
    return false;
  }
  let adapter=null;
  try{ adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'}); }
  catch(e){ fail('Requesting a GPU adapter threw.',String(e&&e.message||e)); return false; }
  if(!adapter){
    fail('WebGPU is present but no adapter was available.',
         'Usually a headless session, a blocklisted driver, or GPU access disabled. '+
         'play.html (WebGL) works regardless.');
    return false;
  }
  try{ device=await adapter.requestDevice(); }
  catch(e){ fail('Could not create a GPU device.',String(e&&e.message||e)); return false; }
  device.lost.then(info=>fail('The GPU device was lost.',info&&info.message));

  ctx=canvas.getContext('webgpu');
  if(!ctx){ fail('Canvas would not give a webgpu context.'); return false; }
  fmt=navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({device,format:fmt,alphaMode:'opaque'});

  buildGrid();
  buildGeometry();
  buildPipelines();
  return true;
}

function buildGrid(){
  const v=[];
  for(let j=0;j<GL-1;j++)for(let i=0;i<GW-1;i++){
    const x0=(i-GW/2)*GS, x1=(i+1-GW/2)*GS;
    const z0=(j-22)*GS,   z1=(j+1-22)*GS;
    v.push(x0,z0, x0,z1, x1,z0,  x1,z0, x0,z1, x1,z1);
  }
  const arr=new Float32Array(v);
  gridCount=arr.length/2;
  gridBuf=device.createBuffer({size:arr.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(gridBuf,0,arr);
}

function makeGeo(name,arr){
  const b=device.createBuffer({size:arr.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(b,0,arr);
  GEO[name]={buf:b,count:arr.length/6};
}
function buildGeometry(){
  makeGeo('box',boxGeo());
  makeGeo('cyl',cylGeo(12));
  makeGeo('sph',sphereGeo(12,8));
  makeGeo('cone',coneGeo(7));
  instBuf=device.createBuffer({size:instData.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  trailBuf=device.createBuffer({size:trailVerts.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  sprayBuf=device.createBuffer({size:sprayVerts.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
}

function buildPipelines(){
  uniTerrain=device.createBuffer({size:16*4+4*4*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  uniSolid  =device.createBuffer({size:16*4+2*4*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  featBuf   =device.createBuffer({size:256*8*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});

  const terrMod=device.createShaderModule({code:TERRAIN_WGSL});
  pipeTerrain=device.createRenderPipeline({
    layout:'auto',
    vertex:{module:terrMod,entryPoint:'vs',buffers:[
      {arrayStride:8,attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},
    fragment:{module:terrMod,entryPoint:'fs',targets:[{format:fmt}]},
    primitive:{topology:'triangle-list',cullMode:'none'},
    depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}
  });
  bgTerrain=device.createBindGroup({layout:pipeTerrain.getBindGroupLayout(0),
    entries:[{binding:0,resource:{buffer:uniTerrain}},{binding:1,resource:{buffer:featBuf}}]});

  const solMod=device.createShaderModule({code:SOLID_WGSL});
  pipeSolid=device.createRenderPipeline({
    layout:'auto',
    vertex:{module:solMod,entryPoint:'vs',buffers:[
      {arrayStride:24,attributes:[
        {shaderLocation:0,offset:0,format:'float32x3'},
        {shaderLocation:1,offset:12,format:'float32x3'}]},
      {arrayStride:80,stepMode:'instance',attributes:[
        {shaderLocation:2,offset:0, format:'float32x4'},
        {shaderLocation:3,offset:16,format:'float32x4'},
        {shaderLocation:4,offset:32,format:'float32x4'},
        {shaderLocation:5,offset:48,format:'float32x4'},
        {shaderLocation:6,offset:64,format:'float32x4'}]}]},
    fragment:{module:solMod,entryPoint:'fs',targets:[{format:fmt}]},
    primitive:{topology:'triangle-list',cullMode:'none'},
    depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}
  });
  bgSolid=device.createBindGroup({layout:pipeSolid.getBindGroupLayout(0),
    entries:[{binding:0,resource:{buffer:uniSolid}}]});

  const flatMod=device.createShaderModule({code:FLAT_WGSL});
  pipeFlat=device.createRenderPipeline({
    layout:'auto',
    vertex:{module:flatMod,entryPoint:'vs',buffers:[
      {arrayStride:28,attributes:[
        {shaderLocation:0,offset:0, format:'float32x3'},
        {shaderLocation:1,offset:12,format:'float32x4'}]}]},
    fragment:{module:flatMod,entryPoint:'fs',targets:[{format:fmt,blend:{
      color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},
      alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},
    primitive:{topology:'triangle-list',cullMode:'none'},
    depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}
  });
}

// ═══════════════════ FEATURE UPLOAD ═══════════════════
// The window of cells around the rider, refreshed when the rider crosses one.
// This is what keeps the drawn snow identical to the ridden snow.
const KIND={kicker:0,hip:0,roller:1,cliff:2};
const featArr=new Float32Array(256*8);
let featCount=0,featKey='';
function uploadFeatures(){
  const i0=Math.round(R.x/FEAT_SX), j0=Math.round(R.z/FEAT_SZ);
  const key=i0+'|'+j0;
  if(key===featKey)return;
  featKey=key;
  let n=0;
  for(let i=i0-2;i<=i0+2&&n<256;i++)
    for(let j=j0-2;j<=j0+4&&n<256;j++){
      const f=featureAt(i,j); if(!f)continue;
      const o=n*8;
      featArr[o]=f.x; featArr[o+1]=f.z; featArr[o+2]=f.amp;
      featArr[o+3]=f.len; featArr[o+4]=f.wid; featArr[o+5]=KIND[f.kind]||0;
      n++;
    }
  featCount=n;
  device.queue.writeBuffer(featBuf,0,featArr,0,Math.max(8,n*8));
}

// ═══════════════════ INSTANCES ═══════════════════
const _m=mat4();
let inst={box:[],cyl:[],sph:[],cone:[]};
function pushInst(kind,p,q,s,col){
  trs(_m,p,q,s);
  inst[kind].push({m:Float32Array.from(_m),c:col});
}
function drawInstanced(pass,kind){
  const list=inst[kind];
  if(!list.length)return;
  let n=Math.min(list.length,INST_MAX);
  for(let i=0;i<n;i++){
    instData.set(list[i].m,i*20);
    instData.set(list[i].c,i*20+16);
  }
  device.queue.writeBuffer(instBuf,0,instData,0,n*20);
  pass.setPipeline(pipeSolid);
  pass.setBindGroup(0,bgSolid);
  pass.setVertexBuffer(0,GEO[kind].buf);
  pass.setVertexBuffer(1,instBuf);
  pass.draw(GEO[kind].count,n,0,0);
}

// ═══════════════════ TRACK + POWDER (mirrors the WebGL renderer) ═════════
function pushTrail(){
  const dx=R.x-lastTrailX, dz=R.z-lastTrailZ;
  if(dx*dx+dz*dz<0.16)return;
  lastTrailX=R.x;lastTrailZ=R.z;
  const w=0.16+Math.abs(R.edge)*0.09+Math.min(R.skid,1.5)*0.10;
  const nx=Math.cos(R.drift), nz=-Math.sin(R.drift);
  if(trailN>=TRAIL_MAX){ trailVerts.copyWithin(0,14); trailN=TRAIL_MAX-1; }
  const o=trailN*14;
  for(let s=0;s<2;s++){
    const sx=R.x+nx*w*(s?1:-1), sz=R.z+nz*w*(s?1:-1);
    const b=o+s*7;
    trailVerts[b]=sx; trailVerts[b+1]=terrainH(sx,sz)+0.09; trailVerts[b+2]=sz;
  }
  trailN++;
  for(let i=0;i<trailN;i++){
    const age=i/Math.max(1,trailN-1);
    const f=0.30+0.55*age;
    for(let s=0;s<2;s++){
      const b=(i*2+s)*7;
      trailVerts[b+3]=0.52*f+0.10; trailVerts[b+4]=0.60*f+0.12;
      trailVerts[b+5]=0.78*f+0.16; trailVerts[b+6]=0.62;
    }
  }
}
// expand the ribbon samples into triangles for drawing
const ribbonTris=new Float32Array((TRAIL_MAX-1)*6*7);
function ribbonVertexCount(){
  const quads=Math.max(0,trailN-1);
  for(let i=0;i<quads;i++){
    const a=(i*2)*7, b=(i*2+1)*7, c=(i*2+2)*7, d=(i*2+3)*7;
    const idx=[a,c,b, b,c,d];
    for(let k=0;k<6;k++) ribbonTris.set(trailVerts.subarray(idx[k],idx[k]+7),(i*6+k)*7);
  }
  return quads*6;
}

function emitSpray(n,speed,spread){
  for(let k=0;k<n;k++){
    const i=sprayN%SPRAY_MAX; sprayN++;
    const nx=Math.cos(R.drift), nz=-Math.sin(R.drift);
    const side=-Math.sign(R.edge||1);
    const o=i*7;
    sprayState[o]=R.x+nx*side*0.35;
    sprayState[o+1]=R.y+0.10;
    sprayState[o+2]=R.z+nz*side*0.35;
    sprayState[o+3]=nx*side*speed*(0.5+Math.random())+(Math.random()-0.5)*spread-Math.sin(R.drift)*R.v*0.20;
    sprayState[o+4]=speed*(0.55+Math.random()*0.8);
    sprayState[o+5]=nz*side*speed*(0.5+Math.random())+(Math.random()-0.5)*spread-Math.cos(R.drift)*R.v*0.20;
    sprayState[o+6]=0.55+Math.random()*0.45;
  }
}
function stepSpray(dt,right,up){
  let n=0;
  for(let i=0;i<SPRAY_MAX;i++){
    const o=i*7;
    if(sprayState[o+6]<=0)continue;
    sprayState[o+6]-=dt;
    sprayState[o+4]-=7.5*dt;
    sprayState[o+3]*=(1-1.8*dt); sprayState[o+5]*=(1-1.8*dt);
    sprayState[o]+=sprayState[o+3]*dt;
    sprayState[o+1]+=sprayState[o+4]*dt;
    sprayState[o+2]+=sprayState[o+5]*dt;
    if(sprayState[o+6]<=0)continue;
    // camera-facing quad
    const s=0.16, a=Math.min(1,sprayState[o+6]*1.6);
    const px=sprayState[o],py=sprayState[o+1],pz=sprayState[o+2];
    const corners=[[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]];
    for(const [cx,cy] of corners){
      const b=n*7;
      sprayVerts[b]  =px+(right[0]*cx+up[0]*cy)*s;
      sprayVerts[b+1]=py+(right[1]*cx+up[1]*cy)*s;
      sprayVerts[b+2]=pz+(right[2]*cx+up[2]*cy)*s;
      sprayVerts[b+3]=1; sprayVerts[b+4]=1; sprayVerts[b+5]=1; sprayVerts[b+6]=a*0.85;
      n++;
    }
  }
  return n;
}

// ═══════════════════ CAMERA (same behaviour as the WebGL renderer) ═══════
const camPos=[0,0,0], camTgt=[0,0,0];
let camInit=false;
function stepCamera(dt){
  const back=6.4+R.v*0.11, up=3.4+R.v*0.075+Math.max(0,R.y-terrainH(R.x,R.z))*0.5;
  const cz=R.z-Math.cos(R.drift)*back, cx=R.x-Math.sin(R.drift)*back;
  const wantY=Math.max(baseY(cz)+up, terrainH(cx,cz)+2.2);
  const lx=R.x+Math.sin(R.drift)*22, lz=R.z+Math.cos(R.drift)*22;
  const look=[lx,terrainH(lx,lz)+1.4,lz];
  if(!camInit){ camPos[0]=cx;camPos[1]=wantY;camPos[2]=cz;
                camTgt[0]=look[0];camTgt[1]=look[1];camTgt[2]=look[2]; camInit=true; }
  const k=1-Math.exp(-4.0*dt);
  camPos[0]+=(cx-camPos[0])*k; camPos[1]+=(wantY-camPos[1])*k; camPos[2]+=(cz-camPos[2])*k;
  camTgt[0]+=(look[0]-camTgt[0])*k; camTgt[1]+=(look[1]-camTgt[1])*k; camTgt[2]+=(look[2]-camTgt[2])*k;
  const floor=terrainH(camPos[0],camPos[2])+1.8;
  if(camPos[1]<floor)camPos[1]=floor;
  if(R.shake>0.001){
    const s=R.shake*R.shake*0.55;
    camPos[0]+=(Math.random()-0.5)*s; camPos[1]+=(Math.random()-0.5)*s; camPos[2]+=(Math.random()-0.5)*s;
  }
}

// ═══════════════════ SIZING ═══════════════════
let _vw=0,_vh=0;
const projM=mat4(),viewM=mat4(),vpM=mat4();
function resize(){
  const host=canvas.parentNode;
  const dpr=Math.min(2,devicePixelRatio||1);
  const w=Math.max(1,Math.round(host.clientWidth*dpr));
  const h=Math.max(1,Math.round(host.clientHeight*dpr));
  if(w===_vw&&h===_vh)return;
  _vw=w;_vh=h;
  canvas.width=w; canvas.height=h;
  if(depthTex)depthTex.destroy();
  depthTex=device.createTexture({size:[w,h],format:'depth24plus',
    usage:GPUTextureUsage.RENDER_ATTACHMENT});
  depthView=depthTex.createView();
}

// ═══════════════════ FRAME ═══════════════════
const SUN=[-26,20,-12];
const uniT=new Float32Array(16+4*4);
const uniS=new Float32Array(16+2*4);

function frame(now){
  requestAnimationFrame(frame);
  if(!device)return;
  resize();
  const dt=Math.min(0.033,(now-lastT)/1000); lastT=now;

  S.step(dt);
  stepCamera(dt);
  uploadFeatures();

  // camera basis, for the powder billboards
  let fx=camTgt[0]-camPos[0], fy=camTgt[1]-camPos[1], fz=camTgt[2]-camPos[2];
  const fl=Math.hypot(fx,fy,fz)||1; fx/=fl;fy/=fl;fz/=fl;
  let rx=fz*0-fy*0, ry=0, rz=0;
  rx=fz; rz=-fx; const rl=Math.hypot(rx,rz)||1; rx/=rl; rz/=rl; ry=0;
  const ux=ry*fz-0*fy, uy=rz*fx-rx*fz, uz=0*fy-ry*fx;
  const right=[rx,ry,rz], upv=[ux,uy,uz];

  perspective(projM,52*Math.PI/180,_vw/_vh,0.1,900);
  lookAt(viewM,camPos,camTgt,[0,1,0]);
  mul(vpM,projM,viewM);

  originX=Math.round(R.x/GS)*GS;
  originZ=Math.round(R.z/GS)*GS;

  uniT.set(vpM,0);
  uniT.set([camPos[0],camPos[1],camPos[2],0],16);
  uniT.set([SUN[0],SUN[1],SUN[2],0],20);
  uniT.set([originX,originZ,featCount,0],24);
  uniT.set([0.40,0.15,140,0.10],28);
  uniT.set([53,3.4,0,0],32);
  device.queue.writeBuffer(uniTerrain,0,uniT);

  uniS.set(vpM,0);
  uniS.set([camPos[0],camPos[1],camPos[2],0],16);
  uniS.set([SUN[0],SUN[1],SUN[2],0],20);
  device.queue.writeBuffer(uniSolid,0,uniS);

  // ── build this frame's instances ──
  inst={box:[],cyl:[],sph:[],cone:[]};
  const parts=partsFromPose(S.currentPose());
  const bi=bodyInertia(parts);
  const bf=parts.bf;
  const lift=bf?dot3(sub3(bi.com,bf.c),bf.bn):0.9;
  const q=[R.q[0],R.q[1],R.q[2],R.q[3]];
  for(const p of parts){
    const rel=[p.pos[0]-bi.com[0],p.pos[1]-bi.com[1],p.pos[2]-bi.com[2]];
    const wr=qRot(q,rel);
    const wp=[R.x+wr[0],R.y+lift+wr[1],R.z+wr[2]];
    const pq=p.ori?[p.ori.w,p.ori.x,p.ori.y,p.ori.z]:[1,0,0,0];
    const wq=qMul(q,pq);
    const col=(p.color!==undefined)
      ? [((p.color>>16)&255)/255,((p.color>>8)&255)/255,(p.color&255)/255,1]
      : [0.17,0.23,0.32,1];
    if(p.shape==='box')      pushInst('box',wp,wq,[p.dims[0],p.dims[1],p.dims[2]],col);
    else if(p.shape==='sphere')pushInst('sph',wp,wq,[p.dims[0]*2,p.dims[0]*2,p.dims[0]*2],col);
    else                     pushInst('cyl',wp,wq,[p.dims[0]*2,p.dims[1],p.dims[0]*2],col);
  }
  // props
  const pi0=Math.round(R.x/PROP_SX), pj0=Math.round(R.z/PROP_SZ);
  for(let j=pj0-3;j<=pj0+14;j++)for(let i=pi0-4;i<=pi0+4;i++){
    const p=propAt(i,j); if(!p)continue;
    const y=terrainH(p.x,p.z)-0.25;
    if(p.tree){
      pushInst('cyl',[p.x,y+0.75*p.s,p.z],[1,0,0,0],[0.32*p.s,1.5*p.s,0.32*p.s],[0.29,0.23,0.18,1]);
      pushInst('cone',[p.x,y+2.5*p.s,p.z],[1,0,0,0],[2.3*p.s,3.2*p.s,2.3*p.s],[0.18,0.27,0.21,1]);
      pushInst('cone',[p.x,y+3.5*p.s,p.z],[1,0,0,0],[1.9*p.s,1.5*p.s,1.9*p.s],[0.96,0.97,1,1]);
    }else{
      pushInst('sph',[p.x,y+0.4*p.s,p.z],[1,0,0,0],[1.7*p.s,1.2*p.s,1.7*p.s],[0.42,0.37,0.33,1]);
      pushInst('sph',[p.x,y+0.85*p.s,p.z],[1,0,0,0],[1.4*p.s,0.5*p.s,1.4*p.s],[0.92,0.95,0.99,1]);
    }
  }
  // piste markers
  const mi0=Math.round(R.x/44), mj0=Math.floor((R.z-24)/22);
  for(let n=0;n<20;n++){
    const jj=mj0+(n>>1), ii=mi0+((n&1)?0:1);
    const x=ii*44-22, z=jj*22;
    const y=terrainH(x,z);
    pushInst('cyl',[x,y+1.3,z],[1,0,0,0],[0.14,2.6,0.14],[0.11,0.14,0.19,1]);
    pushInst('cyl',[x,y+2.5,z],[1,0,0,0],[0.34,0.5,0.34],[1,0.48,0.10,1]);
  }

  if(!R.air&&S.crashTime()<=0)pushTrail();
  const ribbonCount=ribbonVertexCount();
  if(ribbonCount)device.queue.writeBuffer(trailBuf,0,ribbonTris,0,ribbonCount*7);
  const sprayCount=stepSpray(dt,right,upv);
  if(sprayCount)device.queue.writeBuffer(sprayBuf,0,sprayVerts,0,sprayCount*7);

  // ── record ──
  const enc=device.createCommandEncoder();
  const pass=enc.beginRenderPass({
    colorAttachments:[{view:ctx.getCurrentTexture().createView(),
      clearValue:{r:0.56,g:0.70,b:0.87,a:1},loadOp:'clear',storeOp:'store'}],
    depthStencilAttachment:{view:depthView,depthClearValue:1.0,
      depthLoadOp:'clear',depthStoreOp:'store'}
  });
  pass.setPipeline(pipeTerrain);
  pass.setBindGroup(0,bgTerrain);
  pass.setVertexBuffer(0,gridBuf);
  pass.draw(gridCount,1,0,0);

  drawInstanced(pass,'box');
  drawInstanced(pass,'cyl');
  drawInstanced(pass,'sph');
  drawInstanced(pass,'cone');

  if(ribbonCount){
    pass.setPipeline(pipeFlat);
    pass.setBindGroup(0,bgSolid);
    pass.setVertexBuffer(0,trailBuf);
    pass.draw(ribbonCount,1,0,0);
  }
  if(sprayCount){
    pass.setPipeline(pipeFlat);
    pass.setBindGroup(0,bgSolid);
    pass.setVertexBuffer(0,sprayBuf);
    pass.draw(sprayCount,1,0,0);
  }
  pass.end();
  device.queue.submit([enc.finish()]);

  S.updHUD();
}

let lastT=performance.now();
boot().then(ok=>{
  if(!ok)return;
  S.HOOK.trail=pushTrail;
  S.HOOK.spray=emitSpray;
  S.HOOK.reset=()=>{trailN=0;sprayN=0;sprayState.fill(0);};
  S.HOOK.trailBreak=(x,z)=>{trailN=0;lastTrailX=x;lastTrailZ=z;};
  window.RIDE=Object.assign({},S,{backend:'webgpu',
    trailCount:()=>trailN, sprayCount:()=>sprayN});
  S.reset();
  S.warpFromHash();
  lastT=performance.now();
  requestAnimationFrame(frame);
});
})();
