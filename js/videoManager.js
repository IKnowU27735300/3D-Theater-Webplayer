import * as THREE from 'three';
import { fmtTime, showErr } from './utils.js';
import { updateScreenMasking, updateSubtitles } from './sceneBuilder.js';

export const video = document.getElementById('cinema-video');
video.volume = 1.0;
export const videoTexture = new THREE.VideoTexture(video);
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;
videoTexture.colorSpace = THREE.SRGBColorSpace;


export const vrfc = 'requestVideoFrameCallback' in video;
export function scheduleVRFC() {
  video.requestVideoFrameCallback(() => {
    videoTexture.needsUpdate = true;
    if (!video.paused && !video.ended) scheduleVRFC();
  });
}

// Screen Wake Lock API to prevent laptop screen from sleeping while watching a movie
let wakeLock = null;
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.error('WakeLock Error:', err);
    }
  }
}
function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release();
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !video.paused) {
    requestWakeLock();
  }
});

video.addEventListener('play', () => { 
  requestWakeLock();
  if (vrfc) scheduleVRFC(); 
});

video.addEventListener('pause', () => {
  releaseWakeLock();
});

export const state = { hasVideo: false };
let lastVT = -1;

export function updateVideo() {
  if (!vrfc && !video.paused && video.currentTime !== lastVT) {
    videoTexture.needsUpdate = true;
    lastVT = video.currentTime;
  }
  
  // Read active subtitle cues for the 3D Subtitle Mesh
  let subText = '';
  if (video.textTracks && video.textTracks.length > 0) {
    const activeCues = video.textTracks[0].activeCues;
    if (activeCues && activeCues.length > 0) {
      subText = activeCues[0].text;
    }
  }
  updateSubtitles(subText);
}

const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = 16;
sampleCanvas.height = 16;
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

const targetColor = new THREE.Color(0,0,0);
const currentColor = new THREE.Color(0,0,0);
let targetIntensity = 0;
let currentIntensity = 0;

let lastGlowTime = 0;

export function updateScreenGlow(lights) {
  if (!state.hasVideo || video.paused || video.ended || !lights) return;

  const glowLight = lights.screenGlow || lights;
  const floorBounce = lights.floorBounce;
  const lensGlow = lights.lensGlow;
  const beam = lights.beam;

  const now = performance.now();
  if (now - lastGlowTime > 80) { // ~12 fps sampling for smoother reaction
    lastGlowTime = now;
    sampleCtx.drawImage(video, 0, 0, 16, 16);
    const frame = sampleCtx.getImageData(0, 0, 16, 16).data;
    
    let r=0, g=0, b=0;
    for(let i=0; i<frame.length; i+=4) {
      r += frame[i];
      g += frame[i+1];
      b += frame[i+2];
    }
    const count = frame.length / 4;
  
    targetColor.setRGB(r/255/count, g/255/count, b/255/count, THREE.SRGBColorSpace);

    const luminance = 0.2126 * targetColor.r + 0.7152 * targetColor.g + 0.0722 * targetColor.b;
    const hsl = {h: 0, s: 0, l: 0};
    targetColor.getHSL(hsl);
    
    targetColor.setHSL(hsl.h, Math.min(1.0, hsl.s * 1.45), 0.5);
    targetIntensity = luminance * 22.0;
  }

  currentColor.lerp(targetColor, 0.08); // Smooth color transition
  currentIntensity += (targetIntensity - currentIntensity) * 0.08;

  if (glowLight) {
    glowLight.color.copy(currentColor);
    glowLight.intensity = currentIntensity;
  }

  if (floorBounce) {
    floorBounce.color.copy(currentColor);
    floorBounce.intensity = currentIntensity * 0.35;
  }

  if (lensGlow) {
    lensGlow.color.copy(currentColor);
  }

  if (beam && beam.material) {
    beam.material.color.lerp(currentColor, 0.05);
  }
}

export function loadVideoUrl(url, filename, onLoaded) {
  if (video.src && video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
  // Remote URLs must be CORS-enabled (WebGL textures cannot use a tainted canvas).
  // blob: URLs from a local file picker are already same-origin, so leave them alone.
  if (/^https?:/i.test(url)) video.crossOrigin = 'anonymous';
  else video.removeAttribute('crossOrigin');
  video.src = url;
  video.load();
  document.getElementById('hud-filename').textContent = filename;
  document.getElementById('welcome-screen').style.display = 'none';
  
  video.addEventListener('loadedmetadata', () => {
    document.getElementById('total-time').textContent = fmtTime(video.duration || 0);
    state.hasVideo = true;
    updateScreenMasking(video.videoWidth / video.videoHeight, videoTexture);
    video.play().catch(()=>{});
    if (onLoaded) onLoaded();
  }, { once: true });
  
  video.addEventListener('error', () => { 
    if (/^https?:/i.test(url)) {
      showErr('Could not load that URL. The host must send CORS headers (Access-Control-Allow-Origin) for WebGL playback.');
    } else {
      showErr('Cannot play this format.');
    }
  }, { once: true });
}

export function loadSubtitleTrack(url) {
  Array.from(video.querySelectorAll('track')).forEach(t => t.remove());
  if (url) {
    const track = document.createElement('track');
    track.src = url;
    track.kind = 'subtitles';
    track.default = true;
    
    video.appendChild(track);
    
    // Immediately set mode to 'hidden' AFTER appending so the browser parses cues
    // but does NOT render the default browser subtitle UI (we use our own 3D mesh).
    // Doing this BEFORE appendChild has no effect, so order matters here.
    if (video.textTracks && video.textTracks.length > 0) {
      video.textTracks[video.textTracks.length - 1].mode = 'hidden';
    }
    
    // Also set on load as a safety net in case the track isn't ready yet
    track.addEventListener('load', () => {
      if (video.textTracks && video.textTracks.length > 0) {
        video.textTracks[video.textTracks.length - 1].mode = 'hidden';
      }
    });
  }
}
