// Finale: three animals asleep together on one fluffy blanket under a warm lamp
import * as THREE from 'three';
import { fleeceTex, woodTex, starTex, noiseTex } from './textures.js';
import { Hamster } from './hamster.js';
import { Rabbit } from './rabbit.js';
import { Penguin } from './penguin.js';
import { rng, smooth, lerp, easeInOut } from './util.js';

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
    const W = 8, H = 4, wx = 0.35, wy = 1.3, ww = 1.5, wh = 0.95, wz = -1.5;
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
    const N = 70; const r = rng(5);
    const sp = new Float32Array(N * 3), ph = new Float32Array(N), sz = new Float32Array(N);
    for (let i = 0; i < N; i++) { sp[i * 3] = wx + (r() - 0.5) * 2.4; sp[i * 3 + 1] = wy + (r() - 0.5) * 1.6; sp[i * 3 + 2] = wz - 0.5; ph[i] = r() * 6.28; sz[i] = 0.4 + r() * r() * 1.4; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('ph', new THREE.BufferAttribute(ph, 1)); sg.setAttribute('sz', new THREE.BufferAttribute(sz, 1));
    this.starU = { uTime: { value: 0 }, uTex: { value: starTex() }, uScale: { value: 300 } };
    const stars = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.starU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float ph; attribute float sz; uniform float uTime; uniform float uScale; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); float tw = 0.55 + 0.45 * sin(uTime * (1.2 + fract(ph*3.7)*1.8) + ph); vA = tw; gl_PointSize = uScale * 0.05 * sz * (0.7 + 0.3*tw) / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D uTex; varying float vA; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(t.rgb * vec3(1.0,0.95,0.8), t.a * vA); }',
    }));
    stars.frustumCulled = false;
    sc.add(stars);
    // a soft moon glow
    const moon = new THREE.Mesh(new THREE.CircleGeometry(0.09, 24), new THREE.MeshBasicMaterial({ color: 0xfff3d0 }));
    moon.position.set(wx + 0.5, wy + 0.3, wz - 0.55); sc.add(moon);
    // lamp
    const lamp = new THREE.Group(); lamp.position.set(-1.3, 0, -1.05);
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a50, roughness: 0.35, metalness: 0.8 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.05, 32), brass); base.position.y = 0.025; base.castShadow = true; lamp.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.15, 12), brass); pole.position.y = 0.6; pole.castShadow = true; lamp.add(pole);
    const shadeG = new THREE.CylinderGeometry(0.2, 0.34, 0.36, 40, 1, true);
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf7e2bf, emissive: 0xffb860, emissiveIntensity: 0.9, side: THREE.DoubleSide, roughness: 0.9, transparent: true, opacity: 0.96 });
    const shade = new THREE.Mesh(shadeG, shadeMat); shade.position.y = 1.2; lamp.add(shade);
    const bulb = new THREE.PointLight(0xffb469, 2.6, 6, 1.6); bulb.position.y = 1.12; lamp.add(bulb);
    sc.add(lamp);
    const key = new THREE.SpotLight(0xffc07a, 26, 8, 0.75, 0.8, 1.5);
    key.position.set(-1.2, 1.25, -0.85); key.target.position.set(0.15, 0, 0.1);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03; key.shadow.radius = 5;
    sc.add(key, key.target);
    const moonL = new THREE.DirectionalLight(0x8aa0d8, 0.35); moonL.position.set(0.5, 2.5, -3); sc.add(moonL);
    const amb = new THREE.HemisphereLight(0x8a7464, 0x3a2a1e, 0.7); sc.add(amb);
    // blanket: one fluffy piece with soft folds (no partitions)
    const bt = fleeceTex([242, 222, 212]);
    const bm = bt.map.clone(); bm.repeat.set(5, 4); bm.needsUpdate = true;
    const bn = bt.normalMap.clone(); bn.repeat.set(5, 4); bn.needsUpdate = true;
    const BG = new THREE.PlaneGeometry(3.0, 2.3, 120, 92); BG.rotateX(-Math.PI / 2);
    const pa = BG.attributes.position;
    this.blanketY = (x, z) => {
      const edge = Math.max(Math.abs(x) / 1.5, Math.abs(z) / 1.15);
      let y = 0.06 + 0.02 * Math.sin(x * 4.1 + 0.5) * Math.cos(z * 3.3) + 0.015 * Math.sin(x * 9 + z * 6);
      // soft ridges / folds
      y += 0.05 * Math.exp(-Math.pow((x + z * 0.6 - 0.95) / 0.12, 2));
      y += 0.04 * Math.exp(-Math.pow((x * 0.4 - z + 0.75) / 0.1, 2));
      y += 0.05 * Math.exp(-Math.pow((x * 0.8 + z + 0.9) / 0.14, 2)) * smooth((x + 0.2) / 0.5);
      // edges drape to the floor
      y *= 1 - smooth((edge - 0.86) / 0.14) * 0.85;
      return y;
    };
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), z = pa.getZ(i); pa.setY(i, this.blanketY(x, z)); }
    BG.computeVertexNormals();
    const blanket = new THREE.Mesh(BG, new THREE.MeshPhysicalMaterial({ map: bm, normalMap: bn, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.95, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(1, 0.92, 0.85), side: THREE.DoubleSide }));
    blanket.receiveShadow = true; blanket.castShadow = true; blanket.position.set(0.05, 0, 0.1); sc.add(blanket);
    // animals asleep, snuggled together
    this.rabbit = new Rabbit({ shells: 5 });
    this.rabbit.floorY = 0.06;
    this.rabbit.sleepNow([0.12, 0.04, -0.32], -1.2);
    this.hamster = new Hamster({ shells: 5 });
    this.hamster.sleepNow([-0.42, 0.07, 0.06], -0.35);
    this.hamster.root.scale.setScalar(0.6);
    this.penguin = new Penguin({ shells: 5 });
    this.penguin.sleepNow([1.08, 0.06, -0.42], -0.6);
    this.penguin.root.scale.setScalar(0.74);
    this.penguin.breathPeriod = 2.0;
    for (const a of [this.rabbit, this.hamster, this.penguin]) sc.add(a.root);
    this.animals = [this.rabbit, this.hamster, this.penguin];
    this.camT = 0;
  }
  start() { this.camT = 0; }
  fit(aspect) {
    const port = Math.max(0, Math.min(1, (1.15 - aspect) / 0.6));
    this.camera.fov = lerp(40, 56, port);
    this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    const k = easeInOut(Math.min(1, this.camT / 2.2));
    const near = lerp(1.9, 2.4, port), far = lerp(3.0, 3.5, port);
    const d = lerp(near, far, k);
    const tgt = new THREE.Vector3(lerp(0.25, 0.35, k), lerp(0.2, 0.45, k) + port * 0.2, lerp(0.0, -0.3, k));
    const dir = new THREE.Vector3(0.18, lerp(0.62, 0.42, k), 1).normalize();
    this.camera.position.copy(tgt).addScaledVector(dir, d);
    if (window.__top) { this.camera.position.set(0.1, 3.2, 0.05); this.camera.up.set(0, 0, -1); }
    this.camera.lookAt(tgt);
  }
  update(dt) {
    this.time += dt; this.camT += dt;
    this.starU.uTime.value = this.time;
    for (const a of this.animals) a.update(dt);
  }
}
