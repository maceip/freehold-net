// Freehold Dashboard Controller 2026
import { initBackgroundShader } from './BackgroundShader';
import { initGalaxyShader } from './GalaxyShader';
import { SignaturePen, getMathEquation } from './SignaturePen';
import { initNetworkViz } from './NetworkViz';
import { initMpcTerminal } from './MpcTerminal';
import * as background from './background';
import { COMPANIES, logoPath } from './companies';

// 1. Initial State & Visuals
initBackgroundShader('shader-bg');

let pen: SignaturePen | null = null;
let currentViewId = 'discover';

// MPC Debug Terminal
const mpcTerminal = initMpcTerminal(() => currentViewId);

// 2. Bento Grid Generation (Discover)
const generateBentoGrid = () => {
  const container = document.getElementById('bento-container');
  if (!container) return;
  container.innerHTML = '';

  const categories = [
    { id: 'p1', title: 'Leadership Accountability', tint: 'tint-red', spark: [40, 55, 70, 85, 95, 100] },
    { id: 'p2', title: 'Permanent Remote Work', tint: 'tint-blue', spark: [10, 20, 25, 35, 40, 50] },
    { id: 'p3', title: 'Climate Transparency', tint: 'tint-green', spark: [0, 0, 0, 0, 0, 0] },
    { id: 'p4', title: 'Open Source Mandate', tint: 'tint-purple', spark: [0, 0, 5, 0, 0, 0] },
  ];

  const borderColors = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12'];

  const pickCompanies = (seed: number, count: number) => {
    const shuffled = [...COMPANIES].sort((a, b) => {
      const ha = ((seed * 2654435761 + COMPANIES.indexOf(a)) >>> 0) & 0xffff;
      const hb = ((seed * 2654435761 + COMPANIES.indexOf(b)) >>> 0) & 0xffff;
      return ha - hb;
    });
    return shuffled.slice(0, count);
  };

  const getAvatarRings = () => `
    <div class="avatar-rings">
      ${[1,2,3,4].map((i, idx) => `<div style="border-color:${borderColors[idx]};">${String.fromCharCode(64+i)}</div>`).join('')}
    </div>`;

  const getCompanyLogos = (cardIdx: number) => {
    const companies = pickCompanies(cardIdx * 7 + 3, 2 + (cardIdx % 2));
    const offsets = [
      { top: '10%', left: '-10%', rotate: -8 },
      { top: '30%', left: '20%', rotate: 5 },
      { top: '5%', left: '50%', rotate: -3 },
    ];
    return `<div class="company-logos">${companies.map((c, i) => {
      const o = offsets[i % offsets.length];
      return `<img src="${logoPath(c.slug)}" alt="${c.name}" style="top:${o.top}; left:${o.left}; transform:rotate(${o.rotate}deg);" />`;
    }).join('')}</div>`;
  };

  const getSparkline = (values: number[]) => {
    const max = Math.max(...values, 1);
    return `<div style="display:flex; align-items:flex-end; gap:3px; height:40px; position:absolute; bottom:0; left:0; right:0; padding:0 4px; z-index:2;">
      ${values.map((v, i) => {
        const h = max > 0 ? (v / max) * 100 : 4;
        const dot = v > 0 && i >= values.length - 2
          ? `<div style="position:absolute; top:-10px; left:50%; transform:translateX(-50%); width:10px; height:10px; border-radius:50%; background:#fff; border:1px solid #aaa;"></div>`
          : '';
        return `<div style="flex:1; background:rgba(255,255,255,${v > 0 ? 0.15 : 0.06}); height:${h || 4}%; border-radius:2px 2px 0 0; position:relative;">${dot}</div>`;
      }).join('')}
    </div>`;
  };

  // Create track wrapper for seamless scrolling
  const track = document.createElement('div');
  track.id = 'bento-track';

  const buildCards = (parent: HTMLElement) => {
    categories.forEach((cat, i) => {
      const box = document.createElement('div');
      box.className = `bento-box fluted-glass ${cat.tint}`;
      box.innerHTML = `
        ${getCompanyLogos(i)}
        <div class="bento-content" style="display:flex; flex-direction:column; height:100%; position:relative; z-index:3;">
          <h3 class="bento-title">${cat.title}</h3>
          ${getAvatarRings()}
        </div>
        ${getSparkline(cat.spark)}
        <div class="demo-sash">DEMO</div>
      `;
      box.addEventListener('click', () => showView('petition'));
      parent.appendChild(box);
    });

    // 5th card — Under Construction (clickable for debug signing)
    const wip = document.createElement('div');
    wip.className = 'bento-box wip-card';
    wip.style.cursor = 'pointer';
    wip.style.opacity = '0.7';
    wip.innerHTML = `
      <div class="bento-content" style="display:flex; flex-direction:column; height:100%; position:relative; z-index:1;">
        <h3 class="bento-title" style="color:rgba(255,255,255,0.5);">Under Construction</h3>
        <p style="color:rgba(255,255,255,0.3); font-size:0.75rem; margin:auto 0 0;">Click to sign (debug)</p>
      </div>
    `;
    wip.addEventListener('click', () => openSignWithPetition('wip'));
    parent.appendChild(wip);
  };

  // Build cards twice for seamless loop
  buildCards(track);
  buildCards(track);

  container.appendChild(track);
};

const generateZKIdentities = () => {
  const listEl = document.getElementById('id-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  
  for (let i = 0; i < 8; i++) {
    const card = document.createElement('div');
    card.className = 'zk-id-card';
    const humanOutline = `<svg class="human-outline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const hash = Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    
    card.innerHTML = `${humanOutline}<div class="crypto-hash">${hash}</div>`;
    
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--light-x', `${(x / rect.width) * 100}%`);
      card.style.setProperty('--light-y', `${(y / rect.height) * 100}%`);
      const rotateX = ((y / rect.height) - 0.5) * 15;
      const rotateY = ((x / rect.width) - 0.5) * -15;
      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.05)`;
    });
    
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale(1)';
      card.style.setProperty('--light-x', '50%');
      card.style.setProperty('--light-y', '0%');
    });
    listEl.appendChild(card);
  }
};

const showView = (target: string) => {
    if (target === currentViewId) return;
    const targetView = document.getElementById(`${target}-view`);
    if (!targetView) return;

    if (target === 'petition') generateZKIdentities();

    if ((document as any).startViewTransition) {
        (document as any).startViewTransition(() => performSwitch(target, targetView));
    } else {
        performSwitch(target, targetView);
    }
};

const performSwitch = (target: string, targetView: HTMLElement) => {
    document.querySelectorAll('nav a').forEach(l => l.classList.remove('active'));
    document.querySelector(`nav a[data-target="${target}"]`)?.classList.add('active');

    // Dismiss previous non-discover view instantly
    if (currentViewId !== 'discover') {
        const prevView = document.getElementById(`${currentViewId}-view`);
        if (prevView) prevView.classList.remove('active', 'active-page');
    }

    // Show new view with animation
    targetView.classList.add('active');
    if (target !== 'discover') {
        // Force reflow so animation replays
        void targetView.offsetHeight;
        targetView.classList.add('active-page');
    }
    currentViewId = target;

    // Terminal split mode when opening non-discover views
    if (target !== 'discover' && mpcTerminal.isOpen()) {
        mpcTerminal.enterSplitMode();
    }

    if (target === 'join') { initNetworkViz('network-3d-viz'); background.set('random'); }
    if (target === 'sign') {
        document.querySelectorAll('.sign-step').forEach(s => s.classList.remove('active'));
        document.getElementById('step-identity')!.classList.add('active');
        generateSignCarousel();
        updatePetitionTab();
        resetAmphibianTimer();
    } else {
        document.getElementById('petition-tab')?.classList.remove('visible');
        hideAmphibian();
    }
};

const dismissCurrentView = () => {
    if (currentViewId === 'discover') return;
    const view = document.getElementById(`${currentViewId}-view`);
    if (!view) return;

    view.classList.remove('active-page');
    view.classList.add('dismissing-page');
    document.querySelectorAll('nav a').forEach(l => l.classList.remove('active'));
    document.getElementById('petition-tab')?.classList.remove('visible');

    setTimeout(() => {
        view.classList.remove('active', 'dismissing-page');
        currentViewId = 'discover';
        document.getElementById('discover-view')!.classList.add('active');
        if (mpcTerminal.isOpen()) mpcTerminal.exitSplitMode();
    }, 350);
};

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dismissCurrentView();
    // Ctrl+` toggles MPC terminal
    if (e.key === '`' && e.ctrlKey) { e.preventDefault(); mpcTerminal.toggle(); }
});

// Dismiss sheets on outside click (click on the backdrop section, not its content)
document.querySelectorAll('section:not(#discover-view)').forEach(section => {
    section.addEventListener('click', (e) => {
        if (e.target === section) dismissCurrentView();
    });
});

let touchStartY = 0;
window.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
window.addEventListener('touchend', (e) => { if (e.changedTouches[0].clientY - touchStartY > 150) dismissCurrentView(); }, { passive: true });

document.querySelectorAll('nav a, #join-ribbon').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const target = (link as HTMLElement).dataset.target!;
    showView(target);
  });
});

const triggerMcpAnimation = async (email: string): Promise<boolean> => {
    const loading = document.getElementById('mcp-loading')!;
    const panel = document.getElementById('mcp-panel')!;
    const shatter = document.getElementById('shatter-container')!;
    const nodesG = document.getElementById('graph-nodes')!;
    const edgesG = document.getElementById('graph-edges')!;
    const packetsG = document.getElementById('graph-packets')!;
    const convergenceG = document.getElementById('graph-convergence')!;
    const statusLabel = document.getElementById('mcp-status-label')!;

    // Helpers
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    const svgEl = (tag: string, attrs: Record<string, string>): SVGElement => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        return el;
    };
    const quadBezier = (t: number, p0: [number,number], cp: [number,number], p2: [number,number]): [number,number] => {
        const u = 1 - t;
        return [
            u * u * p0[0] + 2 * u * t * cp[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * cp[1] + t * t * p2[1],
        ];
    };

    const drawIsoBox = (cx: number, cy: number, color: string, scale: number, label: string): SVGElement => {
        const g = svgEl('g', { transform: `translate(${cx},${cy}) scale(${scale})` });
        const w = 40, h = 25, d = 15;
        // Top face
        g.appendChild(svgEl('polygon', {
            points: `0,${-h} ${w},${-h - d} 0,${-h - 2 * d} ${-w},${-h - d}`,
            fill: color, opacity: '0.4', stroke: color, 'stroke-width': '1',
        }));
        // Left face
        g.appendChild(svgEl('polygon', {
            points: `${-w},${-h - d} 0,${-h - 2 * d} 0,${-2 * d} ${-w},${-d}`,
            fill: color, opacity: '0.25', stroke: color, 'stroke-width': '1',
        }));
        // Right face
        g.appendChild(svgEl('polygon', {
            points: `0,${-h - 2 * d} ${w},${-h - d} ${w},${-d} 0,${-2 * d}`,
            fill: color, opacity: '0.15', stroke: color, 'stroke-width': '1',
        }));
        // Label
        const txt = svgEl('text', {
            x: '0', y: '8', fill: color, 'font-size': '9', 'font-family': 'monospace',
            'font-weight': '700', 'text-anchor': 'middle', opacity: '0.8',
        });
        txt.textContent = label;
        g.appendChild(txt);
        return g;
    };

    const animateDotOnCurve = (
        p0: [number,number], cp: [number,number], p2: [number,number],
        color: string, duration: number, container: Element
    ): Promise<void> => {
        return new Promise(resolve => {
            const dot = svgEl('circle', { r: '3', fill: color, filter: 'url(#glow-blue)', opacity: '0.9' });
            container.appendChild(dot);
            const start = performance.now();
            const step = (now: number) => {
                const t = Math.min((now - start) / duration, 1);
                const [x, y] = quadBezier(t, p0, cp, p2);
                dot.setAttribute('cx', x.toString());
                dot.setAttribute('cy', y.toString());
                if (t < 1) {
                    requestAnimationFrame(step);
                } else {
                    dot.remove();
                    resolve();
                }
            };
            requestAnimationFrame(step);
        });
    };

    // Clear previous state
    shatter.innerHTML = '';
    nodesG.innerHTML = '';
    edgesG.innerHTML = '';
    packetsG.innerHTML = '';
    convergenceG.innerHTML = '';
    panel.classList.remove('unfolding', 'folding');

    // Server positions
    const servers: { pos: [number,number]; color: string; label: string }[] = [
        { pos: [150, 160], color: '#4ecdc4', label: 'MPC-01' },
        { pos: [450, 160], color: '#45b7d1', label: 'MPC-02' },
        { pos: [300, 320], color: '#96ceb4', label: 'MPC-03' },
    ];
    const mailServer = { pos: [300, 60] as [number,number], color: '#e74c3c', label: 'MAIL' };
    const focalPoint: [number,number] = [300, 210];

    // ─── Phase 0: Console Boot (0-500ms) ───
    statusLabel.textContent = 'INITIALIZING SECURE CONSOLE...';
    statusLabel.style.color = '';
    loading.style.display = 'flex';
    loading.style.opacity = '1';
    panel.classList.add('unfolding');
    await delay(500);

    // ─── Phase 1: Email Shatter (500-700ms) ───
    statusLabel.textContent = 'FRAGMENTING IDENTITY...';
    const chunkLen = Math.ceil(email.length / 3);
    const chunks = [email.slice(0, chunkLen), email.slice(chunkLen, chunkLen * 2), email.slice(chunkLen * 2)];
    const shardEls = chunks.map(c => {
        const span = document.createElement('span');
        span.className = 'shard';
        span.textContent = c;
        shatter.appendChild(span);
        return span;
    });
    await delay(200);

    // ─── Phase 2: Network Build + Shard Flight (700-1700ms) ───
    statusLabel.textContent = 'DISTRIBUTING SHARDS TO MPC CLUSTER...';

    // Draw servers
    servers.forEach(s => {
        const box = drawIsoBox(s.pos[0], s.pos[1], s.color, 1, s.label);
        box.style.opacity = '0';
        box.style.transition = 'opacity 0.4s';
        nodesG.appendChild(box);
        requestAnimationFrame(() => { box.style.opacity = '1'; });
    });
    // Draw mail server (smaller)
    const mailBox = drawIsoBox(mailServer.pos[0], mailServer.pos[1], mailServer.color, 0.7, mailServer.label);
    mailBox.style.opacity = '0';
    mailBox.style.transition = 'opacity 0.4s';
    nodesG.appendChild(mailBox);
    requestAnimationFrame(() => { mailBox.style.opacity = '1'; });

    await delay(300);

    // Shards fly toward their server by translating
    const svgRect = document.getElementById('mcp-graph')!.getBoundingClientRect();

    shardEls.forEach((el, i) => {
        const elRect = el.getBoundingClientRect();
        const serverPos = servers[i].pos;
        const svgScaleX = svgRect.width / 600;
        const svgScaleY = svgRect.height / 400;
        const targetScreenX = svgRect.left + serverPos[0] * svgScaleX;
        const targetScreenY = svgRect.top + serverPos[1] * svgScaleY;
        const dx = targetScreenX - (elRect.left + elRect.width / 2);
        const dy = targetScreenY - (elRect.top + elRect.height / 2);
        el.style.transform = `translate(${dx}px, ${dy}px) scale(0.15)`;
        el.style.opacity = '0';
    });

    await delay(700);

    // ─── Phase 3: Traffic (2200-3700ms) ───
    statusLabel.textContent = 'INTER-NODE KEY EXCHANGE...';

    // Build routes between all nodes
    const allNodes = [...servers.map(s => s.pos), mailServer.pos];
    const routeColors = ['#4ecdc4', '#45b7d1', '#96ceb4', '#e74c3c', '#f39c12', '#9b59b6'];
    interface Route { from: [number,number]; to: [number,number]; color: string; cp: [number,number]; }
    const routes: Route[] = [];
    let colorIdx = 0;
    for (let i = 0; i < allNodes.length; i++) {
        for (let j = i + 1; j < allNodes.length; j++) {
            const cpX = (allNodes[i][0] + allNodes[j][0]) / 2 + (Math.random() - 0.5) * 60;
            const cpY = (allNodes[i][1] + allNodes[j][1]) / 2 + (Math.random() - 0.5) * 60;
            routes.push({
                from: allNodes[i], to: allNodes[j],
                color: routeColors[colorIdx % routeColors.length],
                cp: [cpX, cpY],
            });
            colorIdx++;
        }
    }

    // Draw dashed bezier curves
    const curveEls: SVGElement[] = [];
    routes.forEach(r => {
        const path = svgEl('path', {
            d: `M ${r.from[0]},${r.from[1]} Q ${r.cp[0]},${r.cp[1]} ${r.to[0]},${r.to[1]}`,
            class: 'traffic-line',
            stroke: r.color,
        });
        edgesG.appendChild(path);
        curveEls.push(path);
    });

    // 3 waves of animated dots
    for (let wave = 0; wave < 3; wave++) {
        const dotPromises = routes.map(r =>
            animateDotOnCurve(r.from, r.cp, r.to, r.color, 400, packetsG)
        );
        await Promise.all(dotPromises);
        await delay(100);
    }

    await delay(200);

    // ─── Phase 4: Convergence (3700-4700ms) ───
    statusLabel.textContent = 'CONVERGING PROOF STREAMS...';

    // Clear traffic lines
    curveEls.forEach(el => el.remove());
    packetsG.innerHTML = '';

    // Draw beams from each MPC server to focal point
    const beamColors = ['#4ecdc4', '#45b7d1', '#96ceb4'];
    servers.forEach((s, i) => {
        const beam = svgEl('line', {
            x1: s.pos[0].toString(), y1: s.pos[1].toString(),
            x2: focalPoint[0].toString(), y2: focalPoint[1].toString(),
            stroke: beamColors[i], class: 'convergence-beam',
            filter: 'url(#glow-blue)',
        });
        convergenceG.appendChild(beam);
        requestAnimationFrame(() => beam.classList.add('animate'));
    });

    await delay(800);

    // White flash + shockwave ring at focal point
    const flash = svgEl('circle', {
        cx: focalPoint[0].toString(), cy: focalPoint[1].toString(),
        r: '0', fill: 'white', opacity: '0.9', filter: 'url(#glow-white)',
    });
    convergenceG.appendChild(flash);

    const ring = svgEl('circle', {
        cx: focalPoint[0].toString(), cy: focalPoint[1].toString(),
        r: '0', fill: 'none', stroke: '#4ecdc4', 'stroke-width': '2', opacity: '0.7',
    });
    convergenceG.appendChild(ring);

    // Animate flash & ring manually
    const flashStart = performance.now();
    const animateFlash = (now: number) => {
        const t = Math.min((now - flashStart) / 500, 1);
        flash.setAttribute('r', (t * 40).toString());
        flash.setAttribute('opacity', (0.9 * (1 - t)).toString());
        ring.setAttribute('r', (t * 60).toString());
        ring.setAttribute('opacity', (0.7 * (1 - t)).toString());
        ring.setAttribute('stroke-width', (2 + t * 3).toString());
        if (t < 1) requestAnimationFrame(animateFlash);
    };
    requestAnimationFrame(animateFlash);

    await delay(500);

    // ─── Phase 5: Console Fold (4700-5400ms) ───
    statusLabel.textContent = 'IDENTITY VERIFIED';
    statusLabel.style.color = 'rgba(120, 255, 180, 0.95)';

    await delay(200);

    panel.classList.remove('unfolding');
    panel.classList.add('folding');

    await delay(700);

    // Cleanup
    loading.style.display = 'none';
    panel.classList.remove('folding');
    shatter.innerHTML = '';
    nodesG.innerHTML = '';
    edgesG.innerHTML = '';
    packetsG.innerHTML = '';
    convergenceG.innerHTML = '';
    statusLabel.textContent = '';
    statusLabel.style.color = '';

    return true;
};

document.getElementById('create-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    const btn = document.getElementById('create-btn') as HTMLButtonElement;
    btn.textContent = 'COMMITTED';
    btn.style.opacity = '0.6';
    btn.style.pointerEvents = 'none';
    setTimeout(() => dismissCurrentView(), 800);
});

document.getElementById('request-code-btn')?.addEventListener('click', async () => {
    const emailInput = document.getElementById('signer-email') as HTMLInputElement;
    const email = emailInput.value;
    if (!email.includes('@')) { emailInput.style.borderColor = 'var(--accent)'; return; }
    await triggerMcpAnimation(email);
    document.getElementById('step-identity')!.classList.remove('active');
    document.getElementById('step-otp')!.classList.add('active');
});

// OTP digit island auto-advance
document.querySelectorAll('.otp-island').forEach((input, idx, all) => {
    const el = input as HTMLInputElement;
    el.addEventListener('input', () => {
        if (el.value.length === 1 && idx < all.length - 1) {
            (all[idx + 1] as HTMLInputElement).focus();
        }
    });
    el.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Backspace' && el.value === '' && idx > 0) {
            (all[idx - 1] as HTMLInputElement).focus();
        }
    });
    // Allow paste of full code
    el.addEventListener('paste', (e: ClipboardEvent) => {
        const data = e.clipboardData?.getData('text') || '';
        if (data.length >= 6) {
            e.preventDefault();
            all.forEach((inp, i) => { (inp as HTMLInputElement).value = data[i] || ''; });
            (all[all.length - 1] as HTMLInputElement).focus();
        }
    });
});

document.getElementById('verify-code-btn')?.addEventListener('click', () => {
    document.getElementById('step-otp')!.classList.remove('active');
    document.getElementById('step-eligible')!.classList.add('active');
    loadEligiblePetitions();
});

const loadEligiblePetitions = () => {
    const listEl = document.getElementById('petition-list')!;
    listEl.innerHTML = `<div class="petition-item"><strong>Permanent Remote Work</strong><button class="primary small" id="final-select">Sign</button></div>`;
    document.getElementById('final-select')?.addEventListener('click', () => {
        document.getElementById('step-eligible')!.classList.remove('active');
        document.getElementById('step-signature')!.classList.add('active');
        initGalaxyShader('galaxy-canvas');
        pen = new SignaturePen('pen-container');
    });
};

const sigInput = document.getElementById('signature-input') as HTMLInputElement;
const galaxyContainer = document.getElementById('galaxy-canvas')!;

sigInput?.addEventListener('input', () => {
    if (pen) pen.updatePosition(Math.min(sigInput.value.length / 20, 1));
    if (sigInput.value.length > 0) spawnMathInk();
});

const spawnMathInk = () => {
    const equation = getMathEquation();
    const ink = document.createElement('div');
    ink.className = 'math-ink';
    ink.textContent = equation;
    const x = 30 + Math.random() * 40;
    const y = 40 + Math.random() * 20;
    ink.style.cssText = `position: absolute; left: ${x}%; top: ${y}%; font-family: monospace; font-size: 0.8rem; color: var(--accent); opacity: 0; pointer-events: none; z-index: 1000; text-shadow: 0 0 10px var(--accent); transition: all 2s ease-out;`;
    galaxyContainer.appendChild(ink);
    setTimeout(() => { ink.style.opacity = "0.8"; ink.style.transform = `translateY(-50px) scale(1.2)`; }, 10);
    setTimeout(() => { ink.style.opacity = "0"; setTimeout(() => ink.remove(), 2000); }, 1500);
};

document.getElementById('finalize-sign-btn')?.addEventListener('click', () => {
    const step = document.getElementById('step-signature')!;
    step.innerHTML = `
        <div style="text-align:center; padding:2rem 0;">
            <svg viewBox="0 0 50 50" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" style="width:64px;height:64px;margin-bottom:1rem;color:#27ae60;">
                <path stroke="currentColor" opacity=".3" d="m16.667 25l6.25 6.25l10.416-10.417"/>
                <path stroke="currentColor" d="M25 43.75c10.355 0 18.75-8.395 18.75-18.75S35.355 6.25 25 6.25S6.25 14.645 6.25 25S14.645 43.75 25 43.75"/>
            </svg>
            <h2>Signature Cast</h2>
            <p style="color:rgba(255,255,255,0.6);">Your identity shards have been distributed across the MPC cluster.</p>
        </div>
    `;
    setTimeout(() => dismissCurrentView(), 2000);
});

// Sign-view mini petition carousel
const signState = { petitionId: null as string | null, skipVerify: false };

const signCategories = [
    { id: 'p1', title: 'Leadership Accountability', tint: 'tint-red' },
    { id: 'p2', title: 'Permanent Remote Work', tint: 'tint-blue' },
    { id: 'p3', title: 'Climate Transparency', tint: 'tint-green' },
    { id: 'p4', title: 'Open Source Mandate', tint: 'tint-purple' },
];

const generateSignCarousel = () => {
    const container = document.getElementById('sign-carousel-container');
    if (!container) return;
    const track = document.getElementById('sign-carousel-track');
    if (!track) return;
    track.innerHTML = '';

    const buildMiniCards = (parent: HTMLElement) => {
        signCategories.forEach(cat => {
            const card = document.createElement('div');
            card.className = `sign-card fluted-glass ${cat.tint}`;
            card.dataset.petitionId = cat.id;
            card.innerHTML = `<h3 class="sign-card-title">${cat.title}</h3><span class="demo-mini">DEMO</span>`;
            card.addEventListener('click', () => selectSignPetition(cat.id, false));
            parent.appendChild(card);
        });

        // Under Construction card — allows signing without verification
        const wip = document.createElement('div');
        wip.className = 'sign-card wip-card';
        wip.dataset.petitionId = 'wip';
        wip.innerHTML = `<h3 class="sign-card-title" style="color:rgba(255,255,255,0.35);">Under Construction</h3><span class="skip-badge">SIGN WITHOUT VERIFY</span>`;
        wip.addEventListener('click', () => selectSignPetition('wip', true));
        parent.appendChild(wip);
    };

    // Build twice for seamless loop
    buildMiniCards(track);
    buildMiniCards(track);
};

const selectSignPetition = (id: string, bypass: boolean) => {
    signState.petitionId = id;
    signState.skipVerify = bypass;

    // Highlight selected card
    document.querySelectorAll('.sign-card').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll(`.sign-card[data-petition-id="${id}"]`).forEach(c => c.classList.add('selected'));

    // Update the petition tab
    updatePetitionTab();

    if (bypass) {
        // Skip straight to signature step
        document.querySelectorAll('.sign-step').forEach(s => s.classList.remove('active'));
        document.getElementById('step-signature')!.classList.add('active');
        initGalaxyShader('galaxy-canvas');
        pen = new SignaturePen('pen-container');
    }
};

// ── Petition tab ─────────────────────────────────────────────────────────────

const petitionTab = document.getElementById('petition-tab')!;

const petitionNames: Record<string, string> = {
    p1: 'Leadership Accountability',
    p2: 'Permanent Remote Work',
    p3: 'Climate Transparency',
    p4: 'Open Source Mandate',
    wip: 'Under Construction',
};

const updatePetitionTab = () => {
    const name = signState.petitionId ? petitionNames[signState.petitionId] || signState.petitionId : null;
    if (name && currentViewId === 'sign') {
        petitionTab.textContent = '';
        const dot = document.createElement('span');
        dot.className = 'tab-dot';
        petitionTab.appendChild(dot);
        petitionTab.appendChild(document.createTextNode(name));
        petitionTab.classList.add('visible');
    } else {
        petitionTab.classList.remove('visible');
    }
};

// Open sign view with a specific petition pre-selected
const openSignWithPetition = (petitionId: string) => {
    showView('sign');
    // After carousel is built, select the petition
    setTimeout(() => selectSignPetition(petitionId, petitionId === 'wip'), 50);
    updatePetitionTab();
};

// Clicking the petition tab could expand to petition detail (for now, no-op)
petitionTab.addEventListener('click', () => {
    if (signState.petitionId && signState.petitionId !== 'wip') {
        showView('petition');
    }
});

// ── Init ─────────────────────────────────────────────────────────────────────

generateBentoGrid();

// Debug toggle button
document.getElementById('debug-toggle-btn')?.addEventListener('click', () => mpcTerminal.toggle());

// Auto-open sign view with "Under Construction" petition for debugging
setTimeout(() => openSignWithPetition('wip'), 100);

// ── Old amphibian on the ledge ───────────────────────────────────────────────

const amphibianEl = document.getElementById('amphibian-helper')!;

const showAmphibian = () => { amphibianEl.classList.add('visible'); };
const hideAmphibian = () => { amphibianEl.classList.remove('visible'); };
const resetAmphibianTimer = () => {
    if (currentViewId === 'sign') showAmphibian();
    else hideAmphibian();
};

console.log("Freehold: High-Integrity Dashboard Active.");
