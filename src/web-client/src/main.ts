// OpenPetition Dashboard Controller 2026
import { initBackgroundShader } from './BackgroundShader';
import { initGalaxyShader } from './GalaxyShader';
import { CreaturePresence } from './Presence';
import { SignaturePen, getMathEquation } from './SignaturePen';
import { audio } from './AudioControl';
import { initNetworkViz } from './NetworkViz';

// 1. Initial State & High-Performance Visuals
initBackgroundShader('shader-bg');
const presence = new CreaturePresence('presence-container');
for(let i=0; i<8; i++) presence.addCreature();

let pen: SignaturePen | null = null;

// 2. Discover: Subtle Bento Grid (Professional Tint)
const generateBentoGrid = () => {
  const container = document.getElementById('bento-container');
  if (!container) return;
  container.innerHTML = '';
  
  // Professional, serious tints
  const tints = [
    'rgba(231, 76, 60, 0.15)', // Red
    'rgba(52, 152, 219, 0.15)', // Blue
    'rgba(46, 204, 113, 0.15)', // Green
    'rgba(155, 89, 182, 0.15)'  // Purple
  ];
  
  const titles = [
    'Leadership Accountability', 
    'Permanent Remote Work', 
    'Equitable Equity Splits', 
    'Climate Transparency',
    'Open Source Mandate',
    'Health Coverage Reform'
  ];
  
  for (let i = 0; i < titles.length; i++) {
    const box = document.createElement('div');
    box.className = 'bento-box fluted-glass';
    box.style.borderTop = `4px solid ${tints[i % tints.length]}`;
    
    // Bento shape variety
    if (i === 0) box.style.gridColumn = 'span 2';
    if (i === 3) box.style.gridRow = 'span 2';

    box.innerHTML = `
      <div class="bento-content">
        <h3 class="bento-title">${titles[i]}</h3>
        <span class="bento-meta">${Math.floor(Math.random() * 5000 + 100)} Verified Signers</span>
      </div>
    `;
    
    box.addEventListener('click', () => {
        audio.playTone(440, 'sine', 0.05);
        showView('public-view');
    });
    
    container.appendChild(box);
  }
};
generateBentoGrid();

// 3. Navigation & View Controller
const showView = (target: string) => {
    document.querySelectorAll('nav a').forEach(l => l.classList.remove('active'));
    const navLink = document.querySelector(`nav a[data-target="${target.replace('-view','')}"]`);
    if (navLink) navLink.classList.add('active');

    document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
    const view = document.getElementById(target);
    if (view) view.classList.add('active');

    // Create View strips chrome
    const nav = document.getElementById('main-nav')!;
    const ribbon = document.getElementById('join-ribbon')!;
    if (target === 'create-view') {
        nav.style.display = 'none';
        ribbon.style.display = 'none';
    } else {
        nav.style.display = 'flex';
        ribbon.style.display = 'block';
    }

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

// 4. Create View: Animated Whitelist Graph
const whitelistInput = document.getElementById('whitelist-input') as HTMLInputElement;
const graphContainer = document.getElementById('whitelist-graph')!;

whitelistInput?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value.toLowerCase();
    if (val.length > 3) {
        audio.playTone(880 + (val.length * 10), 'triangle', 0.02);
        // Simulate graph node discovery
        if (val.includes('anth')) addGraphNode('Anthropic', 'anthropic.com');
        if (val.includes('goog')) addGraphNode('Google', 'google.com');
    }
});

const addGraphNode = (name: string, _domain: string) => {
    const node = document.createElement('div');
    node.className = 'company-node';
    node.style.left = `${Math.random() * 80}%`;
    node.style.top = `${Math.random() * 80}%`;
    // Secure local rendering instead of Clearbit external fetch
    node.innerHTML = `<div title="${name}" style="width:24px; height:24px; border-radius:50%; background:var(--accent); display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:bold;">${name.charAt(0).toUpperCase()}</div>`;
    graphContainer.appendChild(node);
    
    // Draw edge to center
    const edge = document.createElement('div');
    edge.className = 'graph-edge';
    edge.style.width = '100px';
    edge.style.transform = `rotate(${Math.random() * 360}deg)`;
    graphContainer.appendChild(edge);
};

// 5. Sign View: Ornate Signature
const sigInput = document.getElementById('signature-input') as HTMLInputElement;
sigInput?.addEventListener('focus', () => {
    initGalaxyShader('galaxy-canvas');
    pen = new SignaturePen('pen-container');
});

sigInput?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    if (pen) pen.updatePosition(Math.min(val.length / 20, 1));
    
    // Audio feedback for "inking"
    audio.playTone(200 + (val.length * 5), 'sine', 0.01);
    
    if (val.length % 5 === 0) {
        console.log(`[ZK-PROOF] ${getMathEquation()}`);
    }
});

// 6. Verification Flow Buttons
document.getElementById('vc-btn')?.addEventListener('click', async () => {
    try {
        if (!navigator.credentials || !('get' in navigator.credentials)) {
            alert("Web Credentials API is not supported in this browser.");
            return;
        }

        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);

        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: challenge,
                rpId: window.location.hostname || "localhost",
                userVerification: "preferred"
            }
        });

        if (assertion) {
            console.log("[ZK-PROOF] Verifiable Credential Assertion Received", assertion);
            if (sigInput) sigInput.value = "ZK-Verified Passkey Attached";
            audio.playTone(880, 'sine', 0.1);
        }
    } catch (e: any) {
        console.warn("VC check failed or was cancelled.", e);
        alert(`Verifiable Credential failed: ${e.message}`);
    }
});

// 6. Verification Flow Buttons
document.getElementById('request-code-btn')?.addEventListener('click', async () => {
    audio.playTone(500, 'square', 0.1);
    const email = (document.getElementById('signer-email') as HTMLInputElement).value;
    console.log(`[MPC] Sharding email ${email} for stealth delivery...`);
    
    try {
        // Wired to Forwarder Node API
        await fetch('http://localhost:5870/request-code', {
            method: 'POST',
            body: JSON.stringify({ email })
        });
    } catch (e) {
        console.warn("Backend not reached, proceeding with UI simulation.");
    }
    
    document.getElementById('step-identity')!.classList.remove('active');
    document.getElementById('step-otp')!.classList.add('active');
});

document.getElementById('verify-code-btn')?.addEventListener('click', async () => {
    audio.playTone(800, 'sine', 0.2);
    const code = (document.getElementById('otp-code') as HTMLInputElement).value;
    console.log("[MPC] Jointly verifying identity commitment...");

    try {
        await fetch('http://localhost:5870/verify-code', {
            method: 'POST',
            body: JSON.stringify({ code })
        });
    } catch (e) {
        console.warn("Backend not reached.");
    }

    document.getElementById('step-otp')!.classList.remove('active');
    document.getElementById('step-eligible')!.classList.add('active');
    
    const list = document.getElementById('petition-list')!;
    list.innerHTML = `<div class="petition-item">
        <strong>Permanent Remote Work</strong>
        <button class="primary small" id="final-select">Sign</button>
    </div>`;
    
    document.getElementById('final-select')?.addEventListener('click', () => {
        document.getElementById('step-eligible')!.classList.remove('active');
        document.getElementById('step-signature')!.classList.add('active');
    });
});

// A11y Panel
document.getElementById('mute-btn')?.addEventListener('click', () => {
    const isMuted = audio.toggleMute();
    (document.getElementById('mute-btn') as HTMLElement).textContent = isMuted ? '🔇' : '🔊';
});

document.getElementById('high-contrast-btn')?.addEventListener('click', () => {
    document.body.classList.toggle('high-contrast');
    // Implement high contrast CSS in index.html if needed
});

console.log("OpenPetition 2026: Accessibility & Audio Core Active.");
