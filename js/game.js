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

// ═══════════════════ SCENE ═══════════════════
const $=id=>document.getElementById(id);
const today=new Date().toISOString().slice(0,10);
$('dateLbl').textContent=today;
const canvas=$('c');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(2,devicePixelRatio));
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x0c1018);
scene.fog=new THREE.Fog(0x0c1018,70,170);
const camera=new THREE.PerspectiveCamera(45,1,0.1,400);
scene.add(new THREE.AmbientLight(0x99aacc,0.75));
scene.add(new THREE.HemisphereLight(0xbfd4ee,0x33404f,0.5));
const sun=new THREE.DirectionalLight(0xffffff,0.85);sun.position.set(10,18,-6);scene.add(sun);
const LIP=new THREE.Vector3(0,3,0);

let terrain=null,COURSE=null;
function slopeBox(zA,yA,zB,yB,width,thick,mat){
  const dz=zB-zA,dy=yB-yA,len=Math.hypot(dz,dy),ang=Math.atan2(dy,dz);
  const m=new THREE.Mesh(new THREE.BoxGeometry(width,thick,len),mat);
  m.rotation.x=-ang;
  m.position.set(0,(yA+yB)/2-(dz/len)*(thick/2),(zA+zB)/2+(dy/len)*(thick/2));
  terrain.add(m);return m;
}
// ── in-run profile: straight approach → CIRCULAR TRANSITION ("tranny") → straight lip.
// Built by walking BACKWARD from the lip so the geometry always closes exactly on it,
// then reversed into forward samples {s,z,y,ang}. Both the drawn snow and the ridden
// path come from this one polyline, so the rider's board and the terrain agree C1.
// ── ANALYTIC in-run profile: straight → true circular tranny → straight lip.
// Closed form, not a polyline: position, tangent angle and surface height are
// exact smooth functions of s. (The old sampled polyline had a vertex every
// ~0.3 m — each one a slope kink that the contact solver turned into a visible
// acceleration spike as the board crossed it.)
function compileProfile(J){
  const aA=-rad(15), aK=rad(J.kickerDeg), Rt=J.Rt||6.0, lipS=J.lipS||2.0, La=26;
  const Pe={z:LIP.z-lipS*Math.cos(aK), y:LIP.y-lipS*Math.sin(aK)};   // arc end (lip side)
  const Cz=Pe.z-Rt*Math.sin(aK), Cy=Pe.y+Rt*Math.cos(aK);           // arc centre (above snow)
  const As={z:Cz+Rt*Math.sin(aA), y:Cy-Rt*Math.cos(aA)};            // arc start (approach side)
  const arcLen=Rt*(aK-aA);
  return{aA,aK,Rt,Cz,Cy,zAs:As.z,zPe:Pe.z,
    z0:As.z-La*Math.cos(aA), y0:As.y-La*Math.sin(aA),
    s1:La, s2:La+arcLen, LR:La+arcLen+lipS};
}
function compileInrun(J){          // sampled FROM the closed form — used only to draw slabs
  const P=compileProfile(J),S=[];
  for(let s=0;s<=P.LR+1e-6;s+=0.18){
    const p=profAt(P,Math.min(s,P.LR));
    S.push({s:Math.min(s,P.LR),z:p.z,y:p.y,ang:p.ang});
  }
  return S;
}
function profAt(P,s){
  if(s<=P.s1)return{z:P.z0+Math.cos(P.aA)*s,y:P.y0+Math.sin(P.aA)*s,ang:P.aA};
  if(s<=P.s2){const ang=P.aA+(s-P.s1)/P.Rt;
    return{z:P.Cz+P.Rt*Math.sin(ang),y:P.Cy-P.Rt*Math.cos(ang),ang};}
  const d=s-P.s2,ang=P.aK;
  return{z:P.zPe+Math.cos(ang)*d,y:P.Cy-P.Rt*Math.cos(P.aK)+Math.sin(ang)*d,ang};
}
function buildTerrain(J){
  if(terrain)scene.remove(terrain);
  terrain=new THREE.Group();scene.add(terrain);
  LIP.y=J.lipH||3;                     // lip height scales with the jump
  const wK=J.faceW||7;                 // takeoff face width
  const snow=new THREE.MeshLambertMaterial({color:0xdde7f2});
  const snowDim=new THREE.MeshLambertMaterial({color:0xb9c6d6});
  const th=rad(J.kickerDeg),ph=rad(J.landingDeg),tn=Math.tan(ph);
  const yK=LIP.y-J.knuckleDrop;
  const PROF=compileProfile(J),RUN=compileInrun(J),LR=PROF.LR;
  // ── COMPETITION DYE. Real venues paint the snow so riders can read it:
  // blue boundary lines down both sides of the course, cross-stripes on the
  // kicker face for depth, and distance lines across the landing.
  const DYE=new THREE.MeshLambertMaterial({color:0x3f7fd9});
  const DYE2=new THREE.MeshLambertMaterial({color:0x6fa8dc});
  // ALL dye is FLUSH: painted on the snow, tops ≤8 mm above the analytic
  // surface — under the board's 12 mm clearance. (Raised marker boxes were
  // the "over-extended landscape": ridges the contact solver knows nothing
  // about, burying the board on the face, the lip and across the landing.)
  const sideLn=(zA,yA,zB,yB,x,mat)=>{const m=slopeBox(zA,yA,zB,yB,0.26,0.02,mat);
    m.position.x=x;m.position.y+=0.008;return m;};
  // draw the in-run in short slabs so the tranny reads as a real curve
  {let i0=0;
   for(let i=1;i<RUN.length;i++){
     const curved=Math.abs(RUN[i].ang-RUN[i0].ang)>1e-4;
     if(RUN[i].s-RUN[i0].s>=(curved?0.2:0.9)||i===RUN.length-1){    // fine slabs through the tranny
       const A=RUN[i0],B=RUN[i];
       const onKicker=A.ang>rad(2);
       const w=onKicker?wK:11;
       const m=slopeBox(A.z,A.y,B.z,B.y,w,1.2,onKicker?snow:snowDim);
       if(curved)m.position.y-=0.004;   // chords sit ABOVE a concave arc: bias the drawn
                                        // snow just under the analytic surface the physics rides
       sideLn(A.z,A.y,B.z,B.y,+(w/2-0.35),DYE);                     // boundary dye, both edges
       sideLn(A.z,A.y,B.z,B.y,-(w/2-0.35),DYE);
       i0=i;
     }}}
  // cross-stripes up the kicker face (the depth cue riders actually use)
  for(const back of[1.1,2.2,3.4]){
    const p1=profAt(PROF,LR-back),p2=profAt(PROF,LR-back+0.3);
    const m=slopeBox(p1.z,p1.y,p2.z,p2.y,wK-0.6,0.02,DYE2);m.position.y+=0.008;
  }
  slopeBox(LIP.z+0.05,LIP.y,LIP.z+0.7,yK,wK,0.8,snowDim);
  slopeBox(LIP.z+0.7,yK,J.knuckleZ,yK,14,1.2,snow);
  const zEnd=J.knuckleZ+46,yEnd=yK-tn*46;
  slopeBox(J.knuckleZ,yK,zEnd,yEnd,16,1.4,snow);
  // deck + landing boundary dye
  sideLn(LIP.z+0.7,yK,J.knuckleZ,yK,+6.6,DYE);
  sideLn(LIP.z+0.7,yK,J.knuckleZ,yK,-6.6,DYE);
  sideLn(J.knuckleZ,yK,zEnd,yEnd,+7.6,DYE);
  sideLn(J.knuckleZ,yK,zEnd,yEnd,-7.6,DYE);
  const mk=(zA,yA,zB,yB,w,color)=>{const m=slopeBox(zA,yA,zB,yB,w,0.02,
    new THREE.MeshLambertMaterial({color}));m.position.y+=0.008;return m;};
  mk(LIP.z-0.3,LIP.y-Math.tan(th)*0.3,LIP.z,LIP.y,wK+0.2,0x4b9dff);  // flush ON the face — no ramp
  mk(J.knuckleZ-0.3,yK,J.knuckleZ+0.3,yK-tn*0.6,14.5,0xe08a4b);
  const T=airtimeOf(J),v=J.speed;
  const zT=v*Math.cos(th)*T;
  const yOn=z=>yK-tn*(z-J.knuckleZ);
  // distance lines across the landing every 5 m from the knuckle (comp style)
  for(let dz=5;dz<42;dz+=5){
    const z=J.knuckleZ+dz;
    const m=slopeBox(z-0.14,yOn(z-0.14),z+0.14,yOn(z+0.14),11,0.02,DYE2);m.position.y+=0.008;
  }
  $('tAir').textContent=T.toFixed(2)+'s';
  COURSE={J,th,ph,tn,yK,PROF,RUN,LR,zEnd,
    tL:[0,-Math.sin(ph),Math.cos(ph)],nL:[0,Math.cos(ph),Math.sin(ph)],
    zT,yT:yOn(zT),T};
}
function runAt(s){
  s=Math.max(0,Math.min(COURSE.LR,s));
  const p=profAt(COURSE.PROF,s),ang=p.ang;
  const d=[0,Math.sin(ang),Math.cos(ang)],n=[0,Math.cos(ang),-Math.sin(ang)];
  return{z:p.z,y:p.y,d,n,q:qFromR([[d[0],n[0],cross3(d,n)[0]],[d[1],n[1],cross3(d,n)[1]],[d[2],n[2],cross3(d,n)[2]]])};
}

// ── rider: mesh set built from parts (same scheme as the flip sim) ──
const rider=new THREE.Group();scene.add(rider);
const bodyMat=new THREE.MeshStandardMaterial({color:0xcdd6e6,metalness:0.15,roughness:0.55});
let segMeshes=[];
function buildRiderMeshes(parts){
  segMeshes.forEach(m=>{rider.remove(m);m.geometry.dispose();});segMeshes=[];
  parts.forEach(p=>{
    const g=p.shape==='box'?new THREE.BoxGeometry(p.dims[0],p.dims[1],p.dims[2])
      :p.shape==='sphere'?new THREE.SphereGeometry(p.dims[0],16,12)
      :new THREE.CylinderGeometry(p.dims[0],p.dims[0],p.dims[1],12);
    let mat=bodyMat;
    if(p.color!==undefined)mat=new THREE.MeshStandardMaterial({color:p.color,metalness:p.metal||0.4,roughness:0.4});
    const m=new THREE.Mesh(g,mat.clone());
    if(p.shape==='sphere'&&(p.frac||0)>0)m.scale.set(0.92,1.12,0.98);
    segMeshes.push(m);rider.add(m);
  });
}
// ── BOARD FLEX: one free-free bending mode (leaf spring, ~11 Hz).
//   w(u) = q·(4u² − 1/3)   → tips up / centre down for q>0, zero mean.
// Driven by surface curvature (conforms through the tranny), landing impact
// (tips whip), takeoff pop (release snap), and skid chatter. Rendering-only:
// the physics board stays rigid (3 kg of 88 — negligible inertia effect).
const FLEX={q:0,v:0};
const BOUNCE={b:0,bv:0};                       // vertical suspension hop, one-sided
function stepFlex(dt,target,kick){
  const w0=45,z=0.4;                            // ~7 Hz: fast, but readable
  if(kick)FLEX.v+=kick;
  FLEX.v+=(-w0*w0*(FLEX.q-(target||0))-2*z*w0*FLEX.v)*dt;
  FLEX.q=Math.max(-0.025,Math.min(0.07,FLEX.q+FLEX.v*dt));
}
// decamber under LOAD — the actual leaf-spring behaviour. ~1.8 cm per g of
// normal load: riding flat ≈ 1 g, a carve = 1/cosλ g, landing compression
// spikes several g. (Terrain curvature alone left the board dead straight on
// flat slopes — exactly where the bend was missed.)
const FLEX_PER_G=0.018;
function resetFlex(){FLEX.q=0;FLEX.v=0;BOUNCE.b=0;BOUNCE.bv=0;}
const _fq=new THREE.Quaternion(),_fz=new THREE.Vector3(0,0,1);
function syncRider(parts,com){
  if(parts.length!==segMeshes.length)buildRiderMeshes(parts);
  for(let i=0;i<parts.length;i++){const p=parts[i],m=segMeshes[i];
    let px=p.pos[0]-com[0],py=p.pos[1]-com[1],pz=p.pos[2]-com[2];
    if(p.flexAlong!==undefined&&p.R){
      // bend referenced to its LOWEST point: the contact stays ON the snow and
      // the tips rise — a loaded board never renders buried in the surface
      const u=p.flexAlong;
      const wmin=FLEX.q>0?-FLEX.q/3:FLEX.q*2/3;
      const w=FLEX.q*(4*u*u-1/3)-wmin;
      px+=p.R[0][1]*w;py+=p.R[1][1]*w;pz+=p.R[2][1]*w;   // deflect along board normal
      m.position.set(px,py,pz);
      m.quaternion.copy(p.ori)
        .multiply(_fq.setFromAxisAngle(_fz,0))           // (scratch reset)
        .multiply(_fq.setFromAxisAngle(_fz,Math.atan2(8*u*FLEX.q,BOARD.len)));
      continue;
    }
    m.position.set(px,py,pz);
    if(p.ori)m.quaternion.copy(p.ori);else m.quaternion.set(0,0,0,1);}
}
function applyQ(q){rider.quaternion.set(q[1],q[2],q[3],q[0]);}
// height of the COM above the deck's underside, along the board normal, for the CURRENT pose parts
function comOverDeck(parts,bi){
  const bf=parts.bf;
  return dot3(sub3(bi.com,bf.c),bf.bn)+0.0175+0.01;
}

// ── beats UI ──
function drawBeats(activeIdx){
  const el=$('beats');el.innerHTML='';
  beats.forEach((b,i)=>{
    const row=document.createElement('div');row.className='beat'+(i===activeIdx?' on':'');
    const idx=document.createElement('span');idx.className='idx';idx.textContent=(i+1);row.appendChild(idx);
    const sel=document.createElement('select');
    sel.innerHTML=Object.keys(POSE_STD).map(n=>`<option${n===b.pose?' selected':''}>${n}</option>`).join('');
    sel.onchange=e=>{if(state==='plan'){b.pose=e.target.value;beatsAuto=false;drawBeats();}else drawBeats(activeIdx);};
    row.appendChild(sel);
    const tw=document.createElement('input');tw.type='number';tw.step='5';tw.title='twist °';
    const locked=isTrick(b.pose);
    tw.value=locked?(poseOf(b.pose).twist||0):(b.tw!==undefined?b.tw:(poseOf(b.pose).twist||0));
    tw.disabled=locked;
    tw.oninput=e=>{const v=parseFloat(e.target.value);if(!isNaN(v)){b.tw=v;beatsAuto=false;}};
    row.appendChild(tw);
    if(beats.length>1&&i>0){
      const x=document.createElement('span');x.className='x';x.textContent='✕';
      x.onclick=()=>{if(state==='plan'){beats.splice(i,1);beatsAuto=false;drawBeats();}};
      row.appendChild(x);
    }
    el.appendChild(row);
  });
}
$('addBeat').onclick=()=>{if(state==='plan'){beats.push({pose:'Athletic stance'});beatsAuto=false;drawBeats();}};

// ── daily trick ──
function refreshTrick(){
  const diff={small:0.2,medium:0.45,large:0.7,xl:0.9,bigair:1.0}[$('jump').value];
  const tk=dailyTrick(today,diff);
  window._trick=tk;
  const axisName={spin:'spin',flip:'flip',roll:'cork'}[tk.axis];
  $('trickTxt').textContent=(tk.rev*360)+'° '+axisName+' · '+tk.grab;
  $('trickSub').textContent='land '+tk.stance+'  ·  '+tk.rev.toFixed(1)+' rev '+axisName;
  if(typeof updSheetLbl==='function')updSheetLbl();
  // auto-fill the trick's grab into beat 2 ONLY while the player hasn't touched
  // the sequence — a customized sequence is never silently overwritten again
  if(state==='plan'&&beatsAuto&&beats.length>=2){beats[1].pose=GRAB_POSE[tk.grab]||'Indy grab';drawBeats();}
}

// ═══════════════════ GAME PHASES ═══════════════════
let state='plan',run=null,inrun=null,outro=null,lastT=performance.now();
function curJump(){return JUMPS[$('jump').value];}

// ── SETUP CARVE. Before the lip you carve an arc on one edge. A carving board
// yaws at ω = v/R about the surface normal — REAL angular momentum, already in
// the body at release. Heel edge = frontside (+spin), toe = backside (−spin).
// The carve also banks the rider: you leave the lip inclined into the turn by
// the carve's lean angle λ = atan(v²/gR), which is how corked spins are born —
// the same yaw momentum read in a tilted body frame.
function carveSetup(J){
  // CENTRE-START SETUP. The rider starts on the CENTRELINE and the S carries
  // them to the lip at the TAKEOFF OFFSET, whose SIGN names the side in rider
  // terms:  + = toe side · − = heel side · 0 = flat base, no carve.
  // The sign also fixes the carve: a release on the TOE side can only come
  // from a heel-edge (frontside) final arc, and vice versa — so the edge and
  // spin direction are DERIVED from the offset; no contradiction possible.
  //   x(u) = x_lip·(1 − sin²(πu/2)),  u = d/Ls   (slope 0 at both ends, C∞)
  // Lip curvature κ = π²·|off|/(2Ls²) is what the physics reads: spin ω = vκ,
  // bank λ = atan(v²κ/g), implied radius R = 1/κ.
  // FIXED setup geometry per jump size (S 14 · M 18 · L 20 · XL 22 m), with a
  // fixed 2.5 m release offset. The edge dropdown picks the direction; the S
  // runs from −2.5, through the centre, to +2.5 — κ = π²·|off|/Ls².
  const SETUP_LEN={small:14,medium:18,large:20,xl:22,bigair:24};
  const Ls=Math.min(SETUP_LEN[$('jump').value]||18,(COURSE?COURSE.LR*0.9:30));
  const e=+$('edge').value||0;
  const offMag=Math.min(2.5,(J.faceW||7)/2-0.6);   // release stays on the (size-scaled) face
  const offIn=e*offMag;                     // toe-side release for frontside, heel for backside
  const xb=-offIn;                          // rider's toe side = world −x on the in-run
  const xa=+offIn;                          // start lane mirrored across the centreline
  const D=2*Math.abs(offIn);
  const kLip=Math.PI*Math.PI*D/(2*Ls*Ls);
  const wY=e*J.speed*kLip;
  const ln=e?Math.min(0.7,Math.atan(J.speed*J.speed*kLip/G)):0;
  return{e,Ls,xa,xb,D,offIn,wYaw:wY,lean:ln,R:kLip>1e-9?1/kLip:0,capped:false};
}
function makeRun(){
  const J=curJump(),cfg=defaultConfig({forgiveness:+$('forg').value});
  const T=airtimeOf(J),tk=takeoffState(J);
  trackReset();
  const cv=carveSetup(J);
  // takeoff attitude = kicker attitude + the WHOLE-BODY share of the carve bank
  // (the lower-body edging lives in the pose, not the frame — see CARVE_LOWER)
  const hl=-cv.e*cv.lean*(1-CARVE_LOWER)/2;
  const q0=cv.e?qMul(tk.q,[Math.cos(hl),Math.sin(hl),0,0]):tk.q.slice();
  // BUDGET PRICING — against the PLANNED SEQUENCE's average inertia, not the
  // standing pose. Priced at the (maximum-I) athletic stance, "1 flip" became
  // 2.5 the moment you tucked into a grab, because grabs collapse I_flip ~2.7×.
  // Averaging over the beats means the typed revs are what the PLAN delivers
  // when the taps are even; tucking early still over-rotates, opening early
  // still bails out — the mechanic survives, centred on the number you typed.
  const Iavg=[[0,0,0],[0,0,0],[0,0,0]];
  beats.forEach(b=>{
    const P=Object.assign({},poseOf(b.pose),{twist:beatTwist(b)});
    const I=bodyInertia(partsFromPose(P)).I;
    for(let r=0;r<3;r++)for(let c2=0;c2<3;c2++)Iavg[r][c2]+=I[r][c2]/beats.length;
  });
  const w0=[(+$('pRoll').value||0)*TAU/T,
            (+$('pSpin').value||0)*TAU/T + cv.wYaw,        // carve yaw + typed extra throw
            (+$('pFlip').value||0)*TAU/T];
  const Lb0=mv3(Iavg,w0);
  const ph=rad(J.landingDeg);
  // size the prewind from the TYPED spin's momentum (the carve part is
  // ground-generated by the carve itself and needs no coil)
  const wind=sizeWind(Iavg[1][1]*((+$('pSpin').value||0)*TAU/T));
  const L=qRot(q0,Lb0);
  return{J,cfg,T,q:q0,L,Lmag:Math.hypot(L[0],L[1],L[2]),carve:cv,x0:cv.e?cv.xb:0,wind,
    uTake:tk.uTake,nKick:tk.nKick,nLand:[0,Math.cos(ph),Math.sin(ph)],
    t:0,lastW:[0,0,0],done:false};
}
// ── REALIZED ROTATION, judge-style. The old counter integrated body-frame ω
// components, which is only exact for a pure single-axis rotation — with grabs
// morphing I, twists carrying h, or any mixed-axis flight it drifts from what
// anyone watching would count. So count GEOMETRICALLY instead: unwrap the
// board's actual world-frame angles frame to frame.
//   spin  = heading of the nose in the horizontal plane
//   flip  = pitch of the board normal in the flip plane (y–z)
//   roll  = bank of the board normal about the travel axis (x–y)
function initRevs(run,parts){
  const bx=qRot(run.q,parts.bf.bx),bn=qRot(run.q,parts.bf.bn);
  run.rev={spin:0,flip:0,roll:0,
    aS:Math.atan2(bx[0],bx[2]),aF:Math.atan2(bn[2],bn[1]),aR:Math.atan2(bn[0],bn[1])};
}
function updateRevs(run,parts){
  if(!run.rev)return;
  const wrap=d=>{while(d>Math.PI)d-=TAU;while(d<-Math.PI)d+=TAU;return d;};
  const bx=qRot(run.q,parts.bf.bx),bn=qRot(run.q,parts.bf.bn);
  if(Math.hypot(bx[0],bx[2])>0.15){                       // nose near-vertical: heading undefined, hold
    const a=Math.atan2(bx[0],bx[2]);run.rev.spin+=wrap(a-run.rev.aS)/TAU;run.rev.aS=a;}
  if(Math.hypot(bn[1],bn[2])>0.15){
    const a=Math.atan2(bn[2],bn[1]);run.rev.flip-=wrap(a-run.rev.aF)/TAU;run.rev.aF=a;}
  if(Math.hypot(bn[0],bn[1])>0.15){
    const a=Math.atan2(bn[0],bn[1]);run.rev.roll-=wrap(a-run.rev.aR)/TAU;run.rev.aR=a;}
}
// SUBSTEPPED at 120 Hz with I(t) and h(t) REBUILT every substep. Holding them
// across a whole render frame (33 ms) put an O(dt) speed error into every pose
// transition — a 140 ms unwind whip changed I substantially inside one frame.
// L itself needs no such care: it is a constant input, conserved by construction.
function stepFlight(run,dtF){
  if(run.done)return;
  let remaining=Math.min(dtF,run.T-run.t);
  if(remaining<=1e-9){run.done=true;return;}
  const SUB=1/120;
  while(remaining>1e-9&&!run.done){
    const dt=Math.min(SUB,remaining);remaining-=dt;
    const parts=partsFromPose(poseNowAt(run.t));
    const bi=bodyInertia(parts);
    const Iinv=inv3(bi.I);
    const h=internalH(run.t,run.T);
    const f=Qq=>{const Lb=qRotInv(Qq,run.L);
      const wm=mv3(Iinv,[Lb[0]-h[0],Lb[1]-h[1],Lb[2]-h[2]]);
      return qMul(Qq,[0,wm[0]*0.5,wm[1]*0.5,wm[2]*0.5]);};
    const k1=f(run.q),k2=f(add4(run.q,k1,dt/2)),k3=f(add4(run.q,k2,dt/2)),k4=f(add4(run.q,k3,dt));
    run.q=qNorm([0,1,2,3].map(i=>run.q[i]+dt/6*(k1[i]+2*k2[i]+2*k3[i]+k4[i])));
    const Lb=qRotInv(run.q,run.L);
    run.lastW=mv3(Iinv,[Lb[0]-h[0],Lb[1]-h[1],Lb[2]-h[2]]);
    run.lastH=h;
    run.t+=dt;
    run.parts=parts;run.bi=bi;
    updateRevs(run,parts);                                // unwrap per substep: whip-proof
    // ── THE LANDING CHECK: in the final 0.35 s the rider spots the landing
    // and throws a corrective TWIST sized so its internal momentum h squares
    // the board with the likely riding direction (nearest end) at touchdown.
    //   ΔA_board = −(I_tw/I_yy)·Δθ_twist  ⇒  Δθ = E_predicted·I_yy/I_tw
    // Solved ONCE (deterministic, h-consistent), capped by the spine's range —
    // beyond ~±40° of error a check simply cannot save you, which is honest.
    if(!run.check&&run.t>=run.T-0.35&&COURSE){
      const bf=parts.bf,bxw=qRot(run.q,bf.bx);
      const bp=nrm(add3(bxw,run.nLand,-dot3(bxw,run.nLand)));
      const tl=COURSE.tL;
      const s2=-dot3(cross3(bp,tl),run.nLand),cA=dot3(bp,tl);   // true bearing (un-negated)
      const thN=0.5*Math.atan2(2*s2*cA,cA*cA-s2*s2);            // nearest-end error now
      const yawN=dot3(qRot(run.q,run.lastW),run.nLand);
      const Ep=thN+yawN*(run.T-run.t);                          // predicted at touchdown
      // NEVER twist back to an alignment already passed: with live residual
      // spin the check targets the NEXT end AHEAD along the rotation — the
      // spin is ridden out, not fought backwards through a crossed end.
      let Ew=0.5*Math.atan2(Math.sin(2*Ep),Math.cos(2*Ep));     // nearest (used when spin ≈ 0)
      if(Math.abs(yawN)>0.8){
        const e=((Ep*180/Math.PI)%180+180)%180;                 // [0,180)
        Ew=(yawN>0?e-180:e)*Math.PI/180;                        // correction CONTINUES the spin
      }
      const twNow=poseNowAt(run.t).twist||0;
      let amp=Ew*(bi.I[1][1]/twistInertia())*180/Math.PI;
      amp=Math.max(-85-twNow,Math.min(85-twNow,amp));
      run.check={t0:run.t,amp};
      $('phaseSub').textContent='squaring up for the landing…';
    }
    if(run.t>=run.T-1e-9)run.done=true;
  }
}
function resolveRun(run){
  const cfg=run.cfg;
  const up=qRot(run.q,[0,1,0]);
  const cosang=Math.max(-1,Math.min(1,dot3(nrm(up),nrm(run.nLand))));
  const attitudeDeg=Math.acos(cosang)*180/Math.PI;let band;
  if(attitudeDeg<cfg._stomp)band='stomp';else if(attitudeDeg<cfg._sketch)band='sketchy';
  else if(attitudeDeg<cfg._wash)band='wash-out';else band='crash';
  const rv=run.rev||{spin:0,flip:0,roll:0};
  return{band,landed:band!=='crash',attitudeDeg,
    realizedRev:{roll:rv.roll,spin:rv.spin,flip:rv.flip},airtime:run.T};
}
function trickCompleted(res,tk,cfg){
  const got=res.realizedRev[tk.axis]||0;
  return res.landed&&Math.abs(Math.abs(got)-tk.rev)<=cfg._rotTol;
}
// ballistic COM arc + the surface-normal offset easing kicker→landing
function flightPos(t){
  const J=run.J,u=run.uTake,s=J.speed;
  let f=Math.min(1,t/run.T);f=f*f*(3-2*f);
  const nk=run.nKick,nl=COURSE.nL;
  const off=nrm([nk[0]+(nl[0]-nk[0])*f,nk[1]+(nl[1]-nk[1])*f,nk[2]+(nl[2]-nk[2])*f]);
  const d=run.comH||1.0;
  return new THREE.Vector3(run.x0+off[0]*d,LIP.y+u[1]*s*t-0.5*G*t*t+off[1]*d,LIP.z+u[2]*s*t+off[2]*d);
}
// ── BOARD-CONTACT ANCHORING. On snow the thing touching the ground is the DECK
// (or its downhill EDGE when banked) — not the body's centre. Anchoring by COM
// height meant a banked carve or a blended pose could sink the board into the
// snow or float it. So: take the deck's underside (corners + edge midpoints) in
// body coords, rotate them by the rider's CURRENT attitude (bank included), and
// lift the body exactly until the LOWEST deck point touches the surface. The
// contact point is whatever part of the board is really lowest — centre when
// flat, an edge when banked, nose/tail when pitched.
function boardAnchor(parts,bi,q,n){
  const bf=parts.bf,com=bi.com;
  const hx=BOARD.len*0.48,hz=BOARD.waist*0.5,dn=0.0175+0.004;
  let m=Infinity;
  for(const sx of[-1,0,1])for(const sz of[-1,0,1]){
    const p=addv(addv(addv(bf.c,bf.bx,sx*hx),bf.bz,sz*hz),bf.bn,-dn);
    const w=qRot(q,sub3(p,com));
    m=Math.min(m,dot3(w,n));
  }
  return -m;                       // lift that puts the lowest deck point ON the snow
}
// snow height under any z — in-run polyline, then deck, then landing plane
function ySurfAt(z){
  const C=COURSE,P=C.PROF;
  if(z<=P.zAs)return P.y0+(z-P.z0)*Math.tan(P.aA);                 // approach line
  if(z<=P.zPe)return P.Cy-Math.sqrt(Math.max(0,P.Rt*P.Rt-(z-P.Cz)*(z-P.Cz)));  // TRUE circle
  if(z<=LIP.z)return LIP.y-(LIP.z-z)*Math.tan(P.aK);               // lip straight
  if(z<=LIP.z+0.7)return LIP.y+(C.yK-LIP.y)*((z-LIP.z)/0.7);       // drop face
  if(z<=C.J.knuckleZ)return C.yK;                                  // deck
  return C.yK-C.tn*(z-C.J.knuckleZ);                               // landing slope
}
// ── TRUE SURFACE CONTACT. A tangent-plane anchor digs the nose and tail into a
// CURVED surface (a rigid board BRIDGES a concave tranny — it rests on its tips
// there, not its centre). So instead: place the rider, test every deck underside
// point against the real height profile, and lift VERTICALLY until nothing
// penetrates. The contact point emerges by itself — centre on flats, downhill
// edge when banked, nose+tail through the tranny.
// finite-stiffness contact: the board flexes and snow compresses, so the body's
// height and attitude RELAX toward the contact solution (τ ≈ 45/60 ms) instead
// of stepping. This bounds every part's acceleration — kills the spikes that a
// hard max()-contact produces whenever the active contact point switches.
let frameDt=1/60;
const CONTACT={lift:null,q:null};
function resetContact(){CONTACT.lift=null;CONTACT.q=null;}
function poseOnSnow(desc,q,pt,n){
  const parts=partsFromPose(desc);
  const bi=bodyInertia(parts);
  syncRider(parts,bi.com);
  // ATTITUDE FIRST. The in-run tracks the analytic profile EXACTLY — the old
  // attitude filter lagged the fast pitch change through the tranny by ~6°,
  // pitching the rendered tail 8 cm below where the lift was solved: the
  // buried tail. The outro keeps its soft blend (its q comes from dynamics).
  let qUse=q;
  if(state==='outro'){
    const kQ=1-Math.exp(-frameDt/0.06);
    CONTACT.q=(CONTACT.q==null)?q.slice():qSlerp(CONTACT.q,q,kQ);
    qUse=CONTACT.q;
  }else CONTACT.q=null;
  // LIFT SECOND, computed with the attitude ACTUALLY RENDERED — lift and
  // render can never disagree about where the deck points are.
  const bf=parts.bf,com=bi.com;
  const hx=BOARD.len*0.48,hz=BOARD.waist*0.5,dn=0.0175+0.004;
  let lift=-Infinity;
  for(const sx of[-1,-0.5,0,0.5,1])for(const sz of[-1,0,1]){
    const p=addv(addv(addv(bf.c,bf.bx,sx*hx),bf.bz,sz*hz),bf.bn,-dn);
    const w=qRot(qUse,sub3(p,com));
    lift=Math.max(lift,ySurfAt(pt.z+w[2])-(pt.y+w[1]));
  }
  let liftUse=lift;
  if(state==='inrun'||state==='outro'){
    // asymmetric compliance: RISING lift applies instantly (snow is rigid —
    // penetration is not smoothable), only unloading is eased
    const soft=(state==='outro'&&outro&&outro.t<(outro.tAbs||0.25))?0.09:0.045;
    const kL=1-Math.exp(-frameDt/soft);
    CONTACT.lift=(CONTACT.lift==null||lift>CONTACT.lift)?lift
                :CONTACT.lift+(lift-CONTACT.lift)*kL;
    liftUse=CONTACT.lift;
  }else resetContact();
  applyQ(qUse);
  rider.position.set(pt.x||0,pt.y+liftUse+0.012,pt.z);
  return{parts,bi};
}
// the last stretch of in-run rides the setup carve: a lateral arc of radius R
// that closes on the lip, with the rider banked into the turn. The bank at the
// lip equals the takeoff attitude's bank, so release is seamless.
const CARVE_LEN=11;
// Lateral path, measured back from the lip (d = distance to lip):
//   d ∈ [0,L2]    — IN-arc  (chosen edge):    x = e·d²/2R          slope e·d/R
//   d ∈ [L2,2L2]  — OUT-arc (opposite edge):  mirrored curvature, tangent-matched
//   d ≥ 2L2       — straight lane at the S's start offset (slope already 0: no kink)
// The lean swings edge to edge through the inflection (cosine ramp): full bank
// into the turn at the lip, zero at the inflection, opposite bank on the out-arc.
function carveAt(s,cv){
  if(!cv||!cv.e)return{x:0,roll:0,yaw:0};
  const d=Math.max(0,COURSE.LR-s);
  if(d>=cv.Ls)return{x:cv.xa,roll:0,yaw:0};    // before the setup: ride the start-side lane
  const e=cv.e,u=d/cv.Ls;
  const g=Math.sin(Math.PI*u/2)*Math.sin(Math.PI*u/2);     // 0 at lip → 1 at lane
  const x=cv.xb+(cv.xa-cv.xb)*g;
  // board tracks its edge: heading = path tangent (yaw about the surface normal)
  const dxdd=(cv.xa-cv.xb)*(Math.PI/2)*Math.sin(Math.PI*u)/cv.Ls;
  // lean follows the path's curvature (cos πu): into the turn at the lip, the
  // OPPOSITE edge on the entry half, eased in over the first 15% of the setup
  const ramp=u>0.85?smooth((1-u)/0.15):1;
  return{x,roll:-e*cv.lean*Math.cos(Math.PI*u)*ramp,yaw:Math.atan(-dxdd)};
}
// compose surface attitude + carve heading (about body y = surface normal)
// + carve bank (about body x = board axis)
function carveQ(pq,cvv){
  let q=pq;
  if(cvv.yaw){const hy=cvv.yaw/2;q=qMul(q,[Math.cos(hy),0,Math.sin(hy),0]);}
  if(cvv.roll){const hr=cvv.roll/2;q=qMul(q,[Math.cos(hr),Math.sin(hr),0,0]);}
  return q;
}
// ── ANGULATION: the edge is set by the LOWER BODY. Of the total edge angle,
// only CARVE_LOWER goes into the pose — the board rolls under the rider
// (ankles/knees, absorbed by the binding IK) and the hips shift over the
// pressed edge — while the remaining fraction is whole-body inclination.
// Upper body stays quiet; no statue-lean.
const CARVE_LOWER=0.65;
// riding flex: nobody rides an in-run with straight legs — a standing athletic
// pose has the legs ~95% extended, which leaves the IK NO room to angulate.
function ridePose(base){
  const D=Object.assign({},base);D.hipY=base.hipY-0.06;return D;
}
// ── PREWIND / UNWIND. The typed spin throw is not free: it is the angular
// momentum of the torso UNWINDING through the lip,  L = I_tw·θ̇.  So the coil
// is SIZED from the demand: θ̇_peak = L/I_tw with a smoothstep unwind of angle
// Θ over Tu (peak rate 1.5Θ/Tu). Low spin ⇒ a small, easy coil. When Θ hits
// the full spinal range (85°), the range is the hard cap and the WHIP gets
// faster instead (Tu shrinks). Release happens at MID-unwind — peak rate —
// exactly like the flip simulator's wind mode: at the lip the board itself is
// barely turning (ω = I⁻¹(L−h) ≈ carve only) and the rotation pays out in the
// air as the unwind completes.
let ITW=null;
function twistInertia(){
  if(ITW)return ITW;
  const base=Object.assign({twist:0},poseOf('Athletic stance'));
  const dt=0.5,dg=10;
  const A=partsFromPose(base),B=partsFromPose(Object.assign({},base,{twist:dg}));
  const ca=bodyInertia(A).com,cb=bodyInertia(B).com;
  let h=0;
  for(let i=0;i<A.length&&i<B.length;i++){const a=A[i],b=B[i];if(!a.m)continue;
    const r=[a.pos[0]-ca[0],a.pos[1]-ca[1],a.pos[2]-ca[2]];
    const rd=[(b.pos[0]-cb[0]-r[0])/dt,(b.pos[1]-cb[1]-r[1])/dt,(b.pos[2]-cb[2]-r[2])/dt];
    h+=a.m*(r[2]*rd[0]-r[0]*rd[2]);                 // y-component of m·r×ṙ
  }
  ITW=Math.max(0.3,Math.abs(h)/(rad(dg)/dt));      // kg·m² of torso+arms about the spine
  return ITW;
}
// The unwind's TOTAL sweep allocates coil first, then FOLLOW-THROUGH: at low
// spin the torso just returns to neutral, but at high spin it throws PAST
// neutral into the spin direction — up to the opposite 85° — using the full
// range on BOTH sides (170° total) before the whip speeds up instead.
function sizeWind(LextY){
  const eW=LextY>1e-6?1:LextY<-1e-6?-1:0;
  if(!eW)return{e:0,coil:0,follow:0,Tu:0.45,full:false};
  const rate=Math.abs(LextY)/twistInertia();       // required peak rate, rad/s
  let Tu=0.45,tot=rate*Tu/1.5*180/Math.PI,full=false;
  if(tot>170){tot=170;Tu=1.5*rad(170)/rate;full=true;}  // both ranges spent: whip faster
  const coil=Math.min(85,tot),follow=Math.max(0,tot-85);
  return{e:eW,coil,follow,Tu,full};
}
// twist during the in-run: coil in over the setup, then the unwind timeline —
// the SAME smoothstep the flight seed uses, so the lip crossing is seamless.
// Sweeps from −e·coil through neutral toward +e·follow (the follow-through).
function windTwistAt(d,v,W,Ls){
  if(!W||!W.e||!(W.coil+W.follow))return 0;
  const t=-d/Math.max(3,v);                        // time until the lip (negative)
  const f=smooth((t+W.Tu/2)/W.Tu);                 // unwind progress (mid-sweep at the lip)
  const wf=smooth(Math.min(1,(Ls-d)/(0.6*Ls)));    // wind-up ramp through the setup
  return L1(-W.e*W.coil*wf,W.e*W.follow,f);
}
function carvePose(base,rollRad){
  const deg=rollRad*180/Math.PI;
  if(Math.abs(deg)<0.5)return base;
  const D=Object.assign({},base,{board:Object.assign({},base.board)});
  D.board.roll=(base.board.roll||0)+deg;            // board onto its edge
  const k=Math.min(1,Math.abs(deg)/18),side=Math.sign(deg);
  // THE CARVE IS A SQUAT: the hips SINK hard — that flexes the knees and is
  // what buys the legs the slack to angulate at all (board.roll alone doesn't
  // move the bindings, so without the sink the legs just lock straight)
  D.hipY=base.hipY-0.14*k;
  D.hipZ=(base.hipZ||0)+side*0.10*k;                // hips inside, over the working edge
  // torso stays near world-vertical: a touch more crunch on toeside, a touch
  // more upright sitting into a heelside — quiet upper body, working legs
  D.trunk=nrm([base.trunk[0],base.trunk[1],base.trunk[2]+side*0.10]);
  return D;
}
// ── PLANNED TRAJECTORY: the carve line down the in-run + the ballistic arc to
// touchdown, drawn from the SAME formulas the run will use. What you see is
// exactly what launching will do — and it makes the carve's direction legible.
let trajLine=null;
function drawTrajectory(){
  if(trajLine){scene.remove(trajLine);trajLine.geometry.dispose();trajLine=null;}
  if(!COURSE)return;
  const J=curJump(),cv=carveSetup(J),T=airtimeOf(J),v=J.speed,th=COURSE.th;
  const pts=[];
  for(let s=0;s<=COURSE.LR;s+=0.4){
    const p=runAt(s),c=carveAt(s,cv);
    pts.push(new THREE.Vector3(c.x,p.y+p.n[1]*0.10,p.z+p.n[2]*0.10));
  }
  const xLip=cv.e?cv.xb:0;
  for(let i=0;i<=40;i++){
    const t=T*i/40;
    pts.push(new THREE.Vector3(xLip,LIP.y+Math.sin(th)*v*t-0.5*G*t*t+0.06,LIP.z+Math.cos(th)*v*t));
  }
  trajLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({color:0x4b9dff,transparent:true,opacity:0.85}));
  scene.add(trajLine);
}
function standAtStart(){
  trackReset();
  const p=runAt(0);
  const cv=carveAt(0,carveSetup(curJump()));      // stand in the offset lane the plan starts from
  poseOnSnow(poseNowAt(0),carveQ(p.q,cv),{x:cv.x,y:p.y,z:p.z},p.n);
}
function rebuild(){buildTerrain(curJump());refreshTrick();standAtStart();updCarveInfo();}
$('jump').onchange=()=>{if(state==='plan')rebuild();};
// live readout: what the chosen carve is worth in the air (also redraws the planned line)
function updCarveInfo(){
  const J=curJump(),cv=carveSetup(J),T=airtimeOf(J);
  if(!cv.e){$('carveInfo').textContent='flat base — spin comes only from the typed throw';}
  else{
    const revs=cv.wYaw*T/TAU,sTime=cv.Ls/J.speed;
    $('carveInfo').textContent=(cv.e>0?'frontside (heel carve)':'backside (toe carve)')+' ≈ '
      +(revs>0?'+':'')+revs.toFixed(2)+' rev spin · bank '
      +(cv.lean*180/Math.PI).toFixed(0)+'° · S '+cv.Ls.toFixed(0)+' m crossing '
      +(-cv.offIn).toFixed(1)+' → '+(cv.offIn>0?'+':'')+cv.offIn.toFixed(1)+' m ('
      +(cv.offIn>0?'toe':'heel')+'-side release) · R≈'
      +(cv.R>99?'∞':cv.R.toFixed(0))+' m ≈ '+sTime.toFixed(1)+' s';
  }
  // prewind readout: how much coil the typed spin demands
  {const thr=+$('pSpin').value||0;
   if(Math.abs(thr)<0.01){$('windInfo').textContent='no coil needed — spin comes from the carve alone';}
   else{
     const parts=partsFromPose(Object.assign({twist:0},poseOf('Athletic stance')));
     const Iyy=bodyInertia(parts).I[1][1];
     const W=sizeWind(Iyy*thr*TAU/T);
     $('windInfo').textContent='prewind: coil '+W.coil.toFixed(0)+'°'
       +(W.follow>0.5?' → throw '+W.follow.toFixed(0)+'° PAST neutral':' → back to neutral')
       +', '+W.Tu.toFixed(2)+' s'+(W.full?' — both ranges maxed, fast whip':'');
   }}
  drawTrajectory();
}
$('pSpin').oninput=updCarveInfo;
$('edge').onchange=updCarveInfo;
// ── COPY SETUP: the whole plan as JSON on the clipboard ──
$('copyCfg').onclick=()=>{
  const cv=carveSetup(curJump());
  const cfg={game:'daily-kicker',date:today,trick:window._trick,
    jump:$('jump').value,edge:cv.e,takeoffOffset:cv.offIn,impliedRadius:+cv.R.toFixed(1),
    setupLen:+cv.Ls.toFixed(2),
    spin:+$('pSpin').value,flip:+$('pFlip').value,roll:+$('pRoll').value,
    forgiveness:+$('forg').value,
    beats:beats.map(b=>Object.assign({pose:b.pose},b.tw!==undefined?{tw:b.tw}:{})),
    camera:CAM,board:BOARD};
  const txt=JSON.stringify(cfg,null,2);
  const done=()=>{const b=$('copyCfg');b.textContent='Copied ✓';
    setTimeout(()=>{b.innerHTML='Copy setup';},1200);};
  const fallback=()=>{const ta=document.createElement('textarea');ta.value=txt;
    document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');}catch(e){}
    ta.remove();done();};
  if(navigator.clipboard&&navigator.clipboard.writeText)
    navigator.clipboard.writeText(txt).then(done,fallback);
  else fallback();
};

// ── IN-RUN PHYSICS. The rider is a point mass on the compiled profile:
//      dv/dt = −g·sinα − μ·g·cosα        (gravity along the slope, snow friction μ)
// accelerating down the approach, bleeding speed up the kicker climb. The DROP-IN
// speed is solved from the same energy equation so the rider crosses the lip at
// exactly the jump's design speed — push in hard for a big jump, roll in for a
// small one, and the speed you watch build is the speed the flight actually uses.
const MU_SNOW=0.03;
function dropInSpeed(J){
  const R=COURSE.RUN;
  let rub=0;
  for(let i=1;i<R.length;i++){
    const ds=R[i].s-R[i-1].s;
    rub+=Math.cos((R[i].ang+R[i-1].ang)/2)*ds;          // Σ cosα·ds — friction's path integral
  }
  const dy=LIP.y-R[0].y;                                // lip minus start (negative: net drop)
  const v2=J.speed*J.speed + 2*G*dy + 2*MU_SNOW*G*rub;  // energy balance, solved for the start
  return Math.sqrt(Math.max(1,v2));
}
function startDrop(){
  run=makeRun();
  inrun={s:0,v:dropInSpeed(curJump())};
  resetContact();resetFlex();
  state='inrun';
  $('result').style.display='none';
  $('phase').textContent='Dropping in';$('phaseSub').textContent='takeoff is automatic at the lip';
}
function beginFlight(){
  state='fly';
  stepFlex(0,0,-1.2);      // pop release: the loaded board snaps free off the lip
  // the rider leaves the lip still EDGED (lower-body carve pose); seed the pose
  // track so the board flattens through the first beat transition instead of
  // snapping to neutral in one frame — and h reads that flattening, as it should
  const cvv=run.carve,W=run.wind;
  if((cvv&&cvv.e)||(W&&W.e)){
    // seed the pose track from the RELEASE state: edged (if carving) and WOUND
    // (if throwing). t0 = −Tu/2 puts the lip crossing at MID-unwind — peak
    // twist rate — so h(0) ≈ I_tw·θ̇_peak ≈ the typed spin's momentum. The
    // board leaves the lip barely rotating and the spin pays out in the air.
    const rollShare=cvv&&cvv.e?-cvv.e*cvv.lean*CARVE_LOWER:0;
    const edged=resolvePose(carvePose(ridePose(poseNowAt(0)),rollShare));
    if(W&&W.e)edged.twist=(edged.twist||0)-W.e*W.coil;
    track={from:edged,fromTw:edged.twist||0,toIdx:0,
      t0:(W&&W.e)?-W.Tu/2:0,trans:(W&&W.e)?W.Tu:TRANS,
      // follow-through: at high spin the unwind lands PAST neutral, into the spin
      toTw:(W&&W.e&&W.follow)?beatTwist(beats[0])+W.e*W.follow:undefined};
  }
  // pin the arc's visual offset to the board-contact anchor at the (banked)
  // takeoff attitude, so leaving the lip is seamless with the ridden surface
  const parts=partsFromPose(poseNowAt(0)),bi0=bodyInertia(parts);
  run.comH=boardAnchor(parts,bi0,run.q,run.nKick);
  initRevs(run,parts);
  $('phase').textContent='In the air';$('phaseSub').textContent='tap Space on the beat';
  $('tAir').textContent=run.T.toFixed(2)+'s';
}
// ── LANDING = CONTACT DYNAMICS, same methodology as flight: q and ω carry over
// CONTINUOUSLY from the air, and the only new thing is a FINITE leg torque
// about the contact — a capped, damped righting (an inverted pendulum being
// caught). No slerp-to-upright, no teleports: a clean catch, a wobbly save and
// a crash are all the SAME integrator with different leg strength. The band
// (from attitude at impact) sets that strength, so score and animation agree —
// and a crash simply IS the catch failing: torque cap too weak, tilt passes
// the fall angle, the rider goes down and slides out under friction.
function beginOutro(){
  const res=resolveRun(run),C=COURSE;
  const vy=run.J.speed*run.uTake[1]-G*run.T,vz=run.J.speed*run.uTake[2];
  const vSlide=Math.max(2,vy*C.tL[1]+vz*C.tL[2]);
  const lastDesc=resolvePose(poseNowAt(run.T));
  const gains={   // kY = steering authority: pivoting the board into the travel line
    stomp:      {kP:60,kD:10, cap:26,downAt:80,kY:18},
    sketchy:    {kP:38,kD:7,  cap:17,downAt:80,kY:13},
    'wash-out': {kP:26,kD:5.5,cap:12,downAt:80,kY:8},
    crash:      {kP:8, kD:3,  cap:3, downAt:55,kY:3},
  }[res.band];
  // ACTIVE COMPRESSION sized by the impact: the normal-velocity component sets
  // how DEEP and how LONG the absorption stroke is (leg travel eats the hit).
  const vImp=Math.max(0,-(vy*C.nL[1]+vz*C.nL[2]));  // speed INTO the slope
  const depth=Math.min(1,vImp/9);
  const LC=poseOf('Landing crouch');
  const crouchDeep=Object.assign({},LC,{hipY:LC.hipY-0.18*depth});   // deep, springy stroke
  // the board takes the hit too: tips whip up, then the suspension hop
  stepFlex(0,0,0.55*vImp);
  BOUNCE.bv=Math.min(1.4,0.15*vImp);
  outro={t:0,res,gains,lastDesc,down:false,tDown:0,recT:0,caught:false,
    bf:(run.parts&&run.parts.bf)||null,            // seeded: a catch AT the touchdown instant counts
    v:vSlide,z:C.zT,x:run.x0,psi:0,lastPsiDot:0,   // ψ = riding heading off the fall line
    vImp,tAbs:0.18+0.28*depth,crouchDeep,
    q:run.q.slice(),w:run.lastW.slice()};          // continuous state from flight
  // hand the contact smoother the flight's final height so nothing snaps
  CONTACT.lift=rider.position.y-(C.yT+0.004);
  CONTACT.q=run.q.slice();
  state='outro';
  $('phase').textContent=res.band==='crash'?'Crashed':'Riding out';
  $('phaseSub').textContent='Space to skip';
}
function showResult(){
  state='result';
  const res=outro.res,tk=window._trick;
  // an edge catch that put the rider down IS a crash, whatever the touchdown
  // attitude said — the score reflects what actually happened on the snow
  if(outro.caught&&outro.down){res.band='crash';res.landed=false;res.edgeCatch=true;}
  const done=trickCompleted(res,tk,run.cfg);
  $('band').textContent=res.band.toUpperCase();
  $('band').className='big '+res.band;
  const got=Math.abs(res.realizedRev[tk.axis]).toFixed(2);
  $('rdetail').innerHTML=
    'attitude off by <b>'+res.attitudeDeg.toFixed(0)+'°</b>'
    +(res.edgeCatch?' — <b>caught the downhill edge</b>':'')+'<br>'+
    'you did <b>'+got+'</b> / '+tk.rev.toFixed(1)+' rev '+({spin:'spin',flip:'flip',roll:'cork'}[tk.axis])+'<br>'+
    '<b>'+(done?'✓ trick landed':(res.landed?'landed, wrong rotation':'crashed'))+'</b>';
  $('result').style.display='block';
  $('phase').textContent='Done';$('phaseSub').textContent='press Space to reset';
}
function replay(){
  state='plan';run=null;outro=null;inrun=null;
  $('phase').textContent='Plan your run';$('phaseSub').textContent='set rotation & beats, then drop';
  $('result').style.display='none';
  ['rSpin','rFlip','rRoll'].forEach(id=>$(id).textContent='0.00');
  $('poseName').textContent='—';$('poseBar').style.width='0%';
  drawBeats();rebuild();
}

// ── input ──
addEventListener('keydown',e=>{
  const tag=(e.target.tagName||'');if(tag==='INPUT'||tag==='SELECT')return;
  if(e.code==='KeyH'){$('hideUI').onclick(e);return;}
  if(e.code==='Space'){e.preventDefault();
    if(state==='plan')startDrop();
    else if(state==='fly')tapBeat(run.t);
    else if(state==='outro')showResult();
    else if(state==='result')replay();}
});
$('go').onclick=()=>{if(state==='plan')startDrop();};
$('again').onclick=replay;
// clean view: hide every panel (button or H) — the ride, nothing else
$('hideUI').onclick=e=>{e.stopPropagation();
  document.body.classList.toggle('clean');
  $('hideUI').textContent=document.body.classList.contains('clean')?'◲':'◱';};
// ── PORTRAIT SHEET: the plan panel is a pull-up sheet. Collapsed it shows a
// one-line summary of the run; tap the handle to open, tap Drop in to close
// and ride. Keeps the 3D view unobstructed on a phone.
const sheetOpen=()=>document.body.classList.contains('sheet');
function setSheet(on){document.body.classList.toggle('sheet',on);updSheetLbl();}
function updSheetLbl(){}   // tab is an icon now; the trick lives in the sheet + HUD
$('sheetGrab').onclick=e=>{e.stopPropagation();setSheet(!sheetOpen());};
$('go').addEventListener('click',()=>setSheet(false));   // planning done → ride
// resize/rotate: keep the renderer honest and never leave a sheet open in a
// layout that has no sheet (desktop / tall landscape)
addEventListener('orientationchange',()=>setTimeout(()=>{resize();
  if(!matchMedia('(max-width:900px) and (orientation:portrait)').matches
     &&!matchMedia('(max-height:560px) and (orientation:landscape)').matches)
    setSheet(false);},120));
// TOUCH = SPACE. A tap on the snow does whatever Space does in that phase, so
// the whole game is playable one-thumb on a phone (panels still tappable).
canvas.addEventListener('pointerdown',e=>{
  e.preventDefault();
  if(sheetOpen()){setSheet(false);return;}          // tap the view to dismiss the sheet
  if(state==='plan')startDrop();
  else if(state==='fly')tapBeat(run.t);
  else if(state==='outro')showResult();
  else if(state==='result')replay();
},{passive:false});

// ── camera (baked: dialed in live on 2026-07-21, panel removed) ──
const CAM={side:8.2,up:7.5,back:10,rise:4.6,pull:4.8,aim:-2.25,stiff:3.5};
const camPos=new THREE.Vector3(32,6,-2),camTgt=new THREE.Vector3(0,0,6);
function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);
  camera.aspect=w/h;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();
function qSpinStep(q,w,dt){
  const h=qMul(q,[0,w[0],w[1],w[2]]);
  return qNorm([q[0]+0.5*h[0]*dt,q[1]+0.5*h[1]*dt,q[2]+0.5*h[2]*dt,q[3]+0.5*h[3]*dt]);
}

// ═══════════════════ MAIN LOOP ═══════════════════
function tick(now){
  requestAnimationFrame(tick);
  const dtF=Math.min(0.033,(now-lastT)/1000);lastT=now;
  frameDt=dtF;

  if(state==='inrun'){
    const p0=runAt(inrun.s);
    const sinA=p0.d[1],cosA=p0.n[1];                    // slope angle from the path frame
    inrun.v+=(-G*sinA-MU_SNOW*G*cosA)*dtF;              // gravity along-track − friction
    if(inrun.v<0.8)inrun.v=0.8;                         // never quite stall
    inrun.s+=inrun.v*dtF;
    $('phaseSub').textContent='v = '+inrun.v.toFixed(1)+' m/s';
    if(inrun.s>=COURSE.LR){beginFlight();}
    else{
      const p=runAt(inrun.s);
      const cv=carveAt(inrun.s,run.carve);
      // decamber = rider load (1 g flat, 1/cosλ in the carve, g-load through
      // the tranny where v²·κ presses you into the snow) + surface conform
      const kap=(ySurfAt(p.z+1.5)-2*ySurfAt(p.z)+ySurfAt(p.z-1.5))/2.25;
      const loadG=1/Math.max(0.5,Math.cos(Math.abs(cv.roll||0)))
                 +Math.max(0,inrun.v*inrun.v*kap/G);
      stepFlex(dtF,Math.max(-0.02,Math.min(0.065,FLEX_PER_G*loadG+kap*0.35)));
      const desc=carvePose(ridePose(poseNowAt(0)),cv.roll*CARVE_LOWER);  // flexed + edging via the legs
      const dLip=COURSE.LR-inrun.s;
      const Lsw=(run.carve&&run.carve.e)?run.carve.Ls:12;
      desc.twist=(desc.twist||0)+windTwistAt(dLip,inrun.v,run.wind,Lsw); // coil in, unwind through the lip
      const q=carveQ(p.q,{yaw:cv.yaw,roll:cv.roll*(1-CARVE_LOWER)});     // small body inclination
      const rr=poseOnSnow(desc,q,{x:cv.x,y:p.y,z:p.z},p.n);
      // edge catch applies on the IN-RUN too — same SIDESLIP criterion. The
      // true velocity includes the carve's lateral component, and the board is
      // yawed along that path, so a correct carve has slip ≈ 0 and can never
      // false-trigger; only genuine sideways sliding onto the pressed edge bites.
      if(inrun.v>2&&rr.parts.bf){
        const bzw=qRot(q,rr.parts.bf.bz);
        const edgeDot=dot3(bzw,p.n);
        const tiltMag=Math.abs(Math.asin(Math.max(-1,Math.min(1,edgeDot))));
        const pressed=edgeDot<0?1:-1;
        const vhat=nrm([Math.tan(cv.yaw||0),p.d[1],p.d[2]]);   // true path direction incl. carve
        const slip=dot3(bzw,vhat);
        const held=Math.abs(slip)>0.4&&(pressed===-(slip>0?1:-1))&&tiltMag>rad(5);
        if(Math.abs(slip)>0.4&&!held){
          outro={t:0,res:{band:'crash',landed:false,attitudeDeg:0,edgeCatch:true,
              realizedRev:{spin:0,flip:0,roll:0},airtime:0},
            gains:{kP:8,kD:3,cap:3,downAt:55,kY:5},lastDesc:resolvePose(desc),
            down:false,tDown:0,recT:0,caught:true,bf:rr.parts.bf,
            v:inrun.v,z:p.z,x:cv.x,psi:0,lastPsiDot:0,vImp:3,tAbs:0.25,
            crouchDeep:Object.assign({},poseOf('Landing crouch')),
            q:q.slice(),w:[0,0,0]};
          state='outro';
          $('phase').textContent='Caught an edge!';$('phaseSub').textContent='Space to skip';
        }
      }
    }
  }
  if(state==='fly'){
    stepFlex(dtF,0);                                      // board rings out free in the air
    stepFlight(run,dtF);
    if(run.parts){syncRider(run.parts,run.bi.com);}
    applyQ(run.q);
    rider.position.copy(flightPos(run.t));
    $('rSpin').textContent=run.rev.spin.toFixed(2);
    $('rFlip').textContent=run.rev.flip.toFixed(2);
    $('rRoll').textContent=run.rev.roll.toFixed(2);
    const to=beats[track.toIdx];
    const f=Math.min(1,(run.t-track.t0)/(track.trans||TRANS));
    $('poseName').textContent=to.pose;
    $('poseBar').style.width=(f*100).toFixed(0)+'%';
    $('dbgLH').textContent=(run.Lmag||0).toFixed(1)+' · '
      +(run.lastH?Math.hypot(run.lastH[0],run.lastH[1],run.lastH[2]).toFixed(1):'0')+' kg·m²/s';
    $('dbgW').textContent='s '+(run.lastW[1]/TAU).toFixed(2)+' · f '+(run.lastW[2]/TAU).toFixed(2)
      +' · r '+(run.lastW[0]/TAU).toFixed(2);
    if(run.bi)$('dbgI').textContent=run.bi.I[0][0].toFixed(1)+' / '+run.bi.I[1][1].toFixed(1)
      +' / '+run.bi.I[2][2].toFixed(1);
    drawBeats(track.toIdx);
    if(run.done)beginOutro();
  }
  if(state==='outro'){
    const o=outro,C=COURSE;
    // full ride-out dynamics (grip / heading-follows-board / edge catch) —
    // the sign inversion in the heading chase is fixed, so this is now the
    // one and only ride-out. Substepped on the LOCAL surface, finite torques.
    const REAL=true;
    const OUT_HOLD=1.4,OUT_MAX=4.5;   // one ending rule for every outcome
    const localFrame=z=>{
      const m=(ySurfAt(z+0.2)-ySurfAt(z-0.2))/0.4;   // surface slope dy/dz
      const c=1/Math.hypot(1,m);
      return{t:[0,m*c,c],n:[0,c,-m*c]};
    };
    let rem=dtF;
    while(rem>1e-9){
      const dt=Math.min(1/120,rem);rem-=dt;
      o.t+=dt;
      const LF=localFrame(o.z),nv=LF.n,tv=LF.t;
      // velocity direction = riding heading ψ off the fall line, on the slope
      const hv=[Math.sin(o.psi),tv[1]*Math.cos(o.psi),tv[2]*Math.cos(o.psi)];
      const up=qRot(o.q,[0,1,0]);
      const dotUN=Math.max(-1,Math.min(1,dot3(up,nv)));
      const err=Math.acos(dotUN);
      const ax=cross3(up,nv),sinE=Math.hypot(ax[0],ax[1],ax[2]);
      if(!o.down&&err>rad(o.gains.downAt)){o.down=true;o.tDown=o.t;}  // the catch is lost
      // board vs VELOCITY on the slope plane (physics: grip, slip, skid drag)
      // + board vs the RIDDEN LINE (control: where the rider wants to go)
      let sinA=0,cosA=1,sinD=0,cosD=1;
      if(o.bf){
        const bxw=qRot(o.q,o.bf.bx);
        let bp=add3(bxw,nv,-dot3(bxw,nv));
        const bl=Math.hypot(bp[0],bp[1],bp[2]);
        if(bl>1e-6){bp=[bp[0]/bl,bp[1]/bl,bp[2]/bl];
          sinA=dot3(cross3(bp,hv),nv);cosA=dot3(bp,hv);
          // the LINE: before the save completes, aim the board at the FALL
          // LINE — the momentum you arrived with — NOT the current velocity.
          // (Velocity-as-target was self-referential: grip drags the path
          // toward the board while the board steers toward the path, and they
          // meet wherever the spin happened to stop — the both-sides veer.)
          // Once riding, aim for MID-RUN: pure-pursuit to the centreline,
          // executed as a real carve on the proper edge via the ψ̇→pose chain.
          let dv=tv;
          if(o.recT&&REAL){
            const pt=Math.max(-0.3,Math.min(0.3,-Math.atan(o.x/12)));  // mellow drift home
            dv=[Math.sin(pt),tv[1]*Math.cos(pt),tv[2]*Math.cos(pt)];
          }
          sinD=dot3(cross3(bp,dv),nv);cosD=dot3(bp,dv);
        }
      }
      const lat=cross3(nv,hv);                            // slope-plane left of travel
      const leanLat=dot3(add3(up,nv,-dotUN),lat);         // lateral hang of the body
      o.dbgA=Math.atan2(-sinA,cosA);o.dbgLean=leanLat;    // TRUE board bearing (display un-negated)
      // ── RIDE PHYSICS: gravity along the (possibly carving) path; drag from
      // sideways skid + residual spin. Recovered riders accelerate away.
      if(!o.down){
        const gAlong=G*(-hv[1]);
        // sideways skid must BRAKE on every slope we have (μ_max > tan 34°),
        // otherwise a crabbing rider glides away instead of scrubbing to a stop
        const mu=REAL?0.04+0.75*Math.min(1.3,Math.abs(sinA)+0.4*Math.min(1,Math.abs(o.w[1])/5)):0.10;
        o.v=Math.max(0,Math.min(20,o.v+(gAlong-mu*G*nv[1])*dt));
      }else{
        o.v=Math.max(0,o.v-7*dt);                         // a downed body just scrubs out
      }
      // the PATH BENDS to where the board points (grip): heading chases the
      // board's nearest end. This is the recovery mechanism itself — steering
      // the support back under the falling body.
      const yawRateN=dot3(qRot(o.q,o.w),nv);              // board pivot rate about the surface
      let psiDot=0;
      if(REAL&&!o.down&&o.bf){
        const dn=0.5*Math.atan2(2*sinA*cosA,cosA*cosA-sinA*sinA);
        // GRIP-scaled: only a near-ALIGNED board that is HOLDING its heading
        // bends the path. Sideways ⇒ skid. And a PIVOTING board (residual
        // spin) cannot carve either — its contact patch is slewing — so grip
        // dies with yaw rate. Without that, each sweep through alignment
        // ratcheted the path in the spin direction: the "pushed left" bug.
        const pivot=Math.max(0,1-Math.abs(yawRateN)/2.0);
        const grip=cosA*cosA*Math.min(1,Math.max(0,1-Math.abs(sinA)/0.7))*pivot;
        // SIGN: sinA encodes MINUS the board's bearing (cross-product order),
        // which is right for the steering torque but must be FLIPPED for the
        // chase — with +dn the heading FLED the board: the opposite-direction
        // riding. ψ̇ = −dn/τ chases the board's near end, as grip should.
        psiDot=Math.max(-1.8,Math.min(1.8,-dn/0.25))*grip;
        o.psi=Math.max(-0.6,Math.min(0.6,o.psi+psiDot*dt));  // ride the line; never bolt off the run
      }
      o.lastPsiDot=psiDot;
      o.pdS=(o.pdS||0)+(psiDot-(o.pdS||0))*(1-Math.exp(-dt/0.12));  // low-passed ψ̇ for the pose
      o.x=Math.max(-7.4,Math.min(7.4,o.x+o.v*hv[0]*dt));  // stay on the run
      o.z+=o.v*hv[2]*dt;
      // ── EDGE CATCH — tested EVERY substep the board is on snow, from the
      // touchdown instant until the rider stops or goes down. The criterion is
      // SIDESLIP: a board moving along its own length CANNOT catch, however
      // hard it is edged (that is simply carving — which is why a banked
      // takeoff or clean edged landing must never trigger). It bites only when
      // the board slides SIDEWAYS toward the pressed edge: slip = v̂·edge with
      // the same sign as the pressed side, and more than ~24° of sideways.
      // Sliding SIDEWAYS is catch-prone by default: flat-base sideways bites
      // almost immediately (any micro-edge does it), and leading-edge pressure
      // bites instantly. The ONLY safe sideways slide is a deliberately HELD
      // trailing (uphill) edge — ≥5° the other way. That's the real rule.
      if(REAL&&!o.down&&!o.caught&&o.bf&&o.v>2){
        const bzw=qRot(o.q,o.bf.bz);                      // toe-edge direction, world
        const edgeDot=dot3(bzw,nv);                       // >0 ⇒ toe up ⇒ heel pressed
        const tiltMag=Math.abs(Math.asin(Math.max(-1,Math.min(1,edgeDot))));
        const pressed=edgeDot<0?1:-1;                     // +1 toe edge down, −1 heel
        const slip=dot3(bzw,hv);                          // sideways vs the ACTUAL velocity
        if(Math.abs(slip)>0.4&&Math.abs(slip)*o.v>1.2){   // real sideways SPEED, not a graze
          const leadSign=slip>0?1:-1;                     // the side the board slides toward
          const held=(pressed===-leadSign)&&tiltMag>rad(5);  // uphill edge deliberately held
          if(!held){
            o.caught=true;
            $('phase').textContent='Caught an edge!';
          }
        }
      }
      // A BITE IS NOT FOREVER. It either slams you down within a beat, or the
      // rider rolls off the edge and it RELEASES. Without release, a weak
      // catch latched permanently: steering and righting disabled, a small
      // steady edge torque left on — the rider drifted off sideways with ZERO
      // lean. (That was the ghost push: ψ climbing, board parked off-angle.)
      if(o.caught&&!o.down){
        o.caughtT=(o.caughtT||0)+dt;
        const bzw2=qRot(o.q,o.bf.bz);
        const eDot=dot3(bzw2,nv);
        const tilt2=Math.abs(Math.asin(Math.max(-1,Math.min(1,eDot))));
        const prs=eDot<0?1:-1;
        const slp=dot3(bzw2,hv);
        const held2=(prs===-(slp>0?1:-1))&&tilt2>rad(5);
        const biting=Math.abs(slp)>0.3&&!held2&&o.v>2;    // the catch condition, still true?
        // release ONLY a genuinely marginal bite: condition gone AND the body
        // barely moving AND still near upright, after a real beat. Once the
        // slam impulse has the body rotating, there is no recovery — the
        // angular momentum over the edge does not care that speed scrubbed off.
        const wMag=Math.hypot(o.w[0],o.w[1],o.w[2]);
        if(!biting&&o.caughtT>0.3&&err<rad(12)&&wMag<1.5){
          o.caught=false;o.caughtT=0;o.slammed=false;
          $('phase').textContent='Riding out';
        }
      }
      let aW=[0,0,0];
      if(o.caught&&!o.down){
        // edge axis in the slope plane, signed to tip DOWN-path over the edge
        const bxw=qRot(o.q,o.bf.bx);
        let a=add3(bxw,nv,-dot3(bxw,nv));
        const al=Math.hypot(a[0],a[1],a[2])||1;a=[a[0]/al,a[1]/al,a[2]/al];
        if(dot3(cross3(a,up),hv)<0)a=[-a[0],-a[1],-a[2]];
        const bzw=qRot(o.q,o.bf.bz);
        const slipNow=Math.min(1,Math.abs(dot3(bzw,hv)));
        // THE SLAM IS AN IMPULSE: sideways momentum converts to rotation over
        // the edge, once, at the bite — Δω ≈ η·v_sideways/h_com. Decisive.
        if(!o.slammed){
          o.slammed=true;
          const dW=0.8*o.v*slipNow;
          const wW0=qRot(o.q,o.w);
          o.w=qRotInv(o.q,[wW0[0]+a[0]*dW,wW0[1]+a[1]*dW,wW0[2]+a[2]*dW]);
        }
        // then GRAVITY topples the tipped body over the edge (past the balance
        // point the pendulum only goes one way); a small residual bite drags
        const mag=6.5*Math.sin(Math.min(err,rad(70)))+4*slipNow*Math.min(1,o.v/6);
        aW=[a[0]*mag,a[1]*mag,a[2]*mag];
        o.v=Math.max(0,o.v-6*dt);                         // the biting board scrubs speed hard
      }else if(!o.down&&sinE>1e-6){
        // legs do the righting. (The carve-boost + lean-steer assists are
        // REMOVED: their sign rests on an unverifiable convention chain, and a
        // single flip anywhere makes them push the WRONG way — the suspected
        // sideways shove. The righting axis below is sign-safe by construction:
        // cross(up, n) always rotates up toward the normal.)
        const capScale=0.55+0.45*Math.min(1,o.t/(o.tAbs||0.25));
        const capEff=o.gains.cap*capScale;
        const u=[ax[0]/sinE,ax[1]/sinE,ax[2]/sinE];
        const mag=Math.min(capEff,o.gains.kP*err);
        aW=[u[0]*mag,u[1]*mag,u[2]*mag];
      }
      // STEER — align to travel (nearest end; switch is fine) PLUS steer INTO
      // the lean: turning toward the fall is how the support gets back under
      // the COM. Together with heading-follows-board this closes the loop.
      if(!o.down&&!o.caught){
        // steering law with FULL authority at 90°. The old sin·cos form had a
        // zero-torque saddle at exactly perpendicular — an under-rotated
        // landing parked there and crabbed off sideways forever. Nearest-end
        // signed angle instead: monotone to ±90°, zero only when aligned; at
        // dead-perpendicular, commit with the residual spin direction.
        let ds=0.5*Math.atan2(2*sinD*cosD,cosD*cosD-sinD*sinD);
        if(Math.abs(yawRateN)>1.0){
          // a LIVE rotation is steered THROUGH to the next end ahead — never
          // reversed back toward the end it already crossed
          const th=Math.atan2(-sinD,cosD);                // true bearing vs the line
          const r=yawRateN>0?1:-1;
          const ahead=((-r*th*180/Math.PI)%180+180)%180;  // degrees still to go
          ds=r*Math.min(1.2,rad(Math.min(ahead,90)));
        }else if(Math.abs(cosD)<0.08)ds=(yawRateN>=0?1:-1)*1.2;
        const steer=o.gains.kY*Math.sin(ds)-2.5*yawRateN;   // pivot to the line; no lean coupling
        aW=[aW[0]+nv[0]*steer,aW[1]+nv[1]*steer,aW[2]+nv[2]*steer];
      }
      const kD=o.down?4.5:(o.caught?1.5:o.gains.kD);      // a toppling body is NOT leg-damped
      const wW=qRot(o.q,o.w);
      const w2=[wW[0]+(aW[0]-kD*wW[0])*dt,wW[1]+(aW[1]-kD*wW[1])*dt,wW[2]+(aW[2]-kD*wW[2])*dt];
      o.w=qRotInv(o.q,w2);
      const hq=qMul(o.q,[0,o.w[0]*0.5,o.w[1]*0.5,o.w[2]*0.5]);
      o.q=qNorm([o.q[0]+hq[0]*dt,o.q[1]+hq[1]*dt,o.q[2]+hq[2]*dt,o.q[3]+hq[3]*dt]);
      if(!o.down&&!o.recT&&o.t>0.32&&err<rad(15)&&Math.abs(sinA)<0.5
         &&Math.hypot(o.w[0],o.w[1],o.w[2])<2.5)
        o.recT=o.t;                                       // upright AND riding a line — stand up
    }
    if(o.z>C.zEnd-2){o.z=C.zEnd-2;o.v=0;}
    const z=o.z,y=ySurfAt(z),nv=localFrame(z).n;
    $('dbgW').textContent='s '+(o.w[1]/TAU).toFixed(2)+' · f '+(o.w[2]/TAU).toFixed(2)+' · r '+(o.w[0]/TAU).toFixed(2);
    $('dbgLH').textContent='ψ '+(o.psi*180/Math.PI).toFixed(0)+'° · brd '+((o.dbgA||0)*180/Math.PI).toFixed(0)
      +'° · lean '+((o.dbgLean||0)).toFixed(2)+' · x '+o.x.toFixed(1);
    if(!o.down){
      // compression stroke sized by the impact; rise only once riding a line
      // board flex on snow: LOAD decamber (1 g riding + recovery-carve g-load
      // + the compression spike bell through the absorption stroke) + surface
      // conform + skid chatter; the suspension hop rides on the contact anchor
      const kap=(ySurfAt(z+1.5)-2*ySurfAt(z)+ySurfAt(z-1.5))/2.25;
      const carveG=1/Math.max(0.6,Math.cos(Math.atan(o.v*Math.abs(o.pdS||0)/G)));
      const tA=o.tAbs||0.25;
      const compG=(o.t<tA)?(o.vImp||0)/(G*tA)*Math.sin(Math.PI*Math.min(1,o.t/tA)):0;
      const target=Math.max(-0.02,Math.min(0.07,FLEX_PER_G*(carveG+compG)+kap*0.35));
      stepFlex(dtF,target,(Math.abs(o.dbgA||0)>0.6&&o.v>4)?Math.sin(o.t*90)*1.6*dtF*60:0);
      BOUNCE.bv+=(-900*BOUNCE.b-27*BOUNCE.bv)*dtF;
      BOUNCE.b+=BOUNCE.bv*dtF;
      if(BOUNCE.b<0){BOUNCE.b=0;BOUNCE.bv=-BOUNCE.bv*0.35;}  // ground: bounce with restitution
      const pIn=smooth(Math.min(1,o.t/(o.tAbs||0.25)));
      const pOut=o.recT?smooth(Math.min(1,(o.t-o.recT)/0.9)):0;
      let desc=pOut>0?blendPose(o.crouchDeep||poseOf('Landing crouch'),poseOf('Athletic stance'),pOut)
                     :blendPose(o.lastDesc,o.crouchDeep||poseOf('Landing crouch'),pIn);
      // recovery carving shows in the LEGS: edge + angulation from the actual
      // path curvature, same lower-body model as the setup carve
      const eR=Math.max(-0.4,Math.min(0.4,-Math.atan(o.v*(o.pdS||0)/G)));  // smooth, low-passed
      if(Math.abs(eR)>0.03)desc=carvePose(desc,eR*CARVE_LOWER);
      // BOARD-HOLD: the legs keep the board ON THE RIDING LINE while the torso
      // recovers around it. Without this, the pose blend back to neutral swung
      // the board frame under the still-twisted body — un-aligning the board
      // mid-recovery and INVITING the very edge catches the check avoided.
      {const bn2=0.5*Math.atan2(Math.sin(2*(o.dbgA||0)),Math.cos(2*(o.dbgA||0)));
       // while the body still carries real spin, the legs do NOT fight it back
       // toward the passed end — the hold engages once the pivot has resolved
       const want=Math.abs(o.w[1])>1.2?0:Math.max(-40,Math.min(40,-bn2*180/Math.PI));
       o.poseYaw=(o.poseYaw||0)+(want-(o.poseYaw||0))*(1-Math.exp(-dtF/0.25));
       if(Math.abs(o.poseYaw)>0.5){
         desc=Object.assign({},desc,{board:Object.assign({},desc.board,
           {yaw:(desc.board.yaw||0)+o.poseYaw}),
           pyaw:(desc.pyaw||0)+o.poseYaw*0.4});           // hips share the hold
       }}
      const rr=poseOnSnow(desc,o.q,{x:o.x,y,z},nv);
      rider.position.addScaledVector(new THREE.Vector3(nv[0],nv[1],nv[2]),BOUNCE.b);  // suspension hop
      o.bf=rr.parts.bf;                                   // board frame for the edge-catch test
      // UNIFIED ENDING: result appears OUT_HOLD s after the run's terminal
      // state — here, the landing being caught — same rule as the crash path
      if((o.recT&&o.t-o.recT>OUT_HOLD)||o.t>OUT_MAX)showResult();
    }else{
      const pd=smooth(Math.min(1,(o.t-o.tDown)*1.6));
      const desc=blendPose(o.lastDesc,poseOf('Sprawl'),pd);
      const parts=partsFromPose(desc),bi=bodyInertia(parts);
      syncRider(parts,bi.com);
      applyQ(o.q);
      const hgt=Math.max(0.35,1.0*Math.exp(-2.5*(o.t-o.tDown))+0.30);
      rider.position.set(o.x,y,z).addScaledVector(new THREE.Vector3(nv[0],nv[1],nv[2]),hgt);
      // UNIFIED ENDING: terminal state here = the downed body sliding to rest;
      // then the SAME hold as the ride-out before the result appears
      if(!o.stopT&&o.v<0.8)o.stopT=o.t;
      if((o.stopT&&o.t-o.stopT>OUT_HOLD)||o.t>OUT_MAX)showResult();
    }
  }

  let wantPos,wantTgt,kc;
  if(state==='plan'){
    wantPos=new THREE.Vector3(32,6,-2);wantTgt=new THREE.Vector3(0,0,6);
    kc=1-Math.exp(-dtF*3.2);
  }else{
    let f=0;
    if(state==='fly'){const vy=run.J.speed*run.uTake[1]-G*run.t;f=Math.max(0,Math.min(1,-vy/10));}
    else if(state==='outro')f=1;
    wantPos=rider.position.clone().add(new THREE.Vector3(CAM.side-0.15*CAM.pull*f,CAM.up+CAM.rise*f,-(CAM.back-CAM.pull*f)));
    wantTgt=rider.position.clone().add(new THREE.Vector3(0,CAM.aim,0));
    kc=1-Math.exp(-dtF*CAM.stiff);
  }
  camPos.lerp(wantPos,kc);camTgt.lerp(wantTgt,kc);
  camera.position.copy(camPos);camera.lookAt(camTgt);
  renderer.render(scene,camera);
}
drawBeats();
rebuild();
requestAnimationFrame(tick);
