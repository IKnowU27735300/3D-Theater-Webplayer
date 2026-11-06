import * as THREE from 'three';
import { ROOM_W, ROOM_H, ROOM_D, SCR_W, SCR_H, SCR_Z, SCR_Y } from './config.js';

let beam;
let lensGlow;

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

