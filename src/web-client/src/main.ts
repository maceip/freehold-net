// OpenPetition Dashboard Controller 2026
import '@knadh/oat/oat.min.css';
import { initGalaxyShader } from './GalaxyShader';
import { SignaturePen } from './SignaturePen';
import { audio } from './AudioControl';
import { initNetworkViz } from './NetworkViz';
import { generateXorShares, bitsToB64, convertBytesToBits } from './mpc_util';
import './favicon';
import { set as setBackground, cycle as cycleBackground, getConfig, setExact, FAVICON_PATTERNS, RETRO_PATTERNS, PALETTE_NAMES, clearConfig } from './background';

// 1. Initial State — pattern background replaces shader
setBackground('random');

let pen: SignaturePen | null = null;

type OrgEntry = [string, string]; // [logoKey, displayName]
type Petition = { title: string; desc: string; signers: number; orgs: number; orgNames: OrgEntry[] };

// 2. Discover: Infinite scrolling petition carousel
const generateCarousel = () => {
  const track = document.getElementById('petition-carousel');
  if (!track) return;

  // Logo key must match domain for Clearbit: https://logo.clearbit.com/<key>.com
  const petitions: Petition[] = [
    { title: 'Permanent Remote Work', desc: 'Mandate permanent remote-first policy across all departments.', signers: 4_821, orgs: 12, orgNames: [['anthropic','Anthropic'], ['google','Google'], ['meta','Meta'], ['stripe','Stripe']] },
    { title: 'Leadership Accountability', desc: 'Quarterly anonymous 360-degree reviews for all VP+ leadership.', signers: 3_407, orgs: 8, orgNames: [['netflix','Netflix'], ['spotify','Spotify'], ['airbnb','Airbnb']] },
    { title: 'Climate Transparency', desc: 'Publish verified Scope 1-3 emissions with third-party audit.', signers: 6_132, orgs: 19, orgNames: [['apple','Apple'], ['microsoft','Microsoft'], ['amazon','Amazon'], ['cloudflare','Cloudflare'], ['hashicorp','HashiCorp']] },
    { title: 'Open Source Mandate', desc: 'Release all internal tooling under permissive OSS licenses.', signers: 2_956, orgs: 7, orgNames: [['mozilla','Mozilla'], ['redhat','Red Hat'], ['github','GitHub']] },
    { title: 'Pay Equity Audit', desc: 'Independent compensation review across gender and ethnicity.', signers: 5_210, orgs: 14, orgNames: [['salesforce','Salesforce'], ['adobe','Adobe'], ['twilio','Twilio'], ['datadog','Datadog']] },
    { title: 'End Forced RTO', desc: 'Reverse return-to-office mandates issued without employee input.', signers: 8_744, orgs: 23, orgNames: [['amazon','Amazon'], ['google','Google'], ['meta','Meta'], ['slack','Slack'], ['ibm','IBM']] },
    { title: '4-Day Work Week', desc: 'Pilot a 32-hour work week with no reduction in compensation.', signers: 7_389, orgs: 16, orgNames: [['basecamp','Basecamp'], ['buffer','Buffer'], ['kickstarter','Kickstarter'], ['shopify','Shopify']] },
    { title: 'Contractor Parity', desc: 'Equal benefits and protections for all contract workers.', signers: 1_823, orgs: 5, orgNames: [['dropbox','Dropbox'], ['gitlab','GitLab'], ['docker','Docker']] },
  ];

  // Duplicate for seamless infinite scroll
  const items = [...petitions, ...petitions];

  items.forEach((p, i) => {
    // Insert construction card after the first batch
    if (i === petitions.length) {
      const cc = document.createElement('div');
      cc.className = 'construction-card';
      cc.innerHTML = `
        <div>
          <span class="construction-badge">No Verification</span>
          <h3>End Forced Return-to-Office</h3>
          <p>Sign anonymously — no email required.</p>
        </div>
        <footer>
          <span class="badge" style="background:rgba(245,197,24,0.12);color:#f5c518;">8,744 signers</span>
          <span class="badge">23 orgs</span>
        </footer>
      `;
      cc.addEventListener('click', () => {
        audio.playTone(660, 'sine', 0.05);
        showView('sign-view');
      });
      track.appendChild(cc);
    }

    const card = document.createElement('div');
    card.className = 'petition-card';
    card.innerHTML = `
      <div>
        <h3>${p.title}</h3>
        <p>${p.desc}</p>
      </div>
      <footer>
        <span class="badge secondary">${p.signers.toLocaleString()} signers</span>
        <span class="badge">${p.orgs} orgs</span>
      </footer>
    `;
    card.addEventListener('click', () => {
      audio.playTone(440, 'sine', 0.05);
      openPetitionDetail(petitions[i % petitions.length]);
    });
    track.appendChild(card);
  });
};
generateCarousel();

// Petition detail view
const openPetitionDetail = (p: Petition) => {
  document.getElementById('petition-detail-title')!.textContent = p.title;
  document.getElementById('petition-detail-desc')!.textContent = p.desc;
  document.getElementById('petition-detail-signers')!.textContent = p.signers.toLocaleString();
  document.getElementById('petition-detail-orgs')!.textContent = String(p.orgs);

  const orgList = document.getElementById('petition-detail-orglist')!;
  orgList.innerHTML = '';
  p.orgNames.forEach(([key, name]) => {
    const chip = document.createElement('span');
    chip.className = 'org-chip';
    chip.innerHTML = `<img src="https://logo.clearbit.com/${key}.com" alt="${name}" loading="lazy" /><span class="org-divider"></span>${name}`;
    orgList.appendChild(chip);
  });
  if (p.orgs > p.orgNames.length) {
    const more = document.createElement('span');
    more.className = 'org-chip org-chip-more';
    more.textContent = `+${p.orgs - p.orgNames.length} more`;
    orgList.appendChild(more);
  }

  showView('petition-view');
};

document.getElementById('petition-sign-btn')?.addEventListener('click', () => {
  audio.playTone(660, 'sine', 0.05);
  showView('sign-view');
});

// 3. Navigation & View Controller
const showView = (target: string) => {
    document.querySelectorAll('nav a').forEach(l => l.classList.remove('active'));
    const navLink = document.querySelector(`nav a[data-target="${target.replace('-view','')}"]`);
    if (navLink) navLink.classList.add('active');

    document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
    const view = document.getElementById(target);
    if (view) view.classList.add('active');

    // Nav + ribbon always visible on all views
    if (target === 'join-view') initNetworkViz('network-3d-viz');
};

document.querySelectorAll('nav a, #join-ribbon').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const target = (link as HTMLElement).dataset.target!;
    audio.playTone(660, 'sine', 0.05);
    showView(`${target}-view`);
  });
});

// 4. Create View: Animated Whitelist Graph & Peer Discovery
const whitelistInput = document.getElementById('whitelist-input') as HTMLInputElement;
const graphContainer = document.getElementById('whitelist-graph');

const corporatePeers: Record<string, string[]> = {
    'anthropic': ['OpenAI', 'Google', 'DeepMind'],
    'openai': ['Anthropic', 'Microsoft', 'Meta'],
    'google': ['Microsoft', 'Apple', 'Amazon', 'Meta'],
    'netflix': ['Disney', 'Hulu', 'HBO', 'Apple'],
    'microsoft': ['Google', 'Amazon', 'Oracle']
};

whitelistInput?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value.toLowerCase().trim();
    if (corporatePeers[val]) {
        const peers = corporatePeers[val];
        const mainNode = addGraphNode(val.charAt(0).toUpperCase() + val.slice(1), { x: 50, y: 50 });
        peers.forEach((peer, idx) => {
            setTimeout(() => {
                const angle = (idx / peers.length) * Math.PI * 2;
                const pos = { x: 50 + Math.cos(angle) * 30, y: 50 + Math.sin(angle) * 30 };
                drawAnimatedEdge(mainNode, pos, angle);
                addGraphNode(peer, pos);
            }, (idx + 1) * 400);
        });
        whitelistInput.value = ''; 
    }
});

const drawAnimatedEdge = (origin: HTMLElement, _targetPos: {x: number, y: number}, angle: number) => {
    const edge = document.createElement('div');
    edge.className = 'graph-edge';
    edge.style.left = origin.style.left;
    edge.style.top = origin.style.top;
    edge.style.width = '0px';
    edge.style.transform = `rotate(${angle}rad)`;
    if(graphContainer) graphContainer.appendChild(edge);
    setTimeout(() => {
        edge.style.width = '100px';
        edge.style.transition = 'width 0.4s ease-out';
    }, 10);
};

const addGraphNode = (name: string, pos: {x: number, y: number}) => {
    const node = document.createElement('div');
    node.className = 'company-node';
    node.style.left = `${pos.x}%`;
    node.style.top = `${pos.y}%`;
    node.innerHTML = `<div title="${name}" style="width:32px; height:32px; border-radius:50%; background:#fff; border:2px solid var(--accent); display:flex; align-items:center; justify-content:center; color:var(--primary); font-size:12px; font-weight:900;">${name.charAt(0)}</div>`;
    if(graphContainer) graphContainer.appendChild(node);
    return node;
};

// 5. Sign View: Multi-step & Signature

// Helper: advance sign step + update OAT progress bar
const stepIndex: Record<string, number> = { 'step-identity': 1, 'step-otp': 2, 'step-eligible': 3, 'step-signature': 4 };
const advanceStep = (from: string, to: string) => {
    document.getElementById(from)?.classList.remove('active');
    document.getElementById(to)?.classList.add('active');
    const prog = document.getElementById('sign-progress') as HTMLProgressElement | null;
    if (prog && stepIndex[to]) prog.value = stepIndex[to];
};

// Step 1 → 2: Verify identity via MPC sharding
document.getElementById('request-code-btn')?.addEventListener('click', async () => {
    const emailEl = document.getElementById('signer-email') as HTMLInputElement;
    const field = emailEl?.closest('[data-field]') as HTMLElement | null;
    const email = emailEl?.value ?? '';

    if (!email.includes('@')) {
        emailEl?.setAttribute('aria-invalid', 'true');
        if (field) {
            field.setAttribute('data-field', 'error');
            // Add error message if not already present
            if (!field.querySelector('.error')) {
                const err = document.createElement('p');
                err.className = 'error';
                err.textContent = 'Enter a valid corporate email address.';
                field.appendChild(err);
            }
        }
        return;
    }

    // Clear validation state
    emailEl?.removeAttribute('aria-invalid');
    if (field) field.setAttribute('data-field', '');

    console.log("[MPC] Generating local shards for identity verification...");
    const emailBits = convertBytesToBits(new TextEncoder().encode(email));
    const shards = generateXorShares(emailBits, 5);
    try {
        await Promise.all([
            fetch('http://localhost:5871/shard', { method: 'POST', body: bitsToB64(shards[0]) }),
            fetch('http://localhost:5872/shard', { method: 'POST', body: bitsToB64(shards[1]) })
        ]);
    } catch (_e) { console.warn("MPC distribution simulated."); }

    advanceStep('step-identity', 'step-otp');
});

// Step 2 → 3: Verify OTP code
document.getElementById('verify-code-btn')?.addEventListener('click', () => {
    const otpEl = document.getElementById('otp-code') as HTMLInputElement;
    const field = otpEl?.closest('[data-field]') as HTMLElement | null;
    const code = otpEl?.value ?? '';

    if (code.length < 4) {
        otpEl?.setAttribute('aria-invalid', 'true');
        if (field) {
            field.setAttribute('data-field', 'error');
            if (!field.querySelector('.error')) {
                const err = document.createElement('p');
                err.className = 'error';
                err.textContent = 'Enter the verification code sent to your email.';
                field.appendChild(err);
            }
        }
        return;
    }

    otpEl?.removeAttribute('aria-invalid');
    if (field) field.setAttribute('data-field', '');

    advanceStep('step-otp', 'step-eligible');
    loadEligiblePetitions();
});

// Step 3: Load eligible petitions
const loadEligiblePetitions = () => {
    const list = document.getElementById('petition-list')!;
    const petitions = [
        { name: 'Permanent Remote Work', signers: 2400 },
        { name: 'Leadership Accountability', signers: 1200 },
        { name: 'Climate Transparency', signers: 3600 },
    ];
    list.innerHTML = petitions.map((p, i) => `
        <div class="petition-item">
            <div>
                <strong>${p.name}</strong>
                <span class="badge secondary" style="margin-left:var(--space-2);">${p.signers.toLocaleString()}</span>
            </div>
            <button class="small" data-petition-idx="${i}">Sign</button>
        </div>
    `).join('');

    list.querySelectorAll('button[data-petition-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
            audio.playTone(440, 'sine', 0.05);
            advanceStep('step-eligible', 'step-signature');
            initGalaxyShader('galaxy-canvas');
            pen = new SignaturePen('pen-container');
        });
    });
};

// Step 4: Signature input drives pen animation
const sigInput = document.getElementById('signature-input') as HTMLInputElement;
sigInput?.addEventListener('input', () => {
    if (pen) pen.updatePosition(Math.min(sigInput.value.length / 20, 1));
});

// Step 4 → Done: Cast signature + show confirmation
document.getElementById('finalize-sign-btn')?.addEventListener('click', () => {
    const name = sigInput?.value?.trim();
    if (!name) {
        sigInput?.setAttribute('aria-invalid', 'true');
        return;
    }
    sigInput?.removeAttribute('aria-invalid');

    audio.playTone(880, 'sine', 0.08);

    // Replace signature step with confirmation
    const step = document.getElementById('step-signature')!;
    step.innerHTML = `
        <div style="text-align:center; padding:var(--space-8) 0;">
            <svg class="duo-icon" viewBox="0 0 50 50" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" style="width:64px;height:64px;margin-bottom:var(--space-4);color:var(--success);">
                <path stroke="currentColor" opacity=".3" d="m16.667 25l6.25 6.25l10.416-10.417"/>
                <path stroke="currentColor" d="M25 43.75c10.355 0 18.75-8.395 18.75-18.75S35.355 6.25 25 6.25S6.25 14.645 6.25 25S14.645 43.75 25 43.75"/>
            </svg>
            <h2>Signature Cast</h2>
            <p class="text-light">Signed as <strong>${name}</strong>. Your identity shards have been distributed across the MPC cluster.</p>
            <button class="large mt-6" onclick="location.reload()">Return to Dashboard</button>
        </div>
    `;
});

// A11y Panel
document.getElementById('mute-btn')?.addEventListener('click', () => {
    const isMuted = audio.toggleMute();
    (document.getElementById('mute-btn') as HTMLElement).textContent = isMuted ? '🔇' : '🔊';
});

// ── Dev mode panel (non-production ports only) ─────────────────────────────
const port = parseInt(window.location.port, 10);
const isDev = !!(port && port !== 80 && port !== 443);
console.log(`[DEV] port=${port} isDev=${isDev}`);

if (isDev) {
  const panel = document.createElement('div');
  panel.id = 'fh-dev-panel';
  Object.assign(panel.style, {
    position: 'fixed', bottom: '12px', right: '12px', zIndex: '9999',
    background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px',
    padding: '10px 14px', color: '#fff', fontFamily: 'monospace',
    fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '6px',
    maxWidth: '260px',
  });

  const label = document.createElement('div');
  label.style.cssText = 'font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.5);';
  label.textContent = 'BG DEV';
  panel.appendChild(label);

  const info = document.createElement('div');
  info.id = 'fh-dev-info';
  info.style.cssText = 'color:rgba(255,255,255,0.7);word-break:break-all;';
  panel.appendChild(info);

  function updateInfo() {
    const cfg = getConfig();
    if (cfg) {
      info.textContent = `${cfg.type}/${cfg.pattern} • ${PALETTE_NAMES[cfg.palette]} • z${cfg.zoom.toFixed(2)}`;
    }
  }

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';

  const makeBtn = (text: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.textContent = text;
    Object.assign(b.style, {
      padding: '4px 8px', fontSize: '10px', borderRadius: '6px',
      border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)',
      color: '#fff', cursor: 'pointer', fontFamily: 'monospace',
    });
    b.addEventListener('click', onClick);
    btnRow.appendChild(b);
    return b;
  };

  makeBtn('⏭ Cycle', async () => { await cycleBackground(); updateInfo(); });
  makeBtn('🎲 Random', async () => { clearConfig(); await setBackground('random'); updateInfo(); });
  makeBtn('F Favicon', async () => { clearConfig(); await setBackground('favicon'); updateInfo(); });
  makeBtn('R Retro', async () => { clearConfig(); await setBackground('retro'); updateInfo(); });

  panel.appendChild(btnRow);

  // Per-pattern buttons
  const patRow = document.createElement('div');
  patRow.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;margin-top:4px;';

  for (const p of FAVICON_PATTERNS) {
    makePatBtn(patRow, 'favicon', p);
  }
  for (const p of RETRO_PATTERNS) {
    makePatBtn(patRow, 'retro', p);
  }
  panel.appendChild(patRow);

  function makePatBtn(container: HTMLElement, type: 'favicon' | 'retro', pattern: string) {
    const b = document.createElement('button');
    b.textContent = (type === 'favicon' ? 'F:' : 'R:') + pattern;
    Object.assign(b.style, {
      padding: '2px 5px', fontSize: '9px', borderRadius: '4px',
      border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
      color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontFamily: 'monospace',
    });
    b.addEventListener('click', async () => { await setExact(type, pattern); updateInfo(); });
    container.appendChild(b);
  }

  document.body.appendChild(panel);

  // Show initial info after background loads
  setTimeout(updateInfo, 500);
}

console.log("Freehold: Professional Dashboard Redux Active.");
