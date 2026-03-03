// Freehold Dashboard Controller 2026
import { initBackgroundShader } from './BackgroundShader';
import { initGalaxyShader } from './GalaxyShader';
import { SignaturePen, getMathEquation } from './SignaturePen';
import { initNetworkViz } from './NetworkViz';

// 1. Initial State & Visuals
initBackgroundShader('shader-bg');

let pen: SignaturePen | null = null;
let currentViewId = 'discover';

// 2. Bento Grid Generation (Discover)
const generateBentoGrid = () => {
  const container = document.getElementById('bento-container');
  if (!container) return;
  container.innerHTML = '';
  
  const categories = [
    { id: 'p1', title: 'Leadership Accountability', icon: '<svg class="marketeq-icon icon-bento" viewBox="0 0 24 24" fill="none"><path class="primary" d="M12 22s8-4 8-10V5l-8-3l-8 3v7c0 6 8 10 8 10Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path class="secondary" d="M12 2v20M2 12h20M12 2c3.314 0 6 4.477 6 10s-2.686 10-6 10s-6-4.477-6-10s2.686-10 6-10Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>', tint: 'tint-red' },
    { id: 'p2', title: 'Permanent Remote Work', icon: '<svg class="marketeq-icon icon-bento" viewBox="0 0 24 24" fill="none"><path class="primary" d="m3 9l9-7l9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Zm6 13V12h6v10" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>', tint: 'tint-blue' },
    { id: 'p3', title: 'Climate Transparency', icon: '<svg class="marketeq-icon icon-bento" viewBox="0 0 24 24" fill="none"><path class="primary" d="M12 22c0-5.523 4.477-10 10-10c5.523 0 10 4.477 10 10M2 22h20m-10-10V2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>', tint: 'tint-green' },
    { id: 'p4', title: 'Open Source Mandate', icon: '<svg class="marketeq-icon icon-bento" viewBox="0 0 24 24" fill="none"><path class="primary" d="m16 18l6-6l-6-6M8 6l-6 6l6 6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>', tint: 'tint-purple' }
  ];
  
  const getAvatarStack = () => `
    <div style="display:flex; margin-bottom:1rem;">
      ${[1,2,3,4].map(i => `<div style="width:28px; height:28px; border-radius:50%; background:var(--foreground-faint); border:2px solid #fff; margin-left:${i===1?0:-10}px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:10px; font-weight:900; backdrop-filter:blur(5px);">${String.fromCharCode(64+i)}</div>`).join('')}
    </div>
  `;

  const getSparkline = () => `
    <div style="display:flex; align-items:flex-end; gap:4px; height:40px; margin-top:1rem; width:120px;">
      ${[15,22,30,45,60,85].map((h, i) => `<div style="flex:1; background:rgba(255,255,255,0.15); height:${h}%; border-radius:2px; position:relative; min-width:8px;">${i > 3 ? `<div style="position:absolute; top:-10px; left:50%; transform:translateX(-50%); width:10px; height:10px; border-radius:50%; background:#fff; border:1px solid #aaa;"></div>` : ''}</div>`).join('')}
    </div>
  `;

  categories.forEach((cat, i) => {
    const box = document.createElement('div');
    box.className = `bento-box fluted-glass ${cat.tint}`;
    if (i === 0) box.style.gridColumn = 'span 2';

    box.innerHTML = `
      <div style="position:absolute; top:12px; right:12px; background:#4c1d95; color:#f4f4f5; padding:3px 12px; border-radius:6px; font-size:10px; font-weight:900; letter-spacing:1px; z-index:10; box-shadow: 0 4px 10px rgba(0,0,0,0.2);">DEMO</div>
      <div class="bento-icon">${cat.icon}</div>
      <div class="bento-content" style="max-width:50%; max-height:50%;">
        ${getAvatarStack()}
        <h3 class="bento-title" style="font-size:1.1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${cat.title}</h3>
        ${getSparkline()}
      </div>
    `;
    
    box.addEventListener('click', () => {
        showView('petition');
    });
    
    container.appendChild(box);
  });
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

    if (target === 'join') initNetworkViz('network-3d-viz');
    if (target === 'sign') {
        document.querySelectorAll('.sign-step').forEach(s => s.classList.remove('active'));
        document.getElementById('step-identity')!.classList.add('active');
    }
};

const dismissCurrentView = () => {
    if (currentViewId === 'discover') return;
    const view = document.getElementById(`${currentViewId}-view`);
    if (!view) return;

    view.classList.remove('active-page');
    view.classList.add('dismissing-page');
    document.querySelectorAll('nav a').forEach(l => l.classList.remove('active'));

    setTimeout(() => {
        view.classList.remove('active', 'dismissing-page');
        currentViewId = 'discover';
        document.getElementById('discover-view')!.classList.add('active');
    }, 350);
};

window.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismissCurrentView(); });
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

const triggerMcpAnimation = async (email: string) => {
    const loading = document.getElementById('mcp-loading')!;
    const shatter = document.getElementById('shatter-container')!;
    const nodes = document.getElementById('graph-nodes')!;
    const edges = document.getElementById('graph-edges')!;
    
    loading.style.display = 'flex';
    loading.style.opacity = '1';
    shatter.innerHTML = '';
    nodes.innerHTML = '';
    edges.innerHTML = '';

    const chunkLen = Math.ceil(email.length / 3);
    const chunks = [email.slice(0, chunkLen), email.slice(chunkLen, chunkLen * 2), email.slice(chunkLen * 2)];

    const shardEls = chunks.map(c => {
        const span = document.createElement('span');
        span.className = 'shard';
        span.textContent = c;
        span.style.color = 'var(--regal)';
        shatter.appendChild(span);
        return span;
    });

    const nodePoints: {x: number, y: number, el: SVGElement}[] = [];
    for(let i=0; i<18; i++) {
        const p = { x: Math.random() * 360 + 20, y: Math.random() * 160 + 20 };
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", p.x.toString());
        circle.setAttribute("cy", p.y.toString());
        circle.setAttribute("r", "2.5");
        circle.setAttribute("fill", "#ddd");
        circle.style.transition = "all 0.3s";
        nodes.appendChild(circle);
        nodePoints.push({ ...p, el: circle });
    }

    setTimeout(() => {
        shardEls.forEach((el, i) => {
            const target = nodePoints[i * 5];
            el.style.transform = `translate(${target.x - 200}px, ${target.y + 50}px) scale(0.1) rotate(${Math.random() * 360}deg)`;
            el.style.opacity = '0';
        });
    }, 100);

    for(let i=0; i<30; i++) {
        setTimeout(() => {
            const n1 = nodePoints[Math.floor(Math.random() * nodePoints.length)];
            const n2 = nodePoints[Math.floor(Math.random() * nodePoints.length)];
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", n1.x.toString()); line.setAttribute("y1", n1.y.toString());
            line.setAttribute("x2", n2.x.toString()); line.setAttribute("y2", n2.y.toString());
            line.setAttribute("class", "laser");
            edges.appendChild(line);
            n1.el.setAttribute("fill", "var(--accent)"); n2.el.setAttribute("fill", "var(--accent)");
            n1.el.setAttribute("r", "5"); n2.el.setAttribute("r", "5");
            setTimeout(() => {
                n1.el.setAttribute("fill", "#ddd"); n2.el.setAttribute("fill", "#ddd");
                n1.el.setAttribute("r", "2.5"); n2.el.setAttribute("r", "2.5");
                line.remove();
            }, 500);
        }, i * 80);
    }

    return new Promise(resolve => {
        setTimeout(() => {
            loading.style.opacity = '0';
            setTimeout(() => { loading.style.display = 'none'; resolve(true); }, 600);
        }, 3800);
    });
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

generateBentoGrid();
console.log("Freehold: High-Integrity Dashboard Active.");
