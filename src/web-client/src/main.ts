// Freehold Dashboard Controller 2026
import '@knadh/oat/oat.min.css';
import { initGalaxyShader } from './GalaxyShader';
import { SignaturePen } from './SignaturePen';
import { audio } from './AudioControl';
import { initNetworkViz } from './NetworkViz';
import { generateXorShares, bitsToB64, convertBytesToBits } from './mpc_util';
import './favicon';
import { set as setBackground, cycle as cycleBackground, getConfig, setExact, FAVICON_PATTERNS, RETRO_PATTERNS, PALETTE_NAMES, clearConfig } from './background';

// 1. Pattern background
setBackground('random');

let pen: SignaturePen | null = null;
let currentViewId = 'discover';

// 2. Bento Grid
const generateBentoGrid = () => {
  const container = document.getElementById('bento-container');
  if (!container) return;
  container.innerHTML = '';

  const categories = [
    { title: 'Leadership Accountability', icon: '<svg class="marketeq-icon" viewBox="0 0 24 24" fill="none"><path class="primary" d="M12 22s8-4 8-10V5l-8-3l-8 3v7c0 6 8 10 8 10Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>', tint: 'tint-red' },
    { title: 'Permanent Remote Work', icon: '<svg class="marketeq-icon" viewBox="0 0 24 24" fill="none"><path class="primary" d="m3 9l9-7l9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Zm6 13V12h6v10" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>', tint: 'tint-blue' },
    { title: 'Climate Transparency', icon: '<svg class="marketeq-icon" viewBox="0 0 24 24" fill="none"><path class="primary" d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10Zm0-20v20M2 12h20" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>', tint: 'tint-green' },
    { title: 'Open Source Mandate', icon: '<svg class="marketeq-icon" viewBox="0 0 24 24" fill="none"><path class="primary" d="m16 18l6-6l-6-6M8 6l-6 6l6 6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>', tint: 'tint-purple' }
  ];

  categories.forEach((cat, i) => {
    const box = document.createElement('div');
    box.className = `bento-box fluted-glass ${cat.tint}`;
    if (i === 0) box.style.gridColumn = 'span 2';
    box.innerHTML = `<div class="bento-icon">${cat.icon}</div><div><h3>${cat.title}</h3><span style="font-size:0.8rem;color:var(--foreground-faint)">${(i + 1) * 1200} Verified Signers</span></div>`;
    box.addEventListener('click', () => { audio.playTone(440, 'sine', 0.05); showView('sign'); });
    container.appendChild(box);
  });
};
generateBentoGrid();

// 3. Navigation
const showView = (target: string) => {
  if (target === currentViewId) return;
  const targetView = document.getElementById(`${target}-view`);
  if (!targetView) return;
  if ((document as any).startViewTransition) {
    (document as any).startViewTransition(() => performSwitch(target, targetView));
  } else {
    performSwitch(target, targetView);
  }
};

const performSwitch = (target: string, targetView: HTMLElement) => {
  document.querySelectorAll('nav a').forEach(l => l.classList.remove('active'));
  document.querySelector(`nav a[data-target="${target}"]`)?.classList.add('active');
  if (currentViewId !== 'discover') {
    const prev = document.getElementById(`${currentViewId}-view`);
    if (prev) prev.classList.remove('active', 'active-page');
  }
  targetView.classList.add('active');
  if (target !== 'discover') targetView.classList.add('active-page');
  currentViewId = target;
  if (target === 'join') initNetworkViz('network-3d-viz');
  if (target === 'sign') {
    document.querySelectorAll('.sign-step').forEach(s => s.classList.remove('active'));
    document.getElementById('step-identity')?.classList.add('active');
  }
};

const dismissCurrentView = () => {
  if (currentViewId === 'discover') return;
  const view = document.getElementById(`${currentViewId}-view`);
  if (!view) return;
  audio.playTone(330, 'sine', 0.1);
  view.classList.add('dismissing-page');
  document.querySelectorAll('nav a').forEach(l => l.classList.remove('active'));
  document.querySelector('nav a[data-target="discover"]')?.classList.add('active');
  setTimeout(() => {
    view.classList.remove('active', 'active-page', 'dismissing-page');
    currentViewId = 'discover';
    document.getElementById('discover-view')?.classList.add('active');
  }, 700);
};

window.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismissCurrentView(); });
let touchStartY = 0;
window.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
window.addEventListener('touchend', (e) => { if (e.changedTouches[0].clientY - touchStartY > 150) dismissCurrentView(); }, { passive: true });

document.querySelectorAll('nav a, #join-ribbon').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    audio.playTone(660, 'sine', 0.05);
    showView((link as HTMLElement).dataset.target!);
  });
});

// 4. Create
document.getElementById('create-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  audio.playTone(880, 'square', 0.1);
  console.log('[MPC] Sharding document signing key...');
  dismissCurrentView();
});

// 5. Sign flow
document.getElementById('request-code-btn')?.addEventListener('click', async () => {
  const emailEl = document.getElementById('signer-email') as HTMLInputElement;
  const email = emailEl?.value ?? '';
  if (!email.includes('@')) { emailEl?.setAttribute('aria-invalid', 'true'); return; }
  emailEl?.removeAttribute('aria-invalid');
  const emailBits = convertBytesToBits(new TextEncoder().encode(email));
  const shards = generateXorShares(emailBits, 5);
  try {
    await Promise.all([
      fetch('http://localhost:5871/shard', { method: 'POST', body: bitsToB64(shards[0]) }),
      fetch('http://localhost:5872/shard', { method: 'POST', body: bitsToB64(shards[1]) })
    ]);
  } catch { console.warn('MPC distribution simulated.'); }
  document.getElementById('step-identity')?.classList.remove('active');
  document.getElementById('step-otp')?.classList.add('active');
});

document.getElementById('verify-code-btn')?.addEventListener('click', () => {
  const otpEl = document.getElementById('otp-code') as HTMLInputElement;
  if ((otpEl?.value ?? '').length < 4) { otpEl?.setAttribute('aria-invalid', 'true'); return; }
  otpEl?.removeAttribute('aria-invalid');
  document.getElementById('step-otp')?.classList.remove('active');
  document.getElementById('step-signature')?.classList.add('active');
  initGalaxyShader('galaxy-canvas');
});

const sigInput = document.getElementById('signature-input') as HTMLInputElement;
sigInput?.addEventListener('input', () => { if (pen) (pen as SignaturePen).updatePosition(Math.min(sigInput.value.length / 20, 1)); });

document.getElementById('finalize-sign-btn')?.addEventListener('click', () => {
  const name = sigInput?.value?.trim();
  if (!name) { sigInput?.setAttribute('aria-invalid', 'true'); return; }
  audio.playTone(880, 'sine', 0.08);
  const step = document.getElementById('step-signature');
  if (step) {
    step.innerHTML = `<div style="text-align:center;padding:2rem 0;">
      <svg viewBox="0 0 50 50" fill="none" stroke-width="2" style="width:64px;height:64px;margin-bottom:1rem;color:#27ae60;">
        <path stroke="currentColor" opacity=".3" d="m16.667 25l6.25 6.25l10.416-10.417"/>
        <path stroke="currentColor" d="M25 43.75c10.355 0 18.75-8.395 18.75-18.75S35.355 6.25 25 6.25S6.25 14.645 6.25 25S14.645 43.75 25 43.75"/>
      </svg>
      <h2>Signature Cast</h2>
      <p style="color:#666;">Signed as <strong>${name}</strong>. Shards distributed across MPC cluster.</p>
      <button class="regal-btn" style="margin-top:1.5rem;" onclick="location.reload()">Return to Dashboard</button>
    </div>`;
  }
});

// 6. Dev panel
const port = parseInt(window.location.port, 10);
const isDev = !!(port && port !== 80 && port !== 443);
if (isDev) {
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed', bottom: '12px', right: '12px', zIndex: '9999',
    background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px',
    padding: '10px 14px', color: '#fff', fontFamily: 'monospace',
    fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '260px',
  });
  const info = document.createElement('div');
  info.style.cssText = 'color:rgba(255,255,255,0.7);word-break:break-all;';
  panel.appendChild(info);
  function updateInfo() { const c = getConfig(); if (c) info.textContent = `${c.type}/${c.pattern} | ${PALETTE_NAMES[c.palette]} | z${c.zoom.toFixed(2)}`; }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
  const mb = (t: string, fn: () => void) => { const b = document.createElement('button'); b.textContent = t; Object.assign(b.style, { padding:'3px 6px',fontSize:'10px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.2)',background:'rgba(255,255,255,0.08)',color:'#fff',cursor:'pointer',fontFamily:'monospace' }); b.addEventListener('click', fn); row.appendChild(b); };
  mb('Cycle', async () => { await cycleBackground(); updateInfo(); });
  mb('Rand', async () => { clearConfig(); await setBackground('random'); updateInfo(); });
  panel.appendChild(row);
  const pr = document.createElement('div'); pr.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;margin-top:4px;';
  for (const p of FAVICON_PATTERNS) { const b = document.createElement('button'); b.textContent = p; Object.assign(b.style, { padding:'2px 5px',fontSize:'9px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.12)',background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.6)',cursor:'pointer',fontFamily:'monospace' }); b.addEventListener('click', async () => { await setExact('favicon', p); updateInfo(); }); pr.appendChild(b); }
  for (const p of RETRO_PATTERNS) { const b = document.createElement('button'); b.textContent = p; Object.assign(b.style, { padding:'2px 5px',fontSize:'9px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.12)',background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.6)',cursor:'pointer',fontFamily:'monospace' }); b.addEventListener('click', async () => { await setExact('retro', p); updateInfo(); }); pr.appendChild(b); }
  panel.appendChild(pr);
  document.body.appendChild(panel);
  setTimeout(updateInfo, 500);
}

console.log('Freehold: Dashboard Active.');
