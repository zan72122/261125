// Room environments: hamster cage, rabbit hutch, penguin ice yard
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from '../lib/BufferGeometryUtils.js';
import { woodTex, noiseTex, paperTex, strawTex, cookieTex, softDotTex, waterNormalTex } from './textures.js';
import { makeSeed, makeBroccoli, makeCarrot, makeLeaf, makeFish, makeShrimp, makeDish } from './food.js';
import { rng, clamp, lerp, smooth, mergeStatic } from './util.js';
import { Hamster } from './hamster.js';
import { Rabbit } from './rabbit.js';
import { Penguin } from './penguin.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  parent && parent.add(m);
  return m;
}
function woodMat(seed, base, dark, opts = {}, repeat = [1, 1]) {
  const t = woodTex(seed, base, dark, opts);
  const clone = (tx) => { const c = tx.clone(); c.repeat.set(repeat[0], repeat[1]); c.needsUpdate = true; return c; };
  return new THREE.MeshStandardMaterial({ map: clone(t.map), normalMap: clone(t.normalMap), roughnessMap: clone(t.roughnessMap), roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6) });
}

class Room {
  constructor(kind, env, portrait) {
    this.kind = kind;
    this.portrait = !!portrait;
    this.scene = new THREE.Scene();
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.42;
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 40);
    this.foods = [];
    this.spots = {};
    this.keyPoints = [];
    this.time = 0;
    this.camState = null;
  }
  addSun(pos, color, intensity, half, mapSize = 1024) {
    const s = new THREE.DirectionalLight(color, intensity);
    s.position.copy(pos);
    s.castShadow = true;
    s.shadow.mapSize.set(mapSize, mapSize);
    const c = s.shadow.camera; c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 0.5; c.far = 20;
    s.shadow.bias = -0.0004; s.shadow.normalBias = 0.025; s.shadow.radius = 4;
    s.target.position.set(0, 0, 0);
    this.scene.add(s, s.target);
    this.sun = s;
    return s;
  }
  boxPoints(cx, cy, cz, hx, hy, hz) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) this.keyPoints.push(V(cx + sx * hx, cy + sy * hy, cz + sz * hz));
  }
  // points describing animal + dishes for the home window framing
  homePoints() {
    const a = this.animal.root.position;
    const pts = [];
    const s = this.animalSize;
    for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) pts.push(V(a.x + sx * s[0], a.y + sy * s[1], a.z + sz * s[2]));
    for (const d of [this.spots.foodDishW, this.spots.emptyDishW]) { pts.push(V(d.x - 0.25, 0, d.z + 0.2), V(d.x + 0.25, 0.1, d.z - 0.2)); }
    if (this.animal.asleep || this.animal.state === 'toBed') {
      // frame the sleeping animal closer
      pts.length = 0;
      for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) pts.push(V(a.x + sx * s[0] * 1.6, a.y + sy * s[1] * 1.2, a.z + sz * s[2] * 1.4));
    }
    return pts;
  }
  addFood(food, dish, local, rotY = 0, tilt = 0) {
    const p = dish.position.clone().add(local);
    food.setHome(this.scene, p, rotY, tilt);
    this.foods.push(food);
    return food;
  }
  replayFoods() { for (const f of this.foods) f.resetToDish(); }
  // batch everything that never moves (walls, boxes, rocks, dishes...) into one mesh per material
  optimize() {
    this.animal.root.userData.dyn = true;
    for (const f of this.foods) f.obj.userData.dyn = true;
    mergeStatic(this.scene, mergeGeometries);
  }
  update(dt) {
    this.time += dt;
    this.animal.update(dt);
    for (const f of this.foods) f.update(dt, this.time);
    this.updateEnv && this.updateEnv(dt);
  }
}

// ---------------------------------------------------------------- Hamster
export class HamsterRoom extends Room {
  constructor(env, portrait) {
    super('hamster', env, portrait);
    const P = this.portrait;
    const L = P ? { nest: [-0.52, -0.72], wheel: [0.56, -1.42], home: [0.04, 0.32], dF: [-0.42, 1.0], dE: [0.46, 1.02] }
      : { nest: [-1.05, -0.95], wheel: [1.08, -0.86], home: [0, 0.15], dF: [-0.62, 0.78], dE: [0.62, 0.8] };
    this.L = L;
    const sc = this.scene;
    sc.background = new THREE.Color(0xcdb79a);
    this.addSun(V(-1.6, 3.6, 2.6), 0xffe7c8, 2.3, 2.4);
    const fill = new THREE.HemisphereLight(0xfff4e6, 0x8a6a4a, 0.35); sc.add(fill);
    // floor: bedding base
    const pt = paperTex();
    const baseMap = pt.map.clone(); baseMap.repeat.set(10, 8); baseMap.needsUpdate = true;
    const baseN = pt.normalMap.clone(); baseN.repeat.set(10, 8); baseN.needsUpdate = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.6), new THREE.MeshStandardMaterial({ map: baseMap, normalMap: baseN, roughness: 0.95, color: 0xf1e8da }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), woodMat(7, [170, 120, 80], [120, 80, 48], { planks: 4 }, [3, 2]));
    table.rotation.x = -Math.PI / 2; table.position.set(0, -0.005, 3.2); table.receiveShadow = true; sc.add(table);
    // cage: wood tray rim, back panel, side posts + bars
    const wood = woodMat(3, [196, 150, 100], [150, 102, 60], { planks: 0 }, [1, 1]);
    const woodV = woodMat(5, [190, 140, 92], [138, 92, 52], { planks: 5 }, [1, 1]);
    box(4.6, 2.6, 0.08, woodV, 0, 1.3, -1.75, sc); // back panel
    box(4.6, 0.12, 0.1, wood, 0, 0.06, 1.62, sc); // front rim (low)
    for (const sx of [-1, 1]) {
      box(0.1, 2.6, 0.1, wood, sx * 2.25, 1.3, -1.7, sc);
      box(0.1, 2.6, 0.1, wood, sx * 2.25, 1.3, 1.6, sc);
      box(0.1, 0.12, 3.4, wood, sx * 2.25, 0.06, 0, sc);
      // bars on the sides
      const barMat = new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.35, metalness: 0.7 });
      const bars = [];
      for (let i = 0; i < 22; i++) { const g = new THREE.CylinderGeometry(0.012, 0.012, 2.5, 6); g.translate(sx * 2.25, 1.3, -1.6 + i * 0.152); bars.push(g); }
      const bm = new THREE.Mesh(mergeGeometries(bars), barMat); bm.castShadow = true; sc.add(bm);
      box(0.08, 0.08, 3.4, wood, sx * 2.25, 2.55, 0, sc);
    }
    // wall behind (room)
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshStandardMaterial({ color: 0xd8c7ad, roughness: 0.95 }));
    wall.position.set(0, 3, -2.2); sc.add(wall);
    // instanced paper bedding
    this.bedding = this.makeBedding(2600, 4.3, 3.3);
    sc.add(this.bedding);
    // nest box
    const [nx, nz] = L.nest, [wx, wz] = L.wheel, [hx, hz] = L.home;
    this.spots = {
      home: L.home,
      nestFront: [nx, nz + 0.75], nestIn: [nx, nz + 0.17], bed: [nx + 0.05, nz + 0.09], bedYaw: 0.6,
      pile: [nx - 0.3, nz],
      wheelFront: [wx, wz + 0.48], wheelIn: [wx, wz], wheelY: 0.075,
      emerge: [[hx + 0.35, hz - 0.25], [hx - 0.38, hz + 0.05], [hx + 0.2, hz + 0.3], [hx - 0.25, hz - 0.35]],
    };
    this.makeNest(nx, nz);
    this.makeWheel(wx, wz);
    // dishes
    const dishF = makeDish(0.24, 0.07, 0xf3ecdf, 0xe6d4bb); dishF.position.set(L.dF[0], 0, L.dF[1]); sc.add(dishF);
    const dishE = makeDish(0.21, 0.065, 0xe7eef0, 0xcad9df); dishE.position.set(L.dE[0], 0, L.dE[1]); sc.add(dishE);
    this.spots.foodDishW = V(L.dF[0], 0.05, L.dF[1]); this.spots.emptyDishW = V(L.dE[0], 0.05, L.dE[1]);
    this.dishF = dishF;
    // foods: 3 seeds + broccoli
    const seedSpots = [[-0.08, 0.042, -0.07, 0.5], [0.07, 0.042, -0.1, 2.1], [-0.02, 0.042, 0.09, -0.7]];
    for (const [x, y, z, r] of seedSpots) this.addFood(makeSeed(0.125), dishF, V(x, y, z), r, Math.PI / 2 - 0.05);
    this.addFood(makeBroccoli(1.0), dishF, V(0.07, 0.03, 0.06), 0.4, 0.25);
    // bedding mound for emerging
    this.mound = this.makeMound();
    // animal
    this.animal = new Hamster();
    this.animal.setRoom(this);
    sc.add(this.animal.root);
    this.animalSize = [0.35, 0.5, 0.42];
    // key points for camera framing
    this.boxPoints(nx, 0.35, nz, 0.5, 0.35, 0.4); // nest
    this.boxPoints(wx, 0.6, wz, 0.6, 0.6, 0.15); // wheel
    this.boxPoints(hx, 0.25, hz, 0.35, 0.25, 0.4); // animal
    this.boxPoints(L.dF[0], 0.05, L.dF[1], 0.25, 0.05, 0.25);
    this.boxPoints(L.dE[0], 0.05, L.dE[1], 0.22, 0.05, 0.22);
    this.camCfg = { pitchL: 0.2, pitchP: 0.5, fovL: 36, fovP: 48, ty: 0.0 };
  }
  makeBedding(n, w, d) {
    const g = new THREE.PlaneGeometry(0.06, 0.04, 4, 3);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i); pa.setZ(i, Math.pow(x / 0.03, 2) * 0.006 + Math.sin(x * 140 + y * 90) * 0.0025); }
    g.computeVertexNormals();
    const pt = paperTex();
    const mat = new THREE.MeshStandardMaterial({ map: pt.map, normalMap: pt.normalMap, roughness: 0.92, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(g, mat, n);
    const r = rng(77);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    this.bedInst = [];
    for (let i = 0; i < n; i++) {
      p.set((r() - 0.5) * w, 0.006 + r() * 0.03, (r() - 0.5) * d);
      e.set(-Math.PI / 2 + (r() - 0.5) * 0.5, r() * Math.PI * 2, r() * Math.PI * 2, 'YXZ');
      q.setFromEuler(e); const k = 0.6 + r() * 0.9; s.set(k, k * (0.7 + r() * 0.6), k);
      m.compose(p, q, s); im.setMatrixAt(i, m);
      const v = 0.9 + r() * 0.1; col.setRGB(v, v * (0.95 + r() * 0.04), v * (0.87 + r() * 0.08));
      im.setColorAt(i, col);
      this.bedInst.push({ p: p.clone(), q: q.clone(), s: s.clone() });
    }
    im.receiveShadow = true; im.castShadow = false;
    return im;
  }
  makeMound() {
    const g = new THREE.SphereGeometry(0.32, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const pa = g.attributes.position; const r = rng(9);
    for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); pa.setY(i, y * 0.6 * (0.9 + r() * 0.2)); pa.setX(i, pa.getX(i) * (0.95 + r() * 0.1)); }
    g.computeVertexNormals();
    const pt = paperTex();
    const mp = pt.map.clone(); mp.repeat.set(3, 2); mp.needsUpdate = true;
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: mp, normalMap: pt.normalMap, roughness: 0.95, color: 0xf3ebdf }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    const grp = new THREE.Group(); grp.add(mesh);
    // pieces on the mound
    const pieces = this.makeBedding(70, 0.5, 0.5);
    pieces.position.y = 0.0;
    grp.add(pieces);
    grp.visible = false; grp.userData.dyn = true;
    this.scene.add(grp);
    const self = this;
    return {
      place(x, z) { grp.position.set(x, 0, z); },
      set(v) { grp.visible = v > 0.01; grp.scale.set(0.5 + 0.5 * v, Math.max(0.01, v), 0.5 + 0.5 * v); self.moundV = v; },
    };
  }
  makeNest(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const w = 1.0, h = 0.68, d = 0.82, t = 0.035;
    const wm = woodMat(12, [200, 158, 108], [150, 108, 64], { planks: 3 }, [1, 1]);
    const dark = woodMat(13, [150, 110, 70], [100, 70, 40], {}, [1, 1]);
    box(w, h, t, wm, 0, h / 2, -d / 2, g); // back
    box(t, h, d, wm, -w / 2, h / 2, 0, g); box(t, h, d, wm, w / 2, h / 2, 0, g);
    box(w + 0.12, t, d + 0.12, wm, 0, h + t / 2, 0.02, g); // roof
    box(w, 0.09, t, wm, 0, 0.045, d / 2, g); // threshold lip
    // front frame top beam
    box(w, 0.16, t, wm, 0, h - 0.08, d / 2, g);
    // inner shadowy floor bedding
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.05, d - 0.05), new THREE.MeshStandardMaterial({ color: 0xe9dcc8, roughness: 1 }));
    inner.rotation.x = -Math.PI / 2; inner.position.y = 0.01; inner.receiveShadow = true; g.add(inner);
    const bed = this.makeBedding(260, w - 0.1, d - 0.1); g.add(bed);
    // seed pile
    const pile = new THREE.Group(); pile.position.set(this.spots.pile[0] - x, 0.02, this.spots.pile[1] - z);
    const r = rng(31);
    for (let i = 0; i < 9; i++) {
      const s = makeSeed(0.105, true);
      const a = r() * Math.PI * 2, rr = r() * 0.09;
      s.position.set(Math.cos(a) * rr, 0.012 + (0.09 - rr) * 0.15, Math.sin(a) * rr);
      s.rotation.set(Math.PI / 2 + (r() - 0.5) * 0.6, r() * Math.PI, (r() - 0.5) * 0.6);
      pile.add(s);
    }
    this.extraSeeds = [];
    for (let i = 0; i < 12; i++) {
      const s = makeSeed(0.105, true);
      const a = r() * Math.PI * 2, rr = r() * 0.06;
      s.position.set(Math.cos(a) * rr, 0.035 + i * 0.006, Math.sin(a) * rr);
      s.rotation.set(Math.PI / 2 + (r() - 0.5) * 0.9, r() * Math.PI, (r() - 0.5) * 0.9);
      s.visible = false; s.userData.dyn = true; pile.add(s); this.extraSeeds.push(s);
    }
    g.add(pile);
    this.scene.add(g);
  }
  setNestSeeds(n) { this.extraSeeds.forEach((s, i) => { s.visible = i < n; }); }
  makeWheel(x, z) {
    const R = 0.56, D = 0.3;
    this.spots.wheelR = R;
    const g = new THREE.Group(); g.position.set(x, 0.06 + R, z);
    const wm = woodMat(21, [205, 165, 115], [160, 118, 70], {}, [1, 1]);
    // back disc
    const back = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.03, 48), wm); back.rotation.x = Math.PI / 2; back.position.z = -D / 2 - 0.015; back.castShadow = true; back.receiveShadow = true;
    const drum = new THREE.Group(); drum.userData.dyn = true;
    drum.add(back);
    // running surface (slatted)
    const slatT = woodTex(22, [215, 175, 125], [170, 125, 80], { planks: 24 });
    const smap = slatT.map.clone(); smap.repeat.set(1, 1); smap.needsUpdate = true;
    const surf = new THREE.Mesh(new THREE.CylinderGeometry(R, R, D, 64, 1, true), new THREE.MeshStandardMaterial({ map: smap, normalMap: slatT.normalMap, side: THREE.DoubleSide, roughness: 0.8 }));
    surf.rotation.x = Math.PI / 2; surf.castShadow = true; surf.receiveShadow = true; drum.add(surf);
    // front rim
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.005, 0.022, 10, 64), wm); rim.position.z = D / 2; rim.castShadow = true; drum.add(rim);
    // hub
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 20), wm); hub.rotation.x = Math.PI / 2; hub.position.z = -D / 2 - 0.04; drum.add(hub);
    g.add(drum);
    // stand
    const st = box(0.08, R + 0.06, 0.06, wm, 0, -(R + 0.06) / 2, -D / 2 - 0.08, g);
    box(0.5, 0.04, 0.3, wm, 0, -R - 0.04, -D / 2 - 0.08, g);
    this.scene.add(g);
    const self = this;
    this.wheel = { radius: R, angle: 0, spin(da) { this.angle -= da; drum.rotation.z = this.angle; } };
  }
  updateEnv(dt) {
    // lift bedding pieces near the mound
    if (this.moundV !== this._lastMound && this.bedInst) {
      this._lastMound = this.moundV;
    }
  }
}

// ---------------------------------------------------------------- Rabbit
export class RabbitRoom extends Room {
  constructor(env, portrait) {
    super('rabbit', env, portrait);
    const P = this.portrait;
    const L = P ? { bed: [-0.5, -1.25], bedW: 1.1, home: [0, 0.3], dF: [-0.45, 1.02], dE: [0.48, 1.06], hop: [[-0.3, -0.4], [0.05, -0.4], [0.55, -0.4]], rackX: 0.35 }
      : { bed: [-1.05, -0.85], bedW: 1.3, home: [0, 0.15], dF: [-0.68, 0.82], dE: [0.68, 0.85], hop: [[0.05, -0.4], [0.42, -0.4], [1.0, -0.4]], rackX: -0.15 };
    this.L = L;
    const sc = this.scene;
    sc.background = new THREE.Color(0xbfd2c4);
    // dappled sunlight: spot light with a leaf-shadow cookie
    const spot = new THREE.SpotLight(0xfff0d8, 60, 14, 0.62, 0.6, 1.4);
    spot.position.set(1.4, 4.5, 2.2);
    spot.target.position.set(-0.1, 0, -0.3);
    spot.map = cookieTex();
    spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.03; spot.shadow.radius = 4;
    sc.add(spot, spot.target);
    this.spot = spot;
    const fill = new THREE.HemisphereLight(0xe8f2ff, 0x9a7a52, 0.55); sc.add(fill);
    const dirFill = new THREE.DirectionalLight(0xffeedd, 0.5); dirFill.position.set(-2, 3, 3); sc.add(dirFill);
    // wooden floor boards
    const floorM = woodMat(41, [196, 160, 118], [150, 112, 72], { planks: 6 }, [2, 2]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 7.8), floorM);
    floor.position.z = 2; floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor);
    // hutch walls
    const wallM = woodMat(43, [176, 132, 88], [128, 90, 54], { planks: 6 }, [1, 1]);
    box(4.8, 2.8, 0.08, wallM, 0, 1.4, -1.85, sc);
    for (const sx of [-1, 1]) {
      const sw = box(0.08, 2.8, 3.7, wallM, sx * 2.4, 1.4, 0, sc);
      box(0.12, 2.8, 0.12, woodMat(44, [150, 108, 66], [110, 76, 44]), sx * 2.36, 1.4, 1.7, sc);
    }
    box(4.8, 0.14, 0.14, woodMat(44, [150, 108, 66], [110, 76, 44]), 0, 2.75, 1.7, sc);
    // hay rack on the back wall
    const rack = new THREE.Group(); rack.position.set(L.rackX, 0.9, -1.72);
    const rackM = woodMat(45, [160, 118, 76], [120, 84, 50]);
    box(0.9, 0.06, 0.25, rackM, 0, 0, 0.12, rack);
    for (let i = 0; i < 9; i++) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), rackM); bar.position.set(-0.4 + i * 0.1, 0.2, 0.25); bar.rotation.x = -0.35; bar.castShadow = true; rack.add(bar); }
    rack.add(this.makeStraw(380, 0.8, 0.22, 0.25, 0.32, 51, 0xb9c77e, 0.12));
    sc.add(rack);
    // straw bed (back-left) + loose straw along walls
    const [bx, bz] = L.bed, bw = L.bedW;
    this.spots = {
      home: L.home, bed: [bx - 0.15, bz - 0.1], bedYaw: -1.25,
      hop0: L.hop[0], hop1: L.hop[1], hop2: L.hop[2], hopYaw: Math.PI / 2,
    };
    const bedBox = new THREE.Group(); bedBox.position.set(bx, 0, bz);
    box(bw, 0.1, 0.05, rackM, 0, 0.05, 0.55, bedBox); box(bw, 0.1, 0.05, rackM, 0, 0.05, -0.55, bedBox);
    box(0.05, 0.1, 1.1, rackM, -bw / 2, 0.05, 0, bedBox); box(0.05, 0.1, 1.1, rackM, bw / 2, 0.05, 0, bedBox);
    bedBox.add(this.makeStraw(Math.round(1700 * bw / 1.3), bw - 0.05, 0.05, 1.05, 0.0, 61, 0xd8b878, 0.16));
    sc.add(bedBox);
    const loose = this.makeStraw(260, 4.4, 0.02, 0.5, 0, 71, 0xd4b474, 0.15); loose.position.set(0, 0, -1.5); sc.add(loose);
    // dishes
    const dishF = makeDish(0.27, 0.08, 0xeeeae2, 0xb9cbd6); dishF.position.set(L.dF[0], 0, L.dF[1]); sc.add(dishF);
    const dishE = makeDish(0.24, 0.075, 0xe4ded2, 0xd9c7b0); dishE.position.set(L.dE[0], 0, L.dE[1]); sc.add(dishE);
    this.spots.foodDishW = V(L.dF[0], 0.05, L.dF[1]); this.spots.emptyDishW = V(L.dE[0], 0.05, L.dE[1]);
    const lf = makeLeaf(5 + Math.floor(Math.random() * 1000), 0.17, 0.21);
    this.leafSeedBase = 5;
    this.addFood(makeCarrot(0.42, 0.028), dishF, V(-0.2, 0.045, -0.06), Math.PI / 2 - 0.12, Math.PI / 2 - 0.1);
    this.addFood(makeCarrot(0.4, 0.027), dishF, V(-0.21, 0.065, 0.05), Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);
    this.addFood(lf, dishF, V(0.02, 0.05, 0.14), Math.PI + 0.5, Math.PI / 2 - 0.12);
    // carrots are long; shift along their axis so they rest across the dish
    for (const f of this.foods) if (f.type === 'carrot') { f.home.pos.add(V(0.0, 0, 0)); }
    this.animal = new Rabbit();
    this.animal.setRoom(this);
    sc.add(this.animal.root);
    this.animalSize = [0.4, 0.75, 0.55];
    this.boxPoints(bx, 0.15, bz, bw / 2 + 0.02, 0.15, 0.56);
    this.boxPoints((L.hop[0][0] + L.hop[2][0]) / 2, 0.3, L.hop[0][1], (L.hop[2][0] - L.hop[0][0]) / 2 + 0.4, 0.3, 0.3); // hop floor
    this.boxPoints(L.home[0], 0.4, L.home[1], 0.4, 0.4, 0.55);
    this.boxPoints(L.dF[0], 0.05, L.dF[1], 0.28, 0.05, 0.28);
    this.boxPoints(L.dE[0], 0.05, L.dE[1], 0.25, 0.05, 0.25);
    this.camCfg = { pitchL: 0.2, pitchP: 0.48, fovL: 36, fovP: 48, ty: 0.0 };
  }
  makeStraw(n, w, h, d, y0, seed, color, len) {
    const g = new THREE.CylinderGeometry(0.0045, 0.0045, len, 5, 1, true);
    const tx = strawTex();
    const mat = new THREE.MeshStandardMaterial({ map: tx, color, roughness: 0.55, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(g, mat, n);
    const r = rng(seed);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const u = (r() - 0.5), v = (r() - 0.5);
      const mound = h * (1 - Math.min(1, (u * u * 4 + v * v * 4))) ;
      p.set(u * w, y0 + 0.01 + r() * Math.max(0.01, mound + h * 0.3), v * d);
      e.set(Math.PI / 2 + (r() - 0.5) * 0.5, r() * Math.PI * 2, 0, 'YXZ');
      q.setFromEuler(e); const k = 0.6 + r() * 0.8; s.set(1, k, 1);
      m.compose(p, q, s); im.setMatrixAt(i, m);
      const tone = 0.8 + r() * 0.35; col.setRGB(tone, tone * (0.95 + r() * 0.08), tone * (0.85 + r() * 0.2));
      im.setColorAt(i, col);
    }
    im.castShadow = true; im.receiveShadow = true;
    return im;
  }
  updateEnv(dt) {
    // gentle leaf sway: dapples drift
    const t = this.time;
    this.spot.position.x = 1.4 + Math.sin(t * 0.35) * 0.12 + Math.sin(t * 1.1) * 0.03;
    this.spot.position.z = 2.2 + Math.cos(t * 0.27) * 0.1;
  }
}

// ---------------------------------------------------------------- Penguin
export class PenguinRoom extends Room {
  constructor(env, portrait) {
    super('penguin', env, portrait);
    const P = this.portrait;
    const L = P ? { hill: [0.5, -1.35, 0.72, 0.5], pool: [0.62, 0.52, 0.44], slab: [-0.7, -0.72, 0.82], home: [-0.2, 0.08], dF: [-0.62, 0.9], dE: [0.02, 1.15] }
      : { hill: [1.05, -0.78, 0.85, 0.55], pool: [1.0, 0.62, 0.58], slab: [-1.0, -0.7, 1.0], home: [-0.25, 0.1], dF: [-0.98, 0.72], dE: [-0.25, 0.98] };
    this.L = L;
    const sc = this.scene;
    sc.background = new THREE.Color(0xc9d6e0);
    sc.fog = new THREE.Fog(0xc9d6e0, 7, 14);
    this.addSun(V(-1.8, 4.2, 2.4), 0xfff2e2, 2.0, 2.6);
    const fill = new THREE.HemisphereLight(0xdcebff, 0x8a96a2, 0.6); sc.add(fill);
    this.hill = { x: L.hill[0], z: L.hill[1], R: L.hill[2], H: L.hill[3] };
    this.pool = { x: L.pool[0], z: L.pool[1], R: L.pool[2] };
    this.slab = { x: L.slab[0], z: L.slab[1], s: L.slab[2] };
    // ground (snow + pebbles) with pool depression
    const G = new THREE.PlaneGeometry(7, 7, 150, 150);
    G.translate(0, -1.0, 0);
    G.rotateX(-Math.PI / 2);
    const pa = G.attributes.position; const cols = new Float32Array(pa.count * 3);
    const nzT = noiseTex(61, [178, 186, 196], [236, 240, 244], { scale: 10, normalStrength: 3 });
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), z = pa.getZ(i);
      const y = this.baseGround(x, z);
      pa.setY(i, y);
      const dp = Math.hypot(x - this.pool.x, z - this.pool.z) / this.pool.R;
      const wet = smooth((1.25 - dp) / 0.3);
      const c = new THREE.Color().setRGB(lerp(0.95, 0.45, wet), lerp(0.96, 0.52, wet), lerp(0.98, 0.56, wet), THREE.SRGBColorSpace);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    G.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    G.computeVertexNormals();
    const gm = nzT.map.clone(); gm.repeat.set(4, 3); gm.needsUpdate = true;
    const gn = nzT.normalMap.clone(); gn.repeat.set(4, 3); gn.needsUpdate = true;
    const ground = new THREE.Mesh(G, new THREE.MeshStandardMaterial({ map: gm, normalMap: gn, vertexColors: true, roughness: 0.85 }));
    ground.receiveShadow = true; sc.add(ground);
    // back: rocky wall
    const rockT = noiseTex(71, [92, 96, 102], [160, 164, 170], { scale: 6, contrast: 1.4, normalStrength: 5 });
    const rockMat = new THREE.MeshStandardMaterial({ map: rockT.map, normalMap: rockT.normalMap, roughness: 0.9 });
    const r = rng(19);
    const rocks = [];
    for (let i = 0; i < 16; i++) {
      const x = -2.6 + i * 0.36 + (r() - 0.5) * 0.2;
      rocks.push(this.rock(rockMat, x, -1.9 - r() * 0.3, 0.5 + r() * 0.6, r));
    }
    // a few small grey rocks around
    const small = [[-1.75, 0.6, 0.18], [-1.9, -0.2, 0.25], [1.95, 0.0, 0.22], [1.85, 1.0, 0.16], [0.1, -1.3, 0.2], [-0.4, 1.25, 0.1], [1.65, 0.58, 0.12], [0.35, 0.95, 0.09], [0.38, 0.3, 0.1]];
    const keep = (x, z, s) => {
      const near = (a, b, d) => Math.hypot(x - a, z - b) < d + s;
      return !(near(this.pool.x, this.pool.z, this.pool.R + 0.12) || near(this.hill.x, this.hill.z, this.hill.R) || near(this.slab.x, this.slab.z, 0.65 * this.slab.s) || near(L.home[0], L.home[1], 0.45) || near(L.dF[0], L.dF[1], 0.35) || near(L.dE[0], L.dE[1], 0.3));
    };
    for (const [x, z, s] of small) if (keep(x, z, s)) this.rock(rockMat, x, z, s, r);
    // back ice wall/sky gradient plane
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(16, 7), new THREE.ShaderMaterial({ depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec2 vUv; void main(){ vec3 a = vec3(0.93,0.95,0.97); vec3 b = vec3(0.55,0.72,0.88); gl_FragColor = vec4(mix(a, b, smoothstep(0.25, 0.9, vUv.y)), 1.0); }' }));
    sky.position.set(0, 3.2, -3.4); sc.add(sky);
    // ice hill
    const iceT = noiseTex(81, [200, 220, 236], [244, 250, 255], { scale: 8, normalStrength: 2 });
    const hg = new THREE.SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    const hp = hg.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i), z = hp.getZ(i);
      const rr = Math.hypot(x, z);
      const X0 = x * this.hill.R, Z0 = z * this.hill.R;
      const yy = this.hillY(X0 + this.hill.x, Z0 + this.hill.z);
      const lump = 1 + 0.06 * Math.sin(X0 * 9 + 1) * Math.sin(Z0 * 7) + 0.04 * Math.sin(X0 * 17 + Z0 * 13);
      hp.setXYZ(i, X0 * lump, yy + 0.002 + 0.015 * Math.sin(X0 * 11) * Math.cos(Z0 * 9) * (yy > 0.02 ? 1 : 0), Z0 * lump);
    }
    hg.computeVertexNormals();
    { const cc = new Float32Array(hp.count * 3); for (let i = 0; i < hp.count; i++) { const t = clamp(hp.getY(i) / this.hill.H, 0, 1); const c = new THREE.Color().setRGB(lerp(0.62, 0.97, t), lerp(0.8, 0.99, t), lerp(0.95, 1.0, t), THREE.SRGBColorSpace); cc[i * 3] = c.r; cc[i * 3 + 1] = c.g; cc[i * 3 + 2] = c.b; } hg.setAttribute('color', new THREE.BufferAttribute(cc, 3)); }
    const im = iceT.map.clone(); im.repeat.set(2, 2); im.needsUpdate = true;
    const ice = new THREE.Mesh(hg, new THREE.MeshPhysicalMaterial({ map: im, vertexColors: true, normalMap: iceT.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), color: 0xf2f8ff, roughness: 0.22, iridescence: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.3, sheenColor: new THREE.Color(0.7, 0.85, 1) }));
    ice.position.set(this.hill.x, 0, this.hill.z); ice.castShadow = true; ice.receiveShadow = true; sc.add(ice);
    // pool water
    this.water = this.makeWater();
    // dry rest spot: smooth flat stone with a few pebbles
    const slabG = new THREE.CylinderGeometry(0.55, 0.6, 0.08, 40, 2);
    const sp = slabG.attributes.position; for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), z = sp.getZ(i); sp.setX(i, x * 1.15); sp.setY(i, sp.getY(i) + Math.sin(x * 7) * Math.cos(z * 5) * 0.008); }
    slabG.computeVertexNormals();
    const slabT = noiseTex(91, [150, 146, 140], [190, 186, 180], { scale: 5, normalStrength: 2 });
    const slab = new THREE.Mesh(slabG, new THREE.MeshStandardMaterial({ map: slabT.map, normalMap: slabT.normalMap, roughness: 0.75 }));
    slab.position.set(this.slab.x, 0.04, this.slab.z); slab.scale.set(this.slab.s, 1, this.slab.s); slab.receiveShadow = true; slab.castShadow = true; sc.add(slab);
    this.slabTop = 0.08;
    this.spots = {
      home: L.home, bed: [this.slab.x, this.slab.z - 0.02], bedYaw: 0.5,
      hillPath: [[this.hill.x - this.hill.R * 0.95, this.hill.z + this.hill.R * 0.3], [this.hill.x - this.hill.R * 0.5, this.hill.z - this.hill.R * 0.2], [this.hill.x - 0.05, this.hill.z - 0.08]],
      slideYaw: Math.atan2(this.pool.x - this.hill.x, this.pool.z - this.hill.z), slidePath: [this.pool.x + 0.05, this.pool.z + 0.05], shore: [this.pool.x - this.pool.R - 0.2, this.pool.z - 0.12],
    };
    // dishes
    const dishF = makeDish(0.27, 0.08, 0xf2f5f7, 0x9fc4d8); dishF.position.set(L.dF[0], 0, L.dF[1]); sc.add(dishF);
    const dishE = makeDish(0.23, 0.07, 0xe8eef2, 0xc9d8e2); dishE.position.set(L.dE[0], 0, L.dE[1]); sc.add(dishE);
    this.spots.foodDishW = V(L.dF[0], 0.05, L.dF[1]); this.spots.emptyDishW = V(L.dE[0], 0.05, L.dE[1]);
    this.addFood(makeFish(0.3), dishF, V(-0.13, 0.055, -0.04), 0.4, 0);
    this.addFood(makeFish(0.28), dishF, V(-0.1, 0.075, 0.08), -0.2, 0.15);
    this.addFood(makeShrimp(0.13), dishF, V(0.08, 0.06, -0.06), 1.2, Math.PI / 2);
    // splash particles
    this.splashP = this.makeSplash();
    this.animal = new Penguin();
    this.animal.setRoom(this);
    sc.add(this.animal.root);
    this.animalSize = [0.4, 1.05, 0.4];
    this.groundY = (x, z) => this.walkY(x, z);
    this.animal.groundFn = this.groundY;
    this.boxPoints(this.hill.x, 0.3, this.hill.z, this.hill.R, 0.3, this.hill.R * 0.8);
    this.boxPoints(this.pool.x, 0.0, this.pool.z, this.pool.R, 0.02, this.pool.R);
    this.boxPoints(this.slab.x, 0.2, this.slab.z, 0.6 * this.slab.s, 0.2, 0.55 * this.slab.s);
    this.boxPoints(L.home[0], 0.5, L.home[1], 0.35, 0.55, 0.35);
    this.boxPoints(L.dF[0], 0.05, L.dF[1], 0.27, 0.05, 0.27);
    this.boxPoints(L.dE[0], 0.05, L.dE[1], 0.23, 0.05, 0.23);
    this.camCfg = { pitchL: 0.22, pitchP: 0.48, fovL: 36, fovP: 48, ty: 0.0 };
  }
  baseGround(x, z) {
    const dp = Math.hypot(x - this.pool.x, z - this.pool.z) / this.pool.R;
    const dip = dp < 1.15 ? -0.11 * smooth((1.15 - dp) / 0.4) : 0;
    return dip + 0.01 * Math.sin(x * 3.1) * Math.cos(z * 2.3);
  }
  hillY(x, z) {
    const d = Math.hypot(x - this.hill.x, z - this.hill.z) / this.hill.R;
    if (d >= 1) return 0;
    return this.hill.H * Math.pow(1 - d * d, 1.4);
  }
  walkY(x, z) {
    const g = this.baseGround(x, z);
    const h = this.hillY(x, z);
    const dp = Math.hypot(x - this.pool.x, z - this.pool.z) / this.pool.R;
    let y = Math.max(g, h);
    if (dp < 1) y = Math.max(y, -0.07); // float/wade in shallow water
    const ds = Math.hypot((x - this.slab.x) / 1.15, z - this.slab.z) / (0.55 * this.slab.s);
    if (ds < 1) y = Math.max(y, this.slabTop);
    return y;
  }
  rock(mat, x, z, s, r) {
    let g = new THREE.IcosahedronGeometry(1, 4);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g);
    const pa = g.attributes.position;
    const ph = [r() * 9, r() * 9, r() * 9];
    for (let i = 0; i < pa.count; i++) {
      const v = new THREE.Vector3(pa.getX(i), pa.getY(i), pa.getZ(i));
      const n = 1 + 0.18 * Math.sin(v.x * 3 + ph[0]) * Math.sin(v.y * 4 + ph[1]) + 0.1 * Math.sin(v.z * 7 + ph[2]) + 0.05 * Math.sin(v.x * 13 + v.z * 11);
      v.multiplyScalar(n);
      pa.setXYZ(i, v.x * s * 1.2, Math.max(-0.2, v.y) * s * 0.7, v.z * s);
    }
    g.computeVertexNormals();
    // planar-ish uv for the rock texture
    const uv = new Float32Array(pa.count * 2);
    for (let i = 0; i < pa.count; i++) { uv[i * 2] = (pa.getX(i) + pa.getZ(i)) * 1.2; uv[i * 2 + 1] = pa.getY(i) * 1.6; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, mat); m.position.set(x, 0, z); m.rotation.y = r() * 6; m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }
  makeWater() {
    const P = this.pool;
    const g = new THREE.PlaneGeometry(P.R * 2.3, P.R * 2.3, 72, 72); g.rotateX(-Math.PI / 2);
    const u = {
      uTime: { value: 0 }, uRip: { value: [new THREE.Vector4(0, 0, -99, 0), new THREE.Vector4(0, 0, -99, 0), new THREE.Vector4(0, 0, -99, 0), new THREE.Vector4(0, 0, -99, 0)] },
      uR: { value: P.R * 1.02 }, uN: { value: waterNormalTex() }, uSun: { value: new THREE.Vector3(-1.8, 4.2, 2.4).normalize() },
      uDeep: { value: new THREE.Color(0x2d5f6e) }, uShallow: { value: new THREE.Color(0x7fb3bd) }, uSky: { value: new THREE.Color(0xe4eef5) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float uTime; uniform vec4 uRip[4];
        varying vec3 vW; varying vec3 vN; varying vec2 vL;
        float H(vec2 p) {
          float h = 0.004 * sin(p.x * 9.0 + uTime * 1.3) + 0.003 * sin(p.y * 11.0 - uTime * 1.1) + 0.002 * sin((p.x + p.y) * 17.0 + uTime * 2.0);
          for (int i = 0; i < 4; i++) {
            float age = uTime - uRip[i].z;
            if (age < 0.0 || age > 4.0) continue;
            float d = length(p - uRip[i].xy);
            float front = age * 0.55;
            h += uRip[i].w * 0.03 * sin((d - front) * 28.0) * exp(-age * 1.1) * exp(-pow(d - front, 2.0) * 22.0);
          }
          return h;
        }
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vec2 p = w.xz;
          float h = H(p);
          float e = 0.01;
          float hx = H(p + vec2(e, 0.0)) - h, hz = H(p + vec2(0.0, e)) - h;
          vN = normalize(vec3(-hx / e, 1.0, -hz / e));
          w.y += h; vW = w.xyz; vL = position.xz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float uTime; uniform float uR; uniform sampler2D uN; uniform vec3 uSun; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky;
        varying vec3 vW; varying vec3 vN; varying vec2 vL;
        void main() {
          float r = length(vL);
          if (r > uR) discard;
          vec3 n1 = texture2D(uN, vW.xz * 1.3 + vec2(uTime * 0.03, uTime * 0.02)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uN, vW.xz * 2.1 - vec2(uTime * 0.025, -uTime * 0.03)).xyz * 2.0 - 1.0;
          vec3 N = normalize(vN + vec3(n1.x + n2.x, 0.0, n1.y + n2.y) * 0.12);
          vec3 V = normalize(cameraPosition - vW);
          float fr = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
          float depthK = smoothstep(uR, uR * 0.2, r);
          vec3 base = mix(uShallow, uDeep, depthK * 0.8);
          vec3 R = reflect(-V, N);
          vec3 refl = mix(uSky * 0.85, uSky * 1.05, clamp(R.y, 0.0, 1.0));
          float spec = pow(max(dot(R, uSun), 0.0), 220.0) * 2.5;
          vec3 col = mix(base, refl, fr) + spec * vec3(1.0, 0.96, 0.9);
          float edge = smoothstep(uR, uR - 0.08, r);
          gl_FragColor = vec4(col, mix(0.55, 0.88, fr) * edge + 0.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(g, mat);
    m.position.set(P.x, -0.035, P.z);
    m.renderOrder = 2;
    this.scene.add(m);
    this.ripIdx = 0;
    return { mesh: m, u };
  }
  ripple(x, z, s = 1) {
    const r = this.water.u.uRip.value[this.ripIdx % 4]; this.ripIdx++;
    r.set(x, z, this.time, s);
  }
  makeSplash() {
    const N = 90;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ size: 0.05, map: softDotTex('rgba(255,255,255,1)'), transparent: true, depthWrite: false, color: 0xe8f6ff, opacity: 0.9 });
    const pts = new THREE.Points(g, mat); pts.visible = false; pts.frustumCulled = false;
    this.scene.add(pts);
    return { pts, vel: new Float32Array(N * 3), life: 0, N };
  }
  splash(x, z) {
    const s = this.splashP; const p = s.pts.geometry.attributes.position.array;
    const r = rng((this.time * 1000) | 0);
    for (let i = 0; i < s.N; i++) {
      const a = r() * Math.PI * 2, sp = 0.3 + r() * 0.9;
      p[i * 3] = x + Math.cos(a) * 0.15; p[i * 3 + 1] = 0.0; p[i * 3 + 2] = z + Math.sin(a) * 0.15;
      s.vel[i * 3] = Math.cos(a) * sp * 0.6; s.vel[i * 3 + 1] = 1.2 + r() * 1.6; s.vel[i * 3 + 2] = Math.sin(a) * sp * 0.6;
    }
    s.life = 1.4; s.pts.visible = true; s.pts.material.opacity = 0.9;
    this.ripple(x, z, 1.2);
    setTimeout(() => this.ripple(x + 0.1, z - 0.05, 0.7), 250);
  }
  updateEnv(dt) {
    this.water.u.uTime.value = this.time;
    const s = this.splashP;
    if (s.life > 0) {
      s.life -= dt;
      const p = s.pts.geometry.attributes.position.array;
      for (let i = 0; i < s.N; i++) {
        s.vel[i * 3 + 1] -= 5.5 * dt;
        p[i * 3] += s.vel[i * 3] * dt; p[i * 3 + 1] += s.vel[i * 3 + 1] * dt; p[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
        if (p[i * 3 + 1] < -0.03) { p[i * 3 + 1] = -0.03; s.vel[i * 3] *= 0.5; s.vel[i * 3 + 2] *= 0.5; s.vel[i * 3 + 1] = 0; }
      }
      s.pts.geometry.attributes.position.needsUpdate = true;
      s.pts.material.opacity = Math.min(0.9, s.life * 1.5);
      if (s.life <= 0) s.pts.visible = false;
    }
    // occasional idle ripple where the penguin wades
    const a = this.animal.root.position;
    if (Math.hypot(a.x - this.pool.x, a.z - this.pool.z) < this.pool.R && this.animal.speed > 0.01 && Math.random() < dt * 3) this.ripple(a.x, a.z, 0.4);
  }
}

// camera framing: returns {pos, target, fov}
export function fitCamera(points, aspect, cfg, margin = 0.92, alignBottom = 0) {
  const port = clamp((1.15 - aspect) / 0.6, 0, 1);
  const pitch = lerp(cfg.pitchL, cfg.pitchP, port);
  const fov = lerp(cfg.fovL, cfg.fovP, port);
  const f = V(0, -Math.sin(pitch), -Math.cos(pitch));
  const u = V(0, Math.cos(pitch), -Math.sin(pitch));
  const r = V(1, 0, 0);
  const T = V(0, 0, 0);
  for (const p of points) T.add(p); T.multiplyScalar(1 / points.length);
  const tanV = Math.tan(fov * Math.PI / 360) * margin, tanH = tanV * aspect;
  let D = 3;
  const rel = V();
  for (let it = 0; it < 4; it++) {
    D = 0;
    for (const p of points) {
      rel.subVectors(p, T);
      const x = rel.dot(r), y = rel.dot(u), z = rel.dot(f);
      D = Math.max(D, Math.abs(x) / tanH - z, Math.abs(y) / tanV - z);
    }
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (const p of points) {
      rel.subVectors(p, T);
      const depth = D + rel.dot(f);
      const sx = rel.dot(r) / (depth * tanH), sy = rel.dot(u) / (depth * tanV);
      mnx = Math.min(mnx, sx); mxx = Math.max(mxx, sx); mny = Math.min(mny, sy); mxy = Math.max(mxy, sy);
    }
    T.addScaledVector(r, (mnx + mxx) / 2 * tanH * D * 0.9).addScaledVector(u, (mny + mxy) / 2 * tanV * D * 0.9);
    if (it === 3 && alignBottom > 0) {
      // push content toward the bottom of a tall frame (more back wall above, no void below)
      const spare = Math.max(0, 1 - (mxy - mny) / 2);
      T.addScaledVector(u, spare * alignBottom * tanV * D);
    }
  }
  const pos = T.clone().addScaledVector(f, -D);
  return { pos, target: T, fov };
}
