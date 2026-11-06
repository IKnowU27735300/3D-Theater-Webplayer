import * as THREE from 'three';
import { ROOM_W, ROOM_H, ROOM_D, SCR_W, SCR_H, SCR_Z, SCR_Y } from './config.js';

let beam;
let lensGlow;
let dustParticles;

export function buildBeam(scene) {
  // Volumetric projector cone
  const geo = new THREE.ConeGeometry(1.2, 28, 32, 1, true);
  const mat = new THREE.MeshBasicMaterial({ 
    color: 0xffffff, 
    transparent: true, 
    opacity: 0.018, 
    side: THREE.BackSide, 
    depthWrite: false, 
    blending: THREE.AdditiveBlending 
  });
  beam = new THREE.Mesh(geo, mat);
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(0, 10.8, SCR_Z + 16);
  scene.add(beam);

  // Physical projector housing
  const projMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.85, roughness: 0.25 });
  const proj = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 2.6), projMat);
  proj.position.set(0, 10.8, SCR_Z + 17.5);
  scene.add(proj);

  // Projector lens aperture
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 1.0, roughness: 0.05 });
  const lensGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.25, 24);
  lensGeo.rotateX(Math.PI / 2);
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.position.set(0, 10.8, SCR_Z + 16.3);
  scene.add(lens);

  // Dynamic lens glow
  lensGlow = new THREE.PointLight(0xddeeff, 0.5, 4);
  lensGlow.position.set(0, 10.8, SCR_Z + 16.1);
  scene.add(lensGlow);
}

export function buildDust(scene) {
  const count = 350;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count * 3);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const t = Math.random();
    const z = THREE.MathUtils.lerp(SCR_Z + 2, SCR_Z + 16, t);
    const coneRadius = THREE.MathUtils.lerp(11.0, 1.0, t);

    positions[i * 3]     = (Math.random() - 0.5) * coneRadius * 1.4;
    positions[i * 3 + 1] = 6.0 + (Math.random() - 0.5) * 5.0;
    positions[i * 3 + 2] = z;

    speeds[i * 3]     = (Math.random() - 0.5) * 0.002;
    speeds[i * 3 + 1] = Math.random() * 0.0015 + 0.0008;
    speeds[i * 3 + 2] = (Math.random() - 0.5) * 0.002;

    phases[i] = Math.random() * Math.PI * 2;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // Circular soft blurred particle texture
  const pCanvas = document.createElement('canvas');
  pCanvas.width = pCanvas.height = 32;
  const pCtx = pCanvas.getContext('2d');
  const grad = pCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  grad.addColorStop(0.35, 'rgba(235, 245, 255, 0.35)');
  grad.addColorStop(1, 'rgba(235, 245, 255, 0.0)');
  pCtx.fillStyle = grad;
  pCtx.fillRect(0, 0, 32, 32);
  const pTex = new THREE.CanvasTexture(pCanvas);

  const mat = new THREE.PointsMaterial({
    size: 0.16,
    map: pTex,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  dustParticles = new THREE.Points(geo, mat);
  dustParticles.userData = { speeds, phases, count };
  scene.add(dustParticles);
}

export function updateDust(t) {
  if (!dustParticles) return;
  const pos = dustParticles.geometry.attributes.position;
  const { speeds, phases, count } = dustParticles.userData;

  for (let i = 0; i < count; i++) {
    let y = pos.getY(i) + speeds[i * 3 + 1];
    let x = pos.getX(i) + Math.sin(t * 0.001 + phases[i]) * 0.002;
    let z = pos.getZ(i);

    // If drifted above beam, loop back to the bottom
    if (y > 11.5) {
      y = 1.0;
    }

    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
}

export function updateBeam(t) {
  if (beam) {
    beam.material.opacity = 0.015 + Math.sin(t * 0.0008) * 0.004;
  }
}

export function buildLighting(scene) {
  // Ambient room illumination (calibrated for ACES Filmic tone mapping)
  const ambientLight = new THREE.AmbientLight(0x0e090e, 1.2);
  scene.add(ambientLight);

  // Screen area glow (primary dynamic light, matches movie colors)
  const screenGlow = new THREE.RectAreaLight(0xffffff, 0, SCR_W, SCR_H);
  screenGlow.position.set(0, SCR_Y, SCR_Z + 0.5);
  screenGlow.lookAt(0, SCR_Y + 14, 10);
  scene.add(screenGlow);

  // Secondary soft bounce light (bounces off the stage floor & front rows)
  const floorBounce = new THREE.PointLight(0xffffff, 0, 22, 1.8);
  floorBounce.position.set(0, 1.4, SCR_Z + 3.0);
  scene.add(floorBounce);

  // Ceiling down-spots (warm house lights with realistic cone penumbra)
  const ceilSpots = [];
  [
    [-12, ROOM_H - 0.25, -2], [12, ROOM_H - 0.25, -2],
    [-12, ROOM_H - 0.25, 8],  [12, ROOM_H - 0.25, 8],
    [-12, ROOM_H - 0.25, 18], [12, ROOM_H - 0.25, 18],
    [0, ROOM_H - 0.25, 4],    [0, ROOM_H - 0.25, 14]
  ].forEach(([x, y, z]) => {
    const s = new THREE.SpotLight(0xffebd0, 0, 25, Math.PI / 6.5, 0.55);
    s.position.set(x, y, z);
    s.target.position.set(x, -0.5, z);
    scene.add(s);
    scene.add(s.target);
    ceilSpots.push(s);

    // Designer circular bezel fixture on ceiling tile
    const bezel = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.22, 16),
      new THREE.MeshStandardMaterial({ color: 0x8b6914, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide })
    );
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(x, y + 0.05, z);
    scene.add(bezel);
  });

  // Rear red exit emergency lights
  const ex = (x, z) => {
    const l = new THREE.PointLight(0xff2222, 0.6, 6);
    l.position.set(x, 1.8, z);
    scene.add(l);
  };
  ex(-ROOM_W / 2 + 1, ROOM_D / 2 - 2);
  ex(ROOM_W / 2 - 1, ROOM_D / 2 - 2);

  return { ambientLight, screenGlow, floorBounce, lensGlow, beam, ceilSpots };
}

