// ═══════════════════════════════════════════════════════════════════════
//  SHARED ENGINE — physics, body model, pose library, landing bands.
//
//  Extracted verbatim from game.js so more than one page can ride on the
//  same simulation. It computes bodies and outcomes; it does not draw them,
//  and it touches no DOM. It does depend on three.js for exactly one thing:
//  each part carries an `ori` THREE.Quaternion for convenient rendering, so
//  three.min.js must be loaded first.
//
//  Whoever loads this owns the scene and turns parts into meshes.
//  Loaded as a plain script before its consumers; top-level declarations
//  are visible to any script that follows.
// ═══════════════════════════════════════════════════════════════════════
"use strict";
// ═══════════════════ MATH (ported verbatim from the flip simulator) ═══════════════════
function qMul(a,b){return[a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3],
  a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],
  a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1],
  a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];}
function qConj(q){return[q[0],-q[1],-q[2],-q[3]];}
function qNorm(q){const n=Math.hypot(q[0],q[1],q[2],q[3])||1;return[q[0]/n,q[1]/n,q[2]/n,q[3]/n];}
function qRot(q,v){const u=qMul(qMul(q,[0,v[0],v[1],v[2]]),qConj(q));return[u[1],u[2],u[3]];}
function qRotInv(q,v){return qRot(qConj(q),v);}
function add4(a,b,s){return[a[0]+b[0]*s,a[1]+b[1]*s,a[2]+b[2]*s,a[3]+b[3]*s];}
function add3(a,b,s){return[a[0]+b[0]*s,a[1]+b[1]*s,a[2]+b[2]*s];}
const addv=add3;
function nrm(v){const n=Math.hypot(v[0],v[1],v[2])||1;return[v[0]/n,v[1]/n,v[2]/n];}
function mv3(M,v){return[M[0][0]*v[0]+M[0][1]*v[1]+M[0][2]*v[2],
  M[1][0]*v[0]+M[1][1]*v[1]+M[1][2]*v[2], M[2][0]*v[0]+M[2][1]*v[1]+M[2][2]*v[2]];}
function inv3(m){const a=m[0][0],b=m[0][1],c=m[0][2],d=m[1][0],e=m[1][1],f=m[1][2],g=m[2][0],h=m[2][1],i=m[2][2];
  const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g;const det=a*A+b*B+c*C||1e-12;const id=1/det;
  return[[A*id,-(b*i-c*h)*id,(b*f-c*e)*id],[B*id,(a*i-c*g)*id,-(a*f-c*d)*id],[C*id,-(a*h-b*g)*id,(a*e-b*d)*id]];}
function slerpV(a,b,f){let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2];d=Math.max(-1,Math.min(1,d));
  if(d>0.9995) return nrm([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f]);
  const th=Math.acos(d),st=Math.sin(th);const w1=Math.sin((1-f)*th)/st,w2=Math.sin(f*th)/st;
  return nrm([a[0]*w1+b[0]*w2,a[1]*w1+b[1]*w2,a[2]*w1+b[2]*w2]);}
function qSlerp(a,b,f){
  let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
  if(d<0){b=[-b[0],-b[1],-b[2],-b[3]];d=-d;}
  if(d>0.9995)return qNorm([0,1,2,3].map(i=>a[i]+(b[i]-a[i])*f));
  const th=Math.acos(Math.max(-1,Math.min(1,d))),st=Math.sin(th);
  const w1=Math.sin((1-f)*th)/st,w2=Math.sin(f*th)/st;
  return qNorm([0,1,2,3].map(i=>a[i]*w1+b[i]*w2));}
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const rad=d=>d*Math.PI/180;
function cross3(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
const sub3=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
function rotAxis(v,k,a){const c=Math.cos(a),s=Math.sin(a),kv=cross3(k,v),kd=dot3(k,v);
  return[v[0]*c+kv[0]*s+k[0]*kd*(1-c),v[1]*c+kv[1]*s+k[1]*kd*(1-c),v[2]*c+kv[2]*s+k[2]*kd*(1-c)];}
function qFromR(R){
  const t=R[0][0]+R[1][1]+R[2][2];let q;
  if(t>0){const s=Math.sqrt(t+1)*2;q=[0.25*s,(R[2][1]-R[1][2])/s,(R[0][2]-R[2][0])/s,(R[1][0]-R[0][1])/s];}
  else if(R[0][0]>R[1][1]&&R[0][0]>R[2][2]){const s=Math.sqrt(1+R[0][0]-R[1][1]-R[2][2])*2;
    q=[(R[2][1]-R[1][2])/s,0.25*s,(R[0][1]+R[1][0])/s,(R[0][2]+R[2][0])/s];}
  else if(R[1][1]>R[2][2]){const s=Math.sqrt(1+R[1][1]-R[0][0]-R[2][2])*2;
    q=[(R[0][2]-R[2][0])/s,(R[0][1]+R[1][0])/s,0.25*s,(R[1][2]+R[2][1])/s];}
  else{const s=Math.sqrt(1+R[2][2]-R[0][0]-R[1][1])*2;
    q=[(R[1][0]-R[0][1])/s,(R[0][2]+R[2][0])/s,(R[1][2]+R[2][1])/s,0.25*s];}
  return qNorm(q);}
const qFromDir=d=>{let w=1+d[1],x=d[2],y=0,z=-d[0];
  if(w<1e-6){w=0;x=0;y=0;z=1;}
  const n=Math.hypot(w,x,y,z)||1;return[w/n,x/n,y/n,z/n];};
const RfromQ=q=>{const w=q[0],x=q[1],y=q[2],z=q[3];
  const x2=x+x,y2=y+y,z2=z+z;
  const xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
  return[[1-(yy+zz),xy-wz,xz+wy],[xy+wz,1-(xx+zz),yz-wx],[xz-wy,yz+wx,1-(xx+yy)]];};
function localInertia(p){const m=p.m;
  if(p.shape==='box'){const[lx,ly,lz]=p.dims;return[m/12*(ly*ly+lz*lz),m/12*(lx*lx+lz*lz),m/12*(lx*lx+ly*ly)];}
  if(p.shape==='sphere'){const s=0.4*m*p.dims[0]*p.dims[0];return[s,s,s];}
  const[r,h]=p.dims;const radI=m/12*(3*r*r+h*h);return[radI,0.5*m*r*r,radI];}
function bodyInertia(parts){
  let M=0,com=[0,0,0];
  for(const p of parts){M+=p.m;com[0]+=p.m*p.pos[0];com[1]+=p.m*p.pos[1];com[2]+=p.m*p.pos[2];}
  com=[com[0]/M,com[1]/M,com[2]/M];
  const It=[[0,0,0],[0,0,0],[0,0,0]];
  for(const p of parts){
    const d0=localInertia(p),R=p.R;
    if(R){for(let i=0;i<3;i++)for(let j=0;j<3;j++){let v=0;for(let k=0;k<3;k++)v+=R[i][k]*d0[k]*R[j][k];It[i][j]+=v;}}
    else{It[0][0]+=d0[0];It[1][1]+=d0[1];It[2][2]+=d0[2];}
    const d=[p.pos[0]-com[0],p.pos[1]-com[1],p.pos[2]-com[2]],d2=d[0]*d[0]+d[1]*d[1]+d[2]*d[2];
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)It[i][j]+=p.m*((i===j?d2:0)-d[i]*d[j]);
  }
  return{M,com,I:It};
}
// ═══════════════════ BODY MODEL (ported from the flip simulator) ═══════════════════
const BW=85;
const BOARD={len:1.55,waist:0.253,mass:3.0};           // Nitro Beast 155
const boardColor=0x2f7fff, FRONT=0x2f7fff;
function resolveMasses(parts){let sf=0;for(const p of parts)if(p.group!=='board')sf+=p.frac;
  for(const p of parts){if(p.group==='board')continue;p.m=BW*(p.frac||0)/sf;}}
function bone(frac,group,A,B,r,shape='cyl',crossX,crossZ){
  const dv=[B[0]-A[0],B[1]-A[1],B[2]-A[2]],len=Math.hypot(dv[0],dv[1],dv[2])||1e-6;
  const q=qFromDir([dv[0]/len,dv[1]/len,dv[2]/len]);
  const R=RfromQ(q);
  return{shape,frac,group,dims:shape==='cyl'?[r,len]:[crossX,len,(crossZ!==undefined?crossZ:crossX)],
    pos:[(A[0]+B[0])/2,(A[1]+B[1])/2,(A[2]+B[2])/2],R,
    ori:new THREE.Quaternion(q[1],q[2],q[3],q[0])};
}
const SEG={Lthigh:0.44,Lshank:0.43,Ltrunk:0.53,Lhead:0.22,Lupper:0.32,Lfore:0.27,Lhand:0.10,
  Lpelvis:0.16,Lupperbody:0.37,
  rThigh:0.085,rShank:0.057,rUpper:0.047,rFore:0.041,rHead:0.105,rHand:0.05,
  trunkW:0.34,trunkD:0.21,pelvisW:0.32,pelvisD:0.22,
  footL:0.27,footH:0.05,footW:0.10,spine:0.06,hipHalf:0.11,shoulderHalf:0.19,
  stance:0.55,ankleH:0.09,
  fThigh:0.1416,fShank:0.0433,fFoot:0.0137,
  fPelvis:0.1117,fUpperBody:0.3229,
  fHead:0.0694,fUpper:0.0271,fFore:0.0162,fHand:0.0061};
const BOOT={ankleFromHeel:0.34,angleFront:15,angleRear:-6};
const ARCH_LIM=20,FLEX_LIM=75,SIDE_LIM=35;
function clampSpine(tr){
  const t=nrm(tr);
  let side=Math.asin(Math.max(-1,Math.min(1,t[0])))*180/Math.PI;
  side=Math.max(-SIDE_LIM,Math.min(SIDE_LIM,side));
  let lean=Math.atan2(t[2],t[1])*180/Math.PI;
  lean=Math.max(-ARCH_LIM,Math.min(FLEX_LIM,lean));
  const rs=rad(side),rl=rad(lean),cs=Math.cos(rs);
  return nrm([Math.sin(rs),cs*Math.cos(rl),cs*Math.sin(rl)]);
}
function segClosest(P,A,B){
  const AB=[B[0]-A[0],B[1]-A[1],B[2]-A[2]],d2=dot3(AB,AB)||1;
  const t=Math.max(0,Math.min(1,dot3([P[0]-A[0],P[1]-A[1],P[2]-A[2]],AB)/d2));
  return[A[0]+AB[0]*t,A[1]+AB[1]*t,A[2]+AB[2]*t];
}
function inside(P,pr){
  const C=pr.b?segClosest(P,pr.a,pr.b):pr.a;
  return pr.r-Math.hypot(P[0]-C[0],P[1]-C[1],P[2]-C[2]);
}
function pushOut(P,prims){
  let o=P.slice();
  for(let it=0;it<4;it++){
    let moved=false;
    for(const pr of prims){
      const C=pr.b?segClosest(o,pr.a,pr.b):pr.a;
      let d=[o[0]-C[0],o[1]-C[1],o[2]-C[2]],L=Math.hypot(d[0],d[1],d[2]);
      if(L<1e-6){d=[0,0,1];L=1;}
      if(L<pr.r){const k=(pr.r-L)/L;o=[o[0]+d[0]*k,o[1]+d[1]*k,o[2]+d[2]*k];moved=true;}
    }
    if(!moved)break;
  }
  return o;
}
function armIK(S,T,L1len,L2len,pole){
  let v=[T[0]-S[0],T[1]-S[1],T[2]-S[2]],d=Math.hypot(v[0],v[1],v[2]);
  if(d<1e-4){v=[0,-1,0];d=1;}
  const u=[v[0]/d,v[1]/d,v[2]/d];
  const dc=Math.min(Math.max(d,Math.abs(L1len-L2len)+1e-3),L1len+L2len-1e-3);
  const a=(dc*dc+L1len*L1len-L2len*L2len)/(2*dc);
  const h=Math.sqrt(Math.max(0,L1len*L1len-a*a));
  let bd=add3(pole,u,-dot3(pole,u)),bl=Math.hypot(bd[0],bd[1],bd[2]);
  if(bl<1e-5){bd=add3([0,0,1],u,-dot3([0,0,1],u));bl=Math.hypot(bd[0],bd[1],bd[2]);
    if(bl<1e-5){bd=[1,0,0];bl=1;}}
  bd=[bd[0]/bl,bd[1]/bl,bd[2]/bl];
  const Ept=[S[0]+u[0]*a+bd[0]*h,S[1]+u[1]*a+bd[1]*h,S[2]+u[2]*a+bd[2]*h];
  return{up:nrm([Ept[0]-S[0],Ept[1]-S[1],Ept[2]-S[2]]),
         fore:nrm([T[0]-Ept[0],T[1]-Ept[1],T[2]-Ept[2]])};
}
function solveArm(sh,T,prims,s){
  let A=null;
  for(const k of [1.0,1.7,2.6,4.0]){
    A=armIK(sh,T,SEG.Lupper,SEG.Lfore,nrm([s*k,-0.25,-0.45]));
    const Ept=addv(sh,A.up,SEG.Lupper);
    if(!prims.some(pr=>inside(Ept,pr)>0.01))return A;
  }
  return A;
}
function kneePoleFor(hip,ankle,pelvLat,pFront,s){
  const v=[ankle[0]-hip[0],ankle[1]-hip[1],ankle[2]-hip[2]];
  const d=Math.hypot(v[0],v[1],v[2])||1e-6;
  const u=[v[0]/d,v[1]/d,v[2]/d];
  let pd=cross3(pelvLat,u);
  let pl=Math.hypot(pd[0],pd[1],pd[2]);
  if(pl<1e-4)return nrm(add3(pFront,pelvLat,s*0.20));
  pd=[pd[0]/pl,pd[1]/pl,pd[2]/pl];
  const fore=dot3(pd,pFront);
  const flip=(Math.abs(fore)<0.25)?(dot3(pd,[0,1,0])<0):(fore<0);
  if(flip)pd=[-pd[0],-pd[1],-pd[2]];
  return nrm(add3(pd,pelvLat,s*0.15));
}
function boardFrame(B){
  const t=rad(B.tilt||0),y=rad(B.yaw||0),r=rad(B.roll||0);
  const bx=nrm([Math.cos(t)*Math.cos(y),Math.sin(t),-Math.cos(t)*Math.sin(y)]);
  let bn=nrm(add3([0,1,0],bx,-dot3([0,1,0],bx)));
  if(Math.abs(r)>1e-6)bn=nrm(rotAxis(bn,bx,r));
  return{c:B.c.slice(),bx,bn,bz:cross3(bx,bn)};
}
// ═══════════════════ POSE LIBRARY (ported; same numbers) ═══════════════════
const GRAB_TRUNK=nrm([0,0.71,0.71]),GRAB_HEAD=nrm([0,0.90,0.44]);
const GRAB_HIP=0.94;
const GRAB_BOARD={c:[0,0.68,0.36],tilt:0,roll:0};
const DFL_L=[-0.5,1.4,0.1],DFL_R=[0.5,1.4,0.1];
const POSE_STD={
  'Athletic stance':{hipY:0.86,trunk:nrm([0,0.97,0.24]),head:nrm([0,0.98,0.20]),
    board:{c:[0,0.02,0.14],tilt:0,roll:0},handL:[-0.42,0.95,0.25],handR:[0.42,0.95,0.25]},
  'Tuck':{hipY:0.88,trunk:nrm([0,0.82,0.57]),head:nrm([0,0.94,0.34]),
    board:{c:[0,0.45,0.34],tilt:0,roll:0},handL:[-0.33,0.77,0.43],handR:[0.33,0.77,0.43]},
  'Landing crouch':{hipY:0.74,trunk:nrm([0,0.94,0.34]),head:nrm([0,0.96,0.28]),twist:20,
    board:{c:[0,0.00,0.16],tilt:0,roll:0},handL:[-0.48,0.80,0.30],handR:[0.48,0.80,0.30]},
  'Counter-rotate':{hipY:0.86,trunk:nrm([0,0.94,0.34]),head:nrm([0,0.97,0.24]),twist:55,
    board:{c:[0,0.20,0.24],tilt:0,roll:0},handL:[-0.50,1.05,0.34],handR:[0.50,1.05,0.34]},
  'Wind-up':{hipY:0.86,trunk:nrm([0,0.94,0.34]),head:nrm([0,0.97,0.24]),twist:-55,
    board:{c:[0,0.20,0.24],tilt:0,roll:0},handL:[-0.50,1.05,0.34],handR:[0.50,1.05,0.34]},
  'Sprawl':{hipY:0.95,trunk:nrm([0,0.95,0.31]),head:[0,1,0],
    board:{c:[0,0.14,0.34],tilt:0,roll:35},handL:[-0.80,1.40,0.30],handR:[0.80,1.40,0.30]},
  'Shifty (frontside)':{hipY:0.90,trunk:nrm([0,0.90,0.44]),head:nrm([0,0.96,0.28]),twist:-85,pyaw:30,
    board:{c:[0,0.38,0.30],tilt:0,roll:0,yaw:80},handL:[-0.60,1.13,0.21],handR:[0.66,1.08,0.25]},
  'Shifty (backside)':{hipY:0.90,trunk:nrm([0,0.90,0.44]),head:nrm([0,0.96,0.28]),twist:85,pyaw:-30,
    board:{c:[0,0.38,0.30],tilt:0,roll:0,yaw:-80},handL:[-0.66,1.08,0.25],handR:[0.60,1.13,0.21]},
  'Mute grab':{hipY:GRAB_HIP,trunk:GRAB_TRUNK,head:GRAB_HEAD,board:GRAB_BOARD,
    grabR:{along:0.18,edge:1},handL:[-0.62,1.30,0.20]},
  'Indy grab':{hipY:GRAB_HIP,trunk:GRAB_TRUNK,head:GRAB_HEAD,board:GRAB_BOARD,
    grabL:{along:-0.12,edge:1},handR:[0.62,1.30,0.20]},
  'Melon grab':{hipY:GRAB_HIP,trunk:GRAB_TRUNK,head:GRAB_HEAD,board:GRAB_BOARD,
    grabR:{along:0.16,edge:-1},handL:[-0.62,1.30,0.20]},
  'Stalefish':{hipY:GRAB_HIP,trunk:GRAB_TRUNK,head:GRAB_HEAD,board:GRAB_BOARD,
    grabL:{along:-0.25,edge:-1},handR:[0.62,1.30,0.20]},
  'Nose grab':{hipY:0.88,trunk:GRAB_TRUNK,head:GRAB_HEAD,
    board:{c:[0,0.38,0.54],tilt:45,roll:0},grabR:{along:0.85,edge:0},handL:[-0.62,1.30,0.20]},
  'Tail grab':{hipY:0.88,trunk:GRAB_TRUNK,head:GRAB_HEAD,
    board:{c:[0,0.38,0.54],tilt:-45,roll:0},grabL:{along:-0.85,edge:0},handR:[0.62,1.30,0.20]},
  'Method (heel tweak)':{hipY:0.62,trunk:nrm([0,0.996,0.087]),head:nrm([0,0.99,0.10]),
    twist:25,pyaw:-20,
    board:{c:[0,0.94,0.01],tilt:20,roll:-45,yaw:-30},
    grabR:{along:-0.10,edge:-1},
    handL:[-0.15,1.67,-0.05]},
};
const poseOf=n=>POSE_STD[n]||POSE_STD['Athletic stance'];
const isTrick=n=>{const P=poseOf(n);return !!(P.grabL||P.grabR);};
const lerp3=(a,b,f)=>[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f];
const L1=(a,b,f)=>a+(b-a)*f;
const handOf=H=>Array.isArray(H)?{a:H,b:H,f:0}:H;
const neutralHand=(sh,s)=>[sh[0]+s*0.24,sh[1]-0.48,sh[2]+0.14];
function viaTarget(H,sh,s){
  const A=H.a,B=H.b,f=H.f||0,base=lerp3(A,B,f);
  const dist=Math.hypot(B[0]-A[0],B[1]-A[1],B[2]-A[2]);
  if(dist<0.12||f<=0||f>=1)return base;
  const N=neutralHand(sh,s),mid=lerp3(A,B,0.5);
  const bow=Math.min(1,dist/0.45)*4*f*(1-f);
  return[base[0]+(N[0]-mid[0])*bow,base[1]+(N[1]-mid[1])*bow,base[2]+(N[2]-mid[2])*bow];
}
function blendArms(A,B,f){
  const g=(a,b)=>{
    if(a&&b){
      const same=Math.abs(a.along-b.along)<0.12&&Math.abs(a.edge-b.edge)<0.3;
      if(same)return{along:L1(a.along,b.along,f),edge:L1(a.edge,b.edge,f),w:1};
      const k=(f<0.5?a:b);
      return{along:k.along,edge:k.edge,w:smooth(Math.abs(1-2*f))};
    }
    if(a)return{along:a.along,edge:a.edge,w:smooth(1-f)};
    if(b)return{along:b.along,edge:b.edge,w:smooth(f)};
    return null;
  };
  return{handL:{a:hApt(A.handL,DFL_L),b:hApt(B.handL,DFL_L),f},
    handR:{a:hApt(A.handR,DFL_R),b:hApt(B.handR,DFL_R),f},
    grabR:g(A.grabR,B.grabR),grabL:g(A.grabL,B.grabL)};
}
// a blended pose may carry an H-object hand; flatten to its current point before re-blending
function hApt(H,dfl){if(!H)return dfl;if(Array.isArray(H))return H;return lerp3(H.a,H.b,H.f||0);}
function blendPose(A,B,f){
  const bb=(a,b)=>({c:lerp3(a.c,b.c,f),tilt:L1(a.tilt||0,b.tilt||0,f),
                    roll:L1(a.roll||0,b.roll||0,f),yaw:L1(a.yaw||0,b.yaw||0,f)});
  return Object.assign({hipY:L1(A.hipY,B.hipY,f),board:bb(A.board,B.board),
    twist:L1(A.twist||0,B.twist||0,f),
    pyaw:L1(A.pyaw||0,B.pyaw||0,f),
    trunk:slerpV(A.trunk,B.trunk,f),head:slerpV(A.head,B.head,f)},
    blendArms(A,B,f));
}
const pelvisOf=D=>[(D.hipX||0),D.hipY,(D.hipZ||0)];
function buildHumanParts(D0){
  const D=Object.assign({},D0,{trunk:clampSpine(D0.trunk)});
  const p=[],pelvis=pelvisOf(D),spineBase=addv(pelvis,[0,1,0],SEG.spine),shoulderC=addv(spineBase,D.trunk,SEG.Ltrunk);
  const pyaw=rad(D.pyaw||0);
  const pelvLat=nrm(rotAxis([1,0,0],[0,1,0],pyaw));
  const pFront=cross3(pelvLat,[0,1,0]);
  const Rpn=[[pelvLat[0],0,pFront[0]],[pelvLat[1],1,pFront[1]],[pelvLat[2],0,pFront[2]]];
  const qp=qFromR(Rpn);
  const pelvisTop=addv(pelvis,[0,1,0],SEG.Lpelvis);
  p.push({shape:'box',frac:SEG.fPelvis,group:'torso',dims:[SEG.pelvisW,SEG.Lpelvis,SEG.pelvisD],
    pos:[(pelvis[0]+pelvisTop[0])/2,(pelvis[1]+pelvisTop[1])/2,(pelvis[2]+pelvisTop[2])/2],
    R:Rpn,ori:new THREE.Quaternion(qp[1],qp[2],qp[3],qp[0])});
  let lat=nrm(add3(pelvLat,D.trunk,-dot3(pelvLat,D.trunk)));
  lat=nrm(rotAxis(lat,D.trunk,rad(D.twist||0)));
  const front=cross3(lat,D.trunk);
  const Rt=[[lat[0],D.trunk[0],front[0]],[lat[1],D.trunk[1],front[1]],[lat[2],D.trunk[2],front[2]]];
  const qt=qFromR(Rt);
  const ubBase=addv(spineBase,D.trunk,SEG.Ltrunk-SEG.Lupperbody);
  const trunk={shape:'box',frac:SEG.fUpperBody,group:'torso',dims:[SEG.trunkW,SEG.Lupperbody,SEG.trunkD],
    pos:[(ubBase[0]+shoulderC[0])/2,(ubBase[1]+shoulderC[1])/2,(ubBase[2]+shoulderC[2])/2],
    R:Rt,ori:new THREE.Quaternion(qt[1],qt[2],qt[3],qt[0])};
  p.push(trunk);
  const neckEnd=addv(shoulderC,D.head,0.055);
  p.push(bone(0.017,'torso',shoulderC,neckEnd,0.052));
  const headC=addv(neckEnd,D.head,SEG.rHead*0.9);
  p.push({shape:'sphere',frac:0.0524,group:'torso',dims:[SEG.rHead],pos:headC});
  p.push({shape:'box',frac:0,group:'torso',dims:[SEG.trunkW*0.64,SEG.Lupperbody*0.78,0.02],
    pos:addv(trunk.pos,front,SEG.trunkD*0.5+0.012),R:Rt,ori:trunk.ori,color:FRONT});
  p.push({shape:'sphere',frac:0,group:'torso',dims:[0.034],pos:addv(headC,front,SEG.rHead*0.82),color:FRONT});
  const bf=boardFrame(D.board);
  {const CL=segClosest(bf.c,pelvis,shoulderC);
   let d=[bf.c[0]-CL[0],bf.c[1]-CL[1],bf.c[2]-CL[2]],dl=Math.hypot(d[0],d[1],d[2]);
   const need=0.40;
   if(dl<need){
     if(dl<1e-4){d=[0,-0.3,1];dl=Math.hypot(0,0.3,1);}
     const k=(need-dl)/dl;
     bf.c=[bf.c[0]+d[0]*k,bf.c[1]+d[1]*k,bf.c[2]+d[2]*k];
   }}
  p.bf=bf;
  const bc=bf.c,bx=bf.bx,bn=bf.bn,bz=bf.bz;
  const legs=[];
  for(const s of [-1,1]){
    const hip=addv(pelvis,pelvLat,s*SEG.hipHalf);
    const bind=addv(bc,bx,s*SEG.stance*0.5);
    const ankle=addv(bind,bn,SEG.ankleH);
    const K=armIK(hip,ankle,SEG.Lthigh,SEG.Lshank,kneePoleFor(hip,ankle,pelvLat,pFront,s));
    const knee=addv(hip,K.up,SEG.Lthigh);
    p.push(bone(SEG.fThigh,'legs',hip,knee,SEG.rThigh));
    p.push(bone(SEG.fShank,'legs',knee,ankle,SEG.rShank));
    const bAng=rad(s>0?BOOT.angleFront:BOOT.angleRear);
    const fx=nrm(add3(bx,bz,Math.tan(bAng)));
    const fz=cross3(fx,bn);
    const Rf=[[fx[0],bn[0],fz[0]],[fx[1],bn[1],fz[1]],[fx[2],bn[2],fz[2]]];
    const qf=qFromR(Rf);
    const toeShift=SEG.footL*(0.5-BOOT.ankleFromHeel);
    p.push({shape:'box',frac:SEG.fFoot,group:'legs',dims:[SEG.footW,SEG.footH,SEG.footL],
      pos:addv(addv(bind,bn,0.03),fz,toeShift),
      R:Rf,ori:new THREE.Quaternion(qf[1],qf[2],qf[3],qf[0])});
    legs.push({hip,knee,ankle});
  }
  const BODYp=[{a:pelvis,b:shoulderC,r:0.23},{a:headC,r:SEG.rHead+0.05}];
  for(const Lg of legs){BODYp.push({a:Lg.hip,b:Lg.knee,r:SEG.rThigh+0.05},
                                   {a:Lg.knee,b:Lg.ankle,r:SEG.rShank+0.05});}
  const halfL=BOARD.len*0.465;
  const DECK={a:addv(bc,bx,-halfL),b:addv(bc,bx,halfL),r:0.10};
  const onBoard=g=>addv(addv(addv(bc,bx,g.along*BOARD.len*0.45),bz,g.edge*BOARD.waist*0.55),bn,0.05);
  const windHand=(P,k)=>{if(!k)return P;
    const d=[P[0]-shoulderC[0],P[1]-shoulderC[1],P[2]-shoulderC[2]];
    const r=rotAxis(d,D.trunk,rad((D.twist||0)*k));
    return[shoulderC[0]+r[0],shoulderC[1]+r[1],shoulderC[2]+r[2]];};
  for(const s of [-1,1]){
    const sh=addv(shoulderC,lat,s*SEG.shoulderHalf);
    const gRaw=(s>0?D.grabR:D.grabL);
    const g=gRaw?(gRaw.w===undefined?Object.assign({},gRaw,{w:1}):gRaw):null;
    const gw=g?Math.max(0,Math.min(1,g.w)):0;
    const hTgt=(s>0?D.handR:D.handL)||(s>0?DFL_R:DFL_L);
    const free=windHand(viaTarget(handOf(hTgt),sh,s),1-gw);
    let T=free,grabbing=false;
    if(g){T=lerp3(free,onBoard(g),g.w);grabbing=(g.w>0.5);}
    const prims=grabbing?BODYp:BODYp.concat([DECK]);
    T=pushOut(T,prims);
    const A=solveArm(sh,T,BODYp,s);
    const elbow=addv(sh,A.up,SEG.Lupper),wrist=addv(elbow,A.fore,SEG.Lfore);
    p.push(bone(SEG.fUpper,'arms',sh,elbow,SEG.rUpper));
    p.push(bone(SEG.fFore,'arms',elbow,wrist,SEG.rFore));
    p.push(bone(SEG.fHand,'arms',wrist,addv(wrist,A.fore,SEG.Lhand),SEG.rHand,'box',0.09,0.05));
  }
  return p;
}
// the deck is emitted as 7 SEGMENTS along its length (same total mass, same
// inertia as the single box to <1%) so the renderer can BEND it — see the
// FLEX oscillator. Physics stays rigid; the flex is the board's leaf-spring
// personality: conforming, whipping, popping, chattering.
const FLEX_N=7;
function addBoard(parts){
  const bf=parts.bf;if(!bf)return;
  const R=[[bf.bx[0],bf.bn[0],bf.bz[0]],[bf.bx[1],bf.bn[1],bf.bz[1]],[bf.bx[2],bf.bn[2],bf.bz[2]]];
  const q=qFromR(R),ori=new THREE.Quaternion(q[1],q[2],q[3],q[0]);
  const segL=BOARD.len/FLEX_N;
  for(let i=0;i<FLEX_N;i++){
    const u=(i+0.5)/FLEX_N-0.5;                     // −0.5..0.5 along the deck
    parts.push({shape:'box',group:'board',m:BOARD.mass/FLEX_N,
      dims:[segL*0.96,0.035,BOARD.waist],
      pos:addv(bf.c,bf.bx,u*BOARD.len),R,ori,
      color:boardColor,metal:0.35,flexAlong:u});
  }
}
function partsFromPose(D){const p=buildHumanParts(D);resolveMasses(p);addBoard(p);return p;}
// flatten a blended descriptor so it can be re-blended (hands become plain points)
function resolvePose(P){
  return{hipY:P.hipY,trunk:P.trunk.slice(),head:P.head.slice(),
    twist:P.twist||0,pyaw:P.pyaw||0,
    board:{c:P.board.c.slice(),tilt:P.board.tilt||0,roll:P.board.roll||0,yaw:P.board.yaw||0},
    handL:hApt(P.handL,DFL_L),handR:hApt(P.handR,DFL_R),
    grabL:P.grabL?{along:P.grabL.along,edge:P.grabL.edge,w:P.grabL.w===undefined?1:P.grabL.w}:undefined,
    grabR:P.grabR?{along:P.grabR.along,edge:P.grabR.edge,w:P.grabR.w===undefined?1:P.grabR.w}:undefined};
}
// ═══════════════════ GAME ENGINE (jumps, trick gen, landing bands) ═══════════════════
const G=9.81,TAU=2*Math.PI;
// REAL-WORLD calibrated (v2). The old table hit the target airtimes by being
// slow and plungy (XL: 46 km/h landing 11 m below the lip — nothing rides like
// that). Real jumps are FAST and FLAT: long table, touchdown a few metres past
// the knuckle, carry:drop ≈ 4–5:1. Solved with real speeds, touchdown placed
// 3–6 m past the knuckle, same target airtimes (verified 1.21/1.60/1.99/2.39):
//   S  ≈ real medium park:   40 km/h, 12 m carry,  9 m table
//   M  ≈ real large park:    49 km/h, 20 m carry, 16 m table
//   L  ≈ real XL slopestyle: 56 km/h, 28 m carry, 23 m table
//   XL ≈ real big air:       63 km/h, 37 m carry, 31 m table
// lip geometry scales with the jump: lipH = lip height, lipS = straight run at
// the lip, Rt = TRANNY RADIUS sized so transition g-load (v²/R) stays ≈ 2 g —
// the one-size 6 m tranny was pulling 6.5 g at big-air speed — faceW = width.
// (Airtime maths is lip-relative, so lip height changes nothing in flight.)
const JUMPS={
  small: {kickerDeg:22,landingDeg:27,speed:11,  knuckleZ:9.2, knuckleDrop:0.6,
          lipH:2.2,lipS:1.5,Rt:6,  faceW:6},
  medium:{kickerDeg:24,landingDeg:30,speed:13.5,knuckleZ:15.7,knuckleDrop:1.45,
          lipH:2.8,lipS:2.0,Rt:9,  faceW:7},
  large: {kickerDeg:26,landingDeg:32,speed:15.5,knuckleZ:22.9,knuckleDrop:2.9,
          lipH:3.4,lipS:2.5,Rt:12, faceW:7},
  xl:    {kickerDeg:28,landingDeg:34,speed:17.5,knuckleZ:31.1,knuckleDrop:4.45,
          lipH:4.2,lipS:3.0,Rt:16, faceW:8},
  // BIG AIR: 70 km/h at a 32° lip, ~55 m carry, touchdown ~20 m down a long
  // 38° face — contest-tower proportions. Verified T = 3.30 s.
  bigair:{kickerDeg:32,landingDeg:38,speed:19.5,knuckleZ:35,  knuckleDrop:4.0,
          lipH:5.5,lipS:4.0,Rt:26, faceW:8}};
function defaultConfig(over){const c={forgiveness:0.5,stompDeg:12,sketchDeg:30,washDeg:60,rotTolRev:null};
  Object.assign(c,over||{});const s=0.5+1.5*Math.max(0,Math.min(1,c.forgiveness));
  c._stomp=c.stompDeg*s;c._sketch=c.sketchDeg*s;c._wash=c.washDeg*s;
  c._rotTol=(c.rotTolRev!=null)?c.rotTolRev:(0.08+0.22*c.forgiveness);return c;}
function takeoffState(j){const th=rad(j.kickerDeg);
  const uTake=[0,Math.sin(th),Math.cos(th)],nKick=[0,Math.cos(th),-Math.sin(th)];
  const zc=cross3(uTake,nKick);
  return{q:qFromR([[uTake[0],nKick[0],zc[0]],[uTake[1],nKick[1],zc[1]],[uTake[2],nKick[2],zc[2]]]),uTake,nKick};}
function airtimeOf(J){
  const th=rad(J.kickerDeg),tn=Math.tan(rad(J.landingDeg)),v=J.speed;
  const a=0.5*G,b=-v*(Math.sin(th)+tn*Math.cos(th)),cc=tn*J.knuckleZ-J.knuckleDrop;
  const disc=Math.max(0,b*b-4*a*cc);
  return(-b+Math.sqrt(disc))/(2*a);}
function mulberry32(seed){let a=seed>>>0;return function(){a|=0;a=(a+0x6D2B79F5)|0;
  let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
function seedFromDate(d){d=(d||'').replace(/-/g,'');let h=2166136261>>>0;
  for(let i=0;i<d.length;i++){h^=d.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
const GRABS=['indy','melon','mute','stalefish','tail','nose','method'];
const GRAB_POSE={indy:'Indy grab',melon:'Melon grab',mute:'Mute grab',
  stalefish:'Stalefish',tail:'Tail grab',nose:'Nose grab',method:'Method (heel tweak)'};
function dailyTrick(dateStr,difficulty){const diff=Math.max(0,Math.min(1,difficulty==null?0.4:difficulty));
  const r=mulberry32(seedFromDate(dateStr));const roll=r();
  let axis=roll<0.45?'spin':roll<0.85?'flip':'roll';
  if(axis==='roll'&&r()>0.3+0.5*diff)axis=(r()<0.5?'spin':'flip');
  const maxHalf=2+Math.floor(diff*6),half=2+Math.floor(r()*maxHalf),rev=half/2;
  const grab=GRABS[Math.floor(r()*GRABS.length)],stance=r()<0.5?'regular':'switch';
  return{axis,rev,grab,stance,difficulty:diff};}

// ═══════════════════ POSE TRACK (beats + tap-driven transitions) ═══════════════════
const TRANS=0.30;                       // seconds to morph into the next beat
let beats=[{pose:'Athletic stance'},{pose:'Indy grab'},{pose:'Athletic stance'}];
let beatsAuto=true;   // false once the player edits the sequence — then it's THEIRS
function beatTwist(b){const P=poseOf(b.pose);
  if(isTrick(b.pose))return P.twist||0;
  return b.tw!==undefined?b.tw:(P.twist||0);}
let track=null;   // {from: resolved pose, fromTw, toIdx, t0}
function trackReset(){track={from:resolvePose(Object.assign({twist:beatTwist(beats[0])},poseOf(beats[0].pose))),
  fromTw:beatTwist(beats[0]),toIdx:0,t0:-9};}
function poseNowAt(tf){
  const to=beats[track.toIdx];
  const f=smooth(Math.min(1,(tf-track.t0)/(track.trans||TRANS)));
  const D=blendPose(track.from,poseOf(to.pose),f);
  D.twist=L1(track.fromTw,track.toTw!==undefined?track.toTw:beatTwist(to),f);
  // the landing check rides ON TOP of the beats as a pure function of time —
  // internalH reads it, so the counter-rotation happens THROUGH the physics
  if(typeof run!=='undefined'&&run&&run.check&&tf>=run.check.t0){
    const fc=smooth(Math.min(1,(tf-run.check.t0)/Math.max(0.05,run.T-run.check.t0)));
    D.twist=Math.max(-88,Math.min(88,D.twist+run.check.amp*fc));
  }
  return D;
}
function tapBeat(tf){
  if(track.toIdx>=beats.length-1)return;
  const cur=resolvePose(poseNowAt(tf));
  track={from:cur,fromTw:cur.twist,toIdx:track.toIdx+1,t0:tf,trans:TRANS};
}
// internal momentum of the morphing body — the flip sim's law, verbatim in shape
function internalH(tf,T){
  const e=0.004,dt=Math.max(1e-4,e*T);
  const back=(tf+dt>T);
  const A=partsFromPose(poseNowAt(back?tf-dt:tf));
  const B=partsFromPose(poseNowAt(back?tf:Math.min(T,tf+dt)));
  const ca=bodyInertia(A).com,cb=bodyInertia(B).com;
  let h=[0,0,0];
  for(let i=0;i<A.length&&i<B.length;i++){
    const a=A[i],b=B[i];if(!a.m)continue;
    const r=[a.pos[0]-ca[0],a.pos[1]-ca[1],a.pos[2]-ca[2]];
    const r2=[b.pos[0]-cb[0],b.pos[1]-cb[1],b.pos[2]-cb[2]];
    const rd=[(r2[0]-r[0])/dt,(r2[1]-r[1])/dt,(r2[2]-r[2])/dt];
    const cr=cross3(r,rd);
    h=[h[0]+a.m*cr[0],h[1]+a.m*cr[1],h[2]+a.m*cr[2]];
    const Ra=a.R,Rb=b.R;
    if(Ra&&Rb){
      const M=[[0,0,0],[0,0,0],[0,0,0]];
      for(let x=0;x<3;x++)for(let y=0;y<3;y++){let s=0;for(let k=0;k<3;k++)s+=Rb[x][k]*Ra[y][k];M[x][y]=s;}
      const wr=[(M[2][1]-M[1][2])/(2*dt),(M[0][2]-M[2][0])/(2*dt),(M[1][0]-M[0][1])/(2*dt)];
      const d0=localInertia(a);
      for(let x=0;x<3;x++){let s=0;
        for(let y=0;y<3;y++){let v=0;for(let k=0;k<3;k++)v+=Ra[x][k]*d0[k]*Ra[y][k];s+=v*wr[y];}
        h[x]+=s;}
    }
  }
  return h;
}

