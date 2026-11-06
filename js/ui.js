import { BASE_PITCH } from './config.js';
import { fmtTime, showErr } from './utils.js';
import { video, state, scheduleVRFC, loadVideoUrl, loadSubtitleTrack, vrfc } from './videoManager.js';
import { initAudio, resumeAudio, switchAudioTrack } from './audioManager.js';

export function initUI(deps) {
  const { camera, renderer, lights, scene } = deps;
  const canvas = renderer.domElement;
  
  // Look Controls
  const look={yaw:0,pitch:0,dragging:false,lx:0,ly:0,sens:0.0027,my:1.2,mp:0.5};
  canvas.addEventListener('mousedown',e=>{ if(e.button!==0)return; look.dragging=true; look.lx=e.clientX; look.ly=e.clientY; });
  window.addEventListener('mouseup',()=>{ look.dragging=false; });
  canvas.addEventListener('mousemove',e=>{
    if(!look.dragging)return;
    look.yaw  -=(e.clientX-look.lx)*look.sens; look.pitch-=(e.clientY-look.ly)*look.sens;
    look.yaw  =Math.max(-look.my,Math.min(look.my,look.yaw));
    look.pitch=Math.max(-look.mp,Math.min(look.mp,look.pitch));
    look.lx=e.clientX; look.ly=e.clientY;
  });
  canvas.addEventListener('touchstart',e=>{ look.dragging=true; look.lx=e.touches[0].clientX; look.ly=e.touches[0].clientY; },{passive:true});
  canvas.addEventListener('touchmove',e=>{
    if(!look.dragging)return;
    look.yaw  -=(e.touches[0].clientX-look.lx)*look.sens; look.pitch-=(e.touches[0].clientY-look.ly)*look.sens;
    look.yaw  =Math.max(-look.my,Math.min(look.my,look.yaw));
    look.pitch=Math.max(-look.mp,Math.min(look.mp,look.pitch));
    look.lx=e.touches[0].clientX; look.ly=e.touches[0].clientY;
  },{passive:true});
  canvas.addEventListener('touchend',()=>{ look.dragging=false; },{passive:true});

  let currentFov = camera.fov;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    currentFov = Math.max(20, Math.min(110, currentFov + e.deltaY * 0.05));
    camera.fov = currentFov;
    camera.updateProjectionMatrix();
  }, { passive: false });

  let seatPitchOffset = 0;
  let seatYawOffset = 0;
  deps.updateCamera = () => {
    camera.rotation.order='YXZ';
    camera.rotation.y=seatYawOffset+look.yaw;
    camera.rotation.x=BASE_PITCH+seatPitchOffset+look.pitch;
  };

  // Video Management & HUD
  const hudEl=document.getElementById('hud'); let hudTimer=null;
  function showHUD(){
    hudEl.classList.remove('hud-hidden');
    clearTimeout(hudTimer);
    hudTimer=setTimeout(()=>{ if(!video.paused) hudEl.classList.add('hud-hidden'); },3200);
  }
  document.addEventListener('mousemove',()=>{ if(state.hasVideo) showHUD(); });
  document.addEventListener('touchstart',()=>{ if(state.hasVideo) showHUD(); },{passive:true});

  function togglePlay(){ 
    if(!state.hasVideo) return; 
    initAudio(camera, scene, video);
    resumeAudio();
    if(video.paused) {
      video.play();
    } else {
      video.pause(); 
    }
  }

  video.addEventListener('play',()=>{
    document.getElementById('play-icon').style.display='none';
    document.getElementById('pause-icon').style.display='block';
    if(vrfc)scheduleVRFC();
    if(lights.screenGlow)lights.screenGlow.intensity=1.8;
  });
  video.addEventListener('pause',()=>{
    document.getElementById('play-icon').style.display='block';
    document.getElementById('pause-icon').style.display='none';
    showHUD();
    if(lights.screenGlow)lights.screenGlow.intensity=0.55;
  });
  video.addEventListener('ended',()=>{ document.getElementById('play-icon').style.display='block'; document.getElementById('pause-icon').style.display='none'; showHUD(); });
  video.addEventListener('seeking',()=>{ document.getElementById('buffering-overlay').style.display='flex'; });
  video.addEventListener('seeked', ()=>{ document.getElementById('buffering-overlay').style.display='none'; });
  video.addEventListener('waiting',()=>{ document.getElementById('buffering-overlay').style.display='flex'; });
  video.addEventListener('canplay',()=>{ document.getElementById('buffering-overlay').style.display='none'; });

  // Seek bar
  const seekBar=document.getElementById('seek-bar');
  const seekProg=document.getElementById('seek-progress');
  const seekBuf=document.getElementById('seek-buffered');
  let isSeeking=false;

  seekBar.addEventListener('mousedown',()=>{ isSeeking=true; });
  seekBar.addEventListener('touchstart',()=>{ isSeeking=true; },{passive:true});
  seekBar.addEventListener('input',()=>{
    const t=(seekBar.value/10000)*video.duration;
    document.getElementById('current-time').textContent=fmtTime(t);
    seekProg.style.width=(seekBar.value/100)+'%';
  });
  seekBar.addEventListener('change',()=>{ video.currentTime=(seekBar.value/10000)*(video.duration||0); isSeeking=false; });

  video.addEventListener('timeupdate',()=>{
    if(isSeeking||!video.duration)return;
    const pv=video.currentTime/video.duration;
    seekBar.value=(pv*10000).toFixed(0);
    seekProg.style.width=(pv*100).toFixed(3)+'%';
    document.getElementById('current-time').textContent=fmtTime(video.currentTime);
    if(video.buffered.length>0){ const be=video.buffered.end(video.buffered.length-1); seekBuf.style.width=(be/video.duration*100).toFixed(2)+'%'; }
    if(lights.screenGlow){ lights.screenGlow.intensity=1.8+Math.sin(video.currentTime*0.08)*0.15; }
  });

  const volBar=document.getElementById('volume-bar');
  volBar.addEventListener('input',()=>{ video.volume=volBar.value/100; video.muted=(volBar.value==0); updMute(); });
  function updMute(){ document.getElementById('vol-icon').style.display=video.muted?'none':'block'; document.getElementById('muted-icon').style.display=video.muted?'block':'none'; }
  function toggleMute(){ video.muted=!video.muted; if(!video.muted&&volBar.value==0){volBar.value=50;video.volume=0.5;} updMute(); }
  document.getElementById('speed-select').addEventListener('change',e=>{ video.playbackRate=parseFloat(e.target.value); });

  function toggleFS(){
    if(!document.fullscreenElement){ document.documentElement.requestFullscreen().catch(()=>{}); document.getElementById('fs-expand').style.display='none'; document.getElementById('fs-collapse').style.display='block'; }
    else { document.exitFullscreen(); document.getElementById('fs-expand').style.display='block'; document.getElementById('fs-collapse').style.display='none'; }
  }

  let lightsOn=false;
  function toggleLights() {
    lightsOn=!lightsOn;
    const targetSpot = lightsOn ? 4000.0 : 0;
    const targetAmb  = lightsOn ? 8.0 : 1.0;
    lights.ceilSpots.forEach(s=>{ s.intensity = targetSpot; });
    lights.ambientLight.intensity = targetAmb;
    document.getElementById('lights-btn').classList.toggle('active', lightsOn);
  }

  document.getElementById('play-btn').addEventListener('click',togglePlay);
  document.getElementById('seek-back-btn').addEventListener('click',()=>{ video.currentTime=Math.max(0,video.currentTime-10); });
  document.getElementById('seek-fwd-btn').addEventListener('click', ()=>{ video.currentTime=Math.min(video.duration||0,video.currentTime+10); });
  document.getElementById('mute-btn').addEventListener('click',toggleMute);
  document.getElementById('lights-btn').addEventListener('click',toggleLights);
  document.getElementById('fullscreen-btn').addEventListener('click',toggleFS);
  document.getElementById('open-btn').addEventListener('click', () => {
    const ws = document.getElementById('welcome-screen');
    ws.style.display = ws.style.display === 'none' ? 'flex' : 'none';
  });

  // Launch the OS file explorer on the movies folder so the user can drop files in.
  // Only visible when the local media server is running.
  const openFolderBtn = document.getElementById('open-folder-btn');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', () => {
      fetch('/api/open-folder', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          if (data.error) throw new Error(data.error);
          openFolderBtn.classList.add('confirmed');
          const label = openFolderBtn.querySelector('span');
          const original = label.textContent;
          label.textContent = 'Opened! Drop files in, then refresh';
          setTimeout(() => {
            openFolderBtn.classList.remove('confirmed');
            label.textContent = original;
          }, 2500);
          // Re-scan the library after a short delay so new files appear.
          setTimeout(refreshLibrary, 1500);
        })
        .catch(err => showErr('Could not open folder: ' + err.message));
    });
  }

  document.getElementById('seat-select').addEventListener('change', (e) => {
    const val = e.target.value;
    seatYawOffset = 0;
    seatPitchOffset = 0;
    look.yaw = 0; // reset manual look
    look.pitch = 0;
    if (val === 'center') {
      camera.position.set(0, 2.43, 4.66); // Row 7
    } else if (val === 'front') {
      camera.position.set(0, 0.99, -1.82); // Row 1
      seatPitchOffset = 0.31; // look up
    } else if (val === 'back') {
      camera.position.set(0, 4.11, 12.22); // Row 14
      seatPitchOffset = 0.03;
    } else if (val === 'side') {
      camera.position.set(-11.5, 2.43, 4.66); // Row 7, Seat 0
      seatYawOffset = -0.39; // look right towards center
      seatPitchOffset = 0.10;
    }
  });


  // Track Menus Toggle
  const subsBtn = document.getElementById('subs-btn');
  const tracksMenu = document.getElementById('tracks-menu');
  if(subsBtn && tracksMenu) {
    subsBtn.addEventListener('click', () => {
      tracksMenu.style.display = tracksMenu.style.display === 'flex' ? 'none' : 'flex';
    });
  }

  // Metadata Fetching (local media server only)
  let currentMovie = '';
  let hasBackend = false;
  function fetchMetadata(filename) {
    if (!hasBackend) return;
    currentMovie = filename;
    fetch(`/api/metadata/${encodeURIComponent(filename)}`)
      .then(r => r.json())
      .then(data => {
        window.audioAutoStarted = false;
        window.defaultAudioUrl = null;
        const aList = document.getElementById('audio-list');
        const sList = document.getElementById('sub-list');
        if(!aList || !sList) return;
        
        aList.innerHTML = ''; sList.innerHTML = '';
        
        if(data.audioTracks.length === 0) {
          aList.innerHTML = '<div class="track-option">Default Audio</div>';
        } else {
          const defaultUrl = `/audio/${encodeURIComponent(filename)}/${data.audioTracks[0].index}`;
          // Auto-start the default audio track immediately — the video is already playing by now
          // so the audio will start, sync via the play event listener, and play together.
          switchAudioTrack(defaultUrl);
        }
        
        data.audioTracks.forEach((t, i) => {
          const btn = document.createElement('button');
          btn.className = 'track-option' + (i === 0 ? ' active' : '');
          btn.textContent = `${t.title} (${t.language}) - ${t.codec}`;
          btn.onclick = () => { 
            Array.from(aList.children).forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            // ALWAYS use FFmpeg to transcode to ensure 5.1 support and cross-platform compatibility!
            switchAudioTrack(`/audio/${encodeURIComponent(filename)}/${t.index}`);
          };
          aList.appendChild(btn);
        });

        const offBtn = document.createElement('button');
        offBtn.className = 'track-option active';
        offBtn.textContent = 'Off';
        offBtn.onclick = () => { 
          Array.from(sList.children).forEach(c => c.classList.remove('active'));
          offBtn.classList.add('active');
          loadSubtitleTrack(null); 
        };
        sList.appendChild(offBtn);

        data.subtitleTracks.forEach(t => {
          const btn = document.createElement('button');
          btn.className = 'track-option';
          btn.textContent = `${t.title} (${t.language})`;
          btn.onclick = () => { 
            Array.from(sList.children).forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            loadSubtitleTrack(`/subtitles/${encodeURIComponent(filename)}/${t.index}`); 
          };
          sList.appendChild(btn);
        });
      }).catch(() => { /* metadata is optional */ });
  }

  // --- Mode detection: local media server vs. static hosting (e.g. Vercel) ---
  // A static host has no /api/movies, so we fall back to file picker + URL input.
  const movieGrid = document.getElementById('movie-grid');
  const staticLoaders = document.getElementById('static-loaders');

  function playSource(url, label) {
    initAudio(camera, scene, video);
    loadVideoUrl(url, label, showHUD);
    fetchMetadata(label);
  }

  // --- Static mode: load a video from disk or from a URL ---
  function initStaticMode() {
    hasBackend = false;
    if (movieGrid) movieGrid.style.display = 'none';
    if (staticLoaders) staticLoaders.style.display = 'block';
    if (subsBtn) subsBtn.style.display = 'none';   // track extraction needs FFmpeg
    const welcomeSub = document.getElementById('welcome-sub');
    if (welcomeSub) welcomeSub.textContent = 'Pick a video to watch in the theatre';

    const fileInput = document.getElementById('file-input');
    const pickBtn = document.getElementById('pick-file-btn');
    const urlInput = document.getElementById('url-input');
    const urlBtn = document.getElementById('url-play-btn');

    if (pickBtn && fileInput) {
      pickBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        playSource(URL.createObjectURL(f), f.name);
      });
    }

    // Demo clip buttons
    ['demo-oceans-btn', 'demo-flower-btn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => {
          const url = btn.dataset.url;
          const title = btn.dataset.title;
          playSource(url, title);
        });
      }
    });

    function playTypedUrl() {
      const u = (urlInput && urlInput.value || '').trim();
      if (!u) { showErr('Paste a video URL first.'); return; }
      let label = u;
      try { label = decodeURIComponent(new URL(u).pathname.split('/').pop()) || u; } catch(e) {}
      rememberUrl(u, label);
      playSource(u, label);
    }
    if (urlBtn) urlBtn.addEventListener('click', playTypedUrl);
    if (urlInput) urlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); playTypedUrl(); }
    });

    renderRecent();
  }

  // Remember recently used URLs so returning visitors can one-click resume.
  const RECENT_KEY = 'cinema3d.recent';
  function readRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch(e) { return []; }
  }
  function rememberUrl(url, label) {
    try {
      const list = readRecent().filter(r => r.url !== url);
      list.unshift({ url, label });
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
    } catch(e) { /* storage may be unavailable */ }
  }
  function renderRecent() {
    const wrap = document.getElementById('recent-wrap');
    const listEl = document.getElementById('recent-list');
    if (!wrap || !listEl) return;
    const items = readRecent();
    if (!items.length) return;
    wrap.style.display = 'block';
    listEl.innerHTML = '';
    items.forEach(r => {
      const chip = document.createElement('button');
      chip.className = 'recent-chip';
      chip.textContent = r.label || r.url;
      chip.title = r.url;
      chip.addEventListener('click', () => playSource(r.url, r.label || r.url));
      listEl.appendChild(chip);
    });
  }

  // --- Server mode: scan the local movies folder ---
  function refreshLibrary() {
    if (!movieGrid) return;

    // When deployed online (e.g. Vercel, Netlify), immediately initialize static mode
    const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(window.location.hostname);
    if (!isLocal) {
      initStaticMode();
      return;
    }

    movieGrid.innerHTML = '<div class="loading-spinner">Loading movies...</div>';
    fetch('/api/movies')
      .then(r => {
        if (!r.ok) throw new Error('no backend');
        return r.json();
      })
      .then(movies => {
        if (!Array.isArray(movies)) throw new Error('bad payload');
        hasBackend = true;
        if (movieGrid) movieGrid.style.display = '';
        if (staticLoaders) staticLoaders.style.display = 'none';
        if (openFolderBtn) openFolderBtn.style.display = 'inline-flex';
        movieGrid.innerHTML = '';
        if(movies.length === 0) movieGrid.innerHTML = '<div class="loading-spinner">No movies found in "movies" directory.<br><span style="opacity:.7;font-size:13px">Use "Open movies folder" to add files.</span></div>';
        movies.forEach(m => {
          const div = document.createElement('div');
          div.className = 'movie-card';
          div.innerHTML = `
            <div class="movie-card-thumb-container">
              <img class="movie-card-thumb" src="/thumbnail/${encodeURIComponent(m)}" alt="${m}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMzMyMiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZmlsbD0iIzk5OSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5ObyBUaHVtYm5haWw8L3RleHQ+PC9zdmc+'" />
            </div>
            <div class="movie-card-title" title="${m}">${m.replace(/\.(mkv|mp4|webm|mov|m4v|ogv)$/i, '')}</div>
          `;
          div.addEventListener('click', () => {
            initAudio(camera, scene, video);
            loadVideoUrl(`/stream/${encodeURIComponent(m)}`, m, showHUD);
            fetchMetadata(m);
          });
          movieGrid.appendChild(div);
        });
      }).catch(() => {
        // No local server (static host) — switch to file/URL loading instead.
        initStaticMode();
      });
  }
  if (movieGrid) refreshLibrary();

  document.addEventListener('keydown',e=>{
    if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
    switch(e.key){
      case ' ':          e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft':  e.preventDefault(); video.currentTime=Math.max(0,video.currentTime-10); break;
      case 'ArrowRight': e.preventDefault(); video.currentTime=Math.min(video.duration||0,video.currentTime+10); break;
      case 'ArrowUp':    e.preventDefault(); video.volume=Math.min(1,video.volume+0.1); volBar.value=video.volume*100; updMute(); break;
      case 'ArrowDown':  e.preventDefault(); video.volume=Math.max(0,video.volume-0.1); volBar.value=video.volume*100; updMute(); break;
      case 'f':case 'F': toggleFS(); break;
      case 'l':case 'L': toggleLights(); break;
      case 'm':case 'M': toggleMute(); break;
      case 'o':case 'O': 
        const ws = document.getElementById('welcome-screen');
        ws.style.display = ws.style.display === 'none' ? 'flex' : 'none';
        break;
    }
  });

  // Loading Sequence (starts immediately)
  const bar=document.getElementById('loading-bar'), ls=document.getElementById('loading-screen');
  let pct=0;
  const ti=setInterval(()=>{
    pct+=Math.random()*16+7;
    bar.style.width=Math.min(pct,95)+'%';
    if(pct>=95){
      clearInterval(ti);
      bar.style.width='100%';
      setTimeout(()=>{
        ls.classList.add('curtains-open');
        setTimeout(()=>{ ls.style.display='none'; document.getElementById('welcome-screen').style.display='flex'; },1800);
      },400);
    }
  },130);
}
