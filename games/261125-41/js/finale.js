// Finale: three animals asleep together on one fluffy blanket under a warm lamp
import * as THREE from 'three';
import { fleeceTex, woodTex, starTex, noiseTex } from './textures.js';
import { Hamster } from './hamster.js';
import { Rabbit } from './rabbit.js';
import { Penguin } from './penguin.js';
import { rng, smooth, lerp, easeInOut } from './util.js';
import { fitCamera } from './rooms.js';
import { softDotTex } from './textures.js';

export class Finale {
  constructor(env) {
    const sc = this.scene = new THREE.Scene();
    sc.environment = env; sc.environmentIntensity = 0.22;
    sc.background = new THREE.Color(0x1a1512);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 40);
    this.time = 0;
    // floor
    const ft = woodTex(101, [150, 100, 62], [98, 62, 36], { planks: 6 });
    const fm = ft.map.clone(); fm.repeat.set(3, 3); fm.needsUpdate = true;
    const fn = ft.normalMap.clone(); fn.repeat.set(3, 3); fn.needsUpdate = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), new THREE.MeshStandardMaterial({ map: fm, normalMap: fn, roughness: 0.7 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor);
    // wall with window
    const wallT = noiseTex(111, [200, 172, 140], [226, 204, 176], { scale: 6, normalStrength: 1.5 });
    const wallMat = new THREE.MeshStandardMaterial({ map: wallT.map, normalMap: wallT.normalMap, roughness: 0.95 });
    const W = 8, H = 4, wx = 0.45, wy = 1.02, ww = 1.5, wh = 0.8, wz = -1.15;
    const shape = new THREE.Shape(); shape.moveTo(-W / 2, 0); shape.lineTo(W / 2, 0); shape.lineTo(W / 2, H); shape.lineTo(-W / 2, H); shape.lineTo(-W / 2, 0);
    const hole = new THREE.Path(); hole.moveTo(wx - ww / 2, wy - wh / 2); hole.lineTo(wx + ww / 2, wy - wh / 2); hole.lineTo(wx + ww / 2, wy + wh / 2); hole.lineTo(wx - ww / 2, wy + wh / 2); hole.lineTo(wx - ww / 2, wy - wh / 2);
    shape.holes.push(hole);
    const wall = new THREE.Mesh(new THREE.ShapeGeometry(shape), wallMat); wall.position.z = wz; wall.receiveShadow = true; sc.add(wall);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a5d3a, roughness: 0.6 });
    const fb = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), frameMat); m.position.set(x, y, wz + 0.02); m.castShadow = true; sc.add(m); };
    fb(ww + 0.16, 0.08, wx, wy - wh / 2 - 0.04); fb(ww + 0.16, 0.08, wx, wy + wh / 2 + 0.04);
    fb(0.08, wh, wx - ww / 2 - 0.04, wy); fb(0.08, wh, wx + ww / 2 + 0.04, wy); fb(0.05, wh, wx, wy); fb(ww, 0.05, wx, wy);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.3, 0.05, 0.22), frameMat); sill.position.set(wx, wy - wh / 2 - 0.09, wz + 0.08); sc.add(sill);
    // night sky + stars
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {}, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec2 vUv; void main(){ vec3 a = vec3(0.02,0.03,0.09); vec3 b = vec3(0.09,0.12,0.26); gl_FragColor = vec4(mix(b, a, vUv.y), 1.0); }',
    });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), skyMat); sky.position.set(wx, wy, wz - 0.6); sc.add(sky);
    const N = 46; const r = rng(5);
    const sp = new Float32Array(N * 3), ph = new Float32Array(N), sz = new Float32Array(N);
    for (let i = 0; i < N; i++) { sp[i * 3] = wx + (r() - 0.5) * 1.9; sp[i * 3 + 1] = wy + (r() - 0.5) * 1.15; sp[i * 3 + 2] = wz - 0.45; ph[i] = r() * 6.28; sz[i] = 0.4 + r() * r() * 1.4; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('ph', new THREE.BufferAttribute(ph, 1)); sg.setAttribute('sz', new THREE.BufferAttribute(sz, 1));
    this.starU = { uTime: { value: 0 }, uTex: { value: starTex() }, uScale: { value: 1.0 } };
    const stars = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.starU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float ph; attribute float sz; uniform float uTime; uniform float uScale; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); float tw = 0.6 + 0.4 * sin(uTime * (1.2 + fract(ph*3.7)*1.8) + ph); vA = tw; gl_PointSize = uScale * (4.0 + 7.0 * sz) * (0.65 + 0.35 * tw); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D uTex; varying float vA; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(t.rgb * vec3(1.0,0.96,0.85) * 1.6, t.a * vA); }',
    }));
    stars.frustumCulled = false;
    sc.add(stars);
    // a soft moon glow
    const moon = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), new THREE.MeshBasicMaterial({ color: 0xfff3d0 }));
    moon.position.set(wx + 0.45, wy + 0.2, wz - 0.5); sc.add(moon);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTex('rgba(255,240,200,1)'), color: 0xfff0c8, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(0.6, 0.6, 1); glow.position.copy(moon.position).add(new THREE.Vector3(0, 0, 0.01)); sc.add(glow);
    // lamp
    const lamp = new THREE.Group(); lamp.position.set(-1.05, 0, -0.75);
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a50, roughness: 0.35, metalness: 0.8 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.05, 32), brass); base.position.y = 0.025; base.castShadow = true; lamp.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.15, 12), brass); pole.position.y = 0.6; pole.castShadow = true; lamp.add(pole);
    const shadeG = new THREE.CylinderGeometry(0.2, 0.34, 0.36, 40, 1, true);
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf7e2bf, emissive: 0xffb860, emissiveIntensity: 0.9, side: THREE.DoubleSide, roughness: 0.9, transparent: true, opacity: 0.96 });
    const shade = new THREE.Mesh(shadeG, shadeMat); shade.position.y = 1.2; lamp.add(shade);
    const bulb = new THREE.PointLight(0xffb469, 2.6, 6, 1.6); bulb.position.y = 1.12; lamp.add(bulb);
    sc.add(lamp);
    const key = new THREE.SpotLight(0xffc27e, 34, 8, 0.62, 0.85, 1.4);
    key.position.set(-0.95, 1.2, -0.55); key.target.position.set(0.35, 0.05, 0.05);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03; key.shadow.radius = 5;
    sc.add(key, key.target);
    const moonL = new THREE.DirectionalLight(0x8aa0d8, 0.35); moonL.position.set(0.5, 2.5, -3); sc.add(moonL);
    const amb = new THREE.HemisphereLight(0x7a6658, 0x2e2018, 0.5); sc.add(amb);
    // animals asleep, snuggled together (believable relative sizes)
    this.rabbit = new Rabbit({ shells: 5 });
    this.hamster = new Hamster({ shells: 5 });
    this.penguin = new Penguin({ shells: 5 });
    const portrait = window.innerWidth / window.innerHeight < 0.9;
    const P = this.place = portrait ? {
      rabbit: { pos: [0.0, -0.1], yaw: -0.64, scale: 1.0 },
      hamster: { pos: [-0.06, 0.5], yaw: -0.25, scale: 0.4 },
      penguin: { pos: [0.86, -0.42], yaw: -0.6, scale: 0.8 },
    } : {
      rabbit: { pos: [0.0, -0.1], yaw: -0.64, scale: 1.0 },
      hamster: { pos: [-0.06, 0.5], yaw: -0.25, scale: 0.4 },
      penguin: { pos: [1.12, 0.0], yaw: -0.95, scale: 0.8 },
    };
    this.rabbit.sleepNow([P.rabbit.pos[0], 0, P.rabbit.pos[1]], P.rabbit.yaw);
    this.hamster.sleepNow([P.hamster.pos[0], 0, P.hamster.pos[1]], P.hamster.yaw);
    this.penguin.sleepNow([P.penguin.pos[0], 0, P.penguin.pos[1]], P.penguin.yaw);
    this.hamster.root.scale.setScalar(P.hamster.scale);
    this.penguin.root.scale.setScalar(P.penguin.scale);
    this.hamster.now('faceUp', 1);
    this.rabbit.rollK = 0.5; this.rabbit.now('headUp', 1); this.rabbit.now('lift', -0.065);
    this.penguin.now('headSide', 1);
    this.penguin.breathPeriod = 2.0;
    this.animals = [this.rabbit, this.hamster, this.penguin];
    for (const a of this.animals) { sc.add(a.root); a.update(0.016); }
    // contact areas (body centres in world) for blanket dips + baked contact shade
    const contacts = [];
    const add = (a, bone, r, d) => { const v = a.bones[bone].getWorldPosition(new THREE.Vector3()); contacts.push({ x: v.x, z: v.z, r, d }); };
    add(this.rabbit, 'spine', 0.34, 0.05); add(this.rabbit, 'hips', 0.34, 0.05); add(this.rabbit, 'head', 0.2, 0.035);
    add(this.hamster, 'spine', 0.15, 0.018); add(this.hamster, 'hips', 0.13, 0.015);
    add(this.penguin, 'spine', 0.26, 0.045); add(this.penguin, 'hips', 0.26, 0.045); add(this.penguin, 'head', 0.16, 0.03);
    this.contacts = contacts;
    // blanket: one fluffy piece with soft folds and a rolled edge (no partitions)
    const bt = fleeceTex([242, 222, 212]);
    const bm = bt.map.clone(); bm.repeat.set(6, 5); bm.needsUpdate = true;
    const bn = bt.normalMap.clone(); bn.repeat.set(6, 5); bn.needsUpdate = true;
    const BX = 1.65, BZ = 1.25, OX = 0.35, OZ = 0.0;
    const BG = new THREE.PlaneGeometry(BX * 2, BZ * 2, 150, 120); BG.rotateX(-Math.PI / 2);
    const pa = BG.attributes.position;
    const baseY = (x, z) => {
      const lx = x - OX, lz = z - OZ;
      const edge = Math.max(Math.abs(lx) / BX, Math.abs(lz) / BZ);
      let y = 0.09 + 0.018 * Math.sin(lx * 4.1 + 0.5) * Math.cos(lz * 3.3) + 0.01 * Math.sin(lx * 9 + lz * 6);
      // soft folds radiating from the sleepers
      y += 0.06 * Math.exp(-Math.pow((lx + lz * 0.7 - 1.35) / 0.13, 2)) * Math.exp(-Math.pow(lz / 0.9, 2));
      y += 0.05 * Math.exp(-Math.pow((lx * 0.5 - lz - 0.95) / 0.11, 2));
      y += 0.05 * Math.exp(-Math.pow((lx * 0.9 + lz + 1.25) / 0.14, 2));
      y += 0.045 * Math.exp(-Math.pow((lx - lz * 0.4 + 1.25) / 0.12, 2));
      // rolled, puffy hem then drape to the floor
      y += 0.05 * Math.exp(-Math.pow((edge - 0.9) / 0.04, 2));
      y *= 1 - smooth((edge - 0.93) / 0.07) * 0.9;
      return y;
    };
    const dip = (x, z) => { let d = 0; for (const c of contacts) d += c.d * Math.exp(-((x - c.x) ** 2 + (z - c.z) ** 2) / (c.r * c.r)); return Math.min(d, 0.065); };
    this.blanketY = (x, z) => baseY(x, z) - dip(x, z);
    const cols = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i) + OX, z = pa.getZ(i) + OZ;
      pa.setY(i, this.blanketY(x, z));
      // contact shade: darker in the hollows under the animals
      let sh = 0; for (const c of contacts) sh += Math.exp(-((x - c.x) ** 2 + (z - c.z) ** 2) / (c.r * c.r * 1.3));
      const k = 1 - Math.min(0.42, sh * 0.32);
      cols[i * 3] = k; cols[i * 3 + 1] = k * 0.97; cols[i * 3 + 2] = k * 0.95;
    }
    BG.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    BG.computeVertexNormals();
    const blanket = new THREE.Mesh(BG, new THREE.MeshPhysicalMaterial({ map: bm, normalMap: bn, normalScale: new THREE.Vector2(0.45, 0.45), vertexColors: true, roughness: 0.95, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(1, 0.9, 0.82), side: THREE.DoubleSide }));
    blanket.receiveShadow = true; blanket.castShadow = true; blanket.position.set(OX, 0, OZ); sc.add(blanket);
    // settle the sleepers into the blanket (slightly sunk)
    const settle = (a, sink) => { const p = a.root.position; p.y = this.blanketY(p.x, p.z) - sink; };
    settle(this.rabbit, 0.02); settle(this.hamster, -0.025); settle(this.penguin, 0.03);
    this.rabbit.floorY = this.rabbit.root.position.y + 0.02;
    this.camT = 0;
  }
    start() { this.camT = 0; }
  fit(aspect) {
    const port = Math.max(0, Math.min(1, (1.15 - aspect) / 0.6));
    const k = easeInOut(Math.min(1, this.camT / 2.2));
    if (!this.trioPts) {
      this.trioPts = [];
      for (const a of this.animals) {
        a.root.updateMatrixWorld(true);
        const r = 0.1 * a.root.scale.x;
        for (const bn in a.bones) {
          const v = a.bones[bn].getWorldPosition(new THREE.Vector3());
          this.trioPts.push(v.clone().add(new THREE.Vector3(r, r, r)), v.clone().add(new THREE.Vector3(-r, -r, -r)));
        }
      }
    }
    // pull back gently from a close framing to one where the trio fills ~65% of the width
    const cfg = { pitchL: lerp(0.3, 0.36, k), pitchP: lerp(0.36, 0.42, k), fovL: 36, fovP: 46 };
    const margin = lerp(1.0, lerp(0.7, 0.92, port), k);
    const c = fitCamera(this.trioPts, aspect, cfg, margin);
    // keep the window with stars in view: aim a little higher once pulled back
    c.target.y += k * lerp(0.12, 0.1, port);
    c.pos.y += k * lerp(0.12, 0.1, port);
    this.camera.fov = c.fov; this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    this.camera.position.copy(c.pos);
    if (window.__fclose) { const h = this.rabbit.bones.head.getWorldPosition(new THREE.Vector3()); const d = c.pos.clone().sub(h).normalize(); this.camera.position.copy(h).addScaledVector(d, 0.7); this.camera.lookAt(h); return; }
    if (window.__top) { this.camera.position.set(0.35, 3.4, 0.05); this.camera.up.set(0, 0, -1); }
    this.camera.lookAt(c.target);
  }
  update(dt) {
    this.time += dt; this.camT += dt;
    this.starU.uTime.value = this.time;
    for (const a of this.animals) a.update(dt);
  }
}
