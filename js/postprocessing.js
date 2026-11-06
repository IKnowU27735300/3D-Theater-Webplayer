import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }      from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';

export let composer, bloomPass, cinematicPass;

const CinematicShader = {
  name: 'CinematicVignetteGrain',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.24 },
    uGrain: { value: 0.010 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      
      // Smooth photographic vignette
      vec2 uv = (vUv - 0.5) * 2.0;
      float vig = 1.0 - dot(uv, uv) * uVignette;
      color.rgb *= clamp(vig, 0.0, 1.0);

      // Subtle 35mm film grain (enhances realism and prevents dark banding)
      float noise = (fract(sin(dot(vUv * 600.0 + fract(uTime * 0.0008), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * uGrain;
      color.rgb += noise;

      gl_FragColor = color;
    }
  `
};

export function initPost(renderer, scene, camera) {
  const sz = new THREE.Vector2(window.innerWidth, window.innerHeight);
  const rt = new THREE.WebGLRenderTarget(sz.x, sz.y, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace
  });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));

  // Cinematic bloom: low threshold, gentle bloom on screen and lights
  bloomPass = new UnrealBloomPass(sz, 0.26, 0.45, 0.82);
  composer.addPass(bloomPass);

  // Cinematic vignette & analog film grain pass
  cinematicPass = new ShaderPass(CinematicShader);
  composer.addPass(cinematicPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  return { composer, bloomPass, cinematicPass };
}

export function updatePost(t) {
  if (cinematicPass) {
    cinematicPass.uniforms.uTime.value = t;
  }
}

export function resizePost(w, h) {
  if (composer) composer.setSize(w, h);
  if (bloomPass) bloomPass.resolution.set(w, h);
}

