/**
 * FHSpinner — animated logo web component using the actual fh.png badge.
 *
 * The asterisk is a separate overlay so it can spin independently of the rings.
 *
 * States: idle, spinner-1, spinner-2, transition, success, error
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = /* html */ `
<style>
  :host {
    display: inline-block;
    --size: 120px;
  }

  .wrap {
    position: relative;
    width: var(--size);
    height: var(--size);
    transition: transform 0.3s, opacity 0.3s;
  }

  /* ── Base image (rings + yellow center, asterisk hidden by cover) ── */

  .badge {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    overflow: hidden;
  }

  .badge img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    transition: filter 0.5s ease;
  }

  /* Yellow circle that covers the original asterisk in the PNG */
  .asterisk-cover {
    position: absolute;
    /* Tuned to sit exactly over the yellow center + asterisk */
    top: 24%;
    left: 26%;
    width: 48%;
    height: 48%;
    border-radius: 50%;
    background: #f5d528;
    /* Slight radial gradient to match the 3D look of the yellow */
    background: radial-gradient(circle at 45% 40%, #fde74c 0%, #f5d528 50%, #e6c422 100%);
  }

  /* ── Asterisk overlay — independent element ─────────── */

  .asterisk {
    position: absolute;
    top: 24%;
    left: 26%;
    width: 48%;
    height: 48%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: calc(var(--size) * 0.36);
    line-height: 1;
    color: #1a1a1a;
    font-weight: 900;
    font-family: "Arial Black", Arial, sans-serif;
    user-select: none;
    will-change: transform;
    z-index: 2;
  }

  /* ── Color overlay for success/error ────────────────── */

  .color-overlay {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    pointer-events: none;
    opacity: 0;
    mix-blend-mode: color;
    transition: opacity 0.5s ease;
    z-index: 1;
  }

  /* ── Particles for spinner-1 ────────────────────────── */

  .particles {
    position: absolute;
    inset: -20%;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.4s;
    z-index: 3;
  }

  .p {
    position: absolute;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: rgba(100, 90, 60, 0.7);
  }

  /* ── Glow ring for success/error ────────────────────── */

  .glow-ring {
    position: absolute;
    inset: -6%;
    border-radius: 50%;
    pointer-events: none;
    z-index: 0;
    opacity: 0;
    transition: opacity 0.5s ease;
  }

  /* ============================================================
     STATE: spinner-1  — Sonic-style asterisk spin
     ============================================================ */

  :host([state="spinner-1"]) .asterisk {
    animation: sonic-spin 1.6s cubic-bezier(0.16, 1, 0.3, 1) infinite;
  }

  :host([state="spinner-1"]) .particles {
    opacity: 1;
  }

  :host([state="spinner-1"]) .p:nth-child(1) { top: 78%; left: 15%; animation: dust 1s 0.00s ease-out infinite; }
  :host([state="spinner-1"]) .p:nth-child(2) { top: 82%; left: 30%; animation: dust 1s 0.12s ease-out infinite; }
  :host([state="spinner-1"]) .p:nth-child(3) { top: 86%; left: 48%; animation: dust 1s 0.24s ease-out infinite; }
  :host([state="spinner-1"]) .p:nth-child(4) { top: 82%; left: 65%; animation: dust 1s 0.36s ease-out infinite; }
  :host([state="spinner-1"]) .p:nth-child(5) { top: 78%; left: 80%; animation: dust 1s 0.48s ease-out infinite; }
  :host([state="spinner-1"]) .p:nth-child(6) { top: 74%; left: 42%; animation: dust 1s 0.18s ease-out infinite; }

  @keyframes sonic-spin {
    /* Slow start */
    0%   { transform: rotate(0deg) scale(1); }
    10%  { transform: rotate(20deg) scale(1); }
    /* Accelerating */
    30%  { transform: rotate(180deg) scale(1.03); }
    /* Full speed */
    50%  { transform: rotate(540deg) scale(1.05); }
    /* Vibrate at peak */
    55%  { transform: rotate(630deg) translateX(2px) scale(1.04); }
    58%  { transform: rotate(680deg) translateX(-2.5px) translateY(1px) scale(1.04); }
    61%  { transform: rotate(730deg) translateX(2px) translateY(-1.5px) scale(1.03); }
    64%  { transform: rotate(790deg) translateX(-1.5px) scale(1.03); }
    67%  { transform: rotate(850deg) translateX(1px) translateY(1px) scale(1.02); }
    /* Decel */
    80%  { transform: rotate(1100deg) scale(1.01); }
    100% { transform: rotate(1440deg) scale(1); }
  }

  @keyframes dust {
    0%   { transform: translateY(0) scale(0.8); opacity: 0; }
    20%  { opacity: 0.9; }
    60%  { transform: translateY(-20px) translateX(-5px) scale(1.6); opacity: 0.4; }
    100% { transform: translateY(-40px) translateX(-10px) scale(0.4); opacity: 0; }
  }

  /* ============================================================
     STATE: spinner-2  — Calming ring brightness pulse
     ============================================================ */

  :host([state="spinner-2"]) .badge img {
    animation: ring-breathe 2.8s ease-in-out infinite;
  }

  :host([state="spinner-2"]) .asterisk-cover {
    animation: center-breathe 2.8s ease-in-out infinite;
  }

  :host([state="spinner-2"]) .glow-ring {
    opacity: 1;
    background: radial-gradient(circle, transparent 45%, rgba(41, 98, 255, 0.15) 70%, rgba(211, 47, 47, 0.15) 100%);
    animation: glow-breathe 2.8s ease-in-out infinite;
  }

  @keyframes ring-breathe {
    0%, 100% { filter: brightness(1) saturate(1); }
    50%      { filter: brightness(1.45) saturate(1.25); }
  }

  @keyframes center-breathe {
    0%, 100% { filter: brightness(1); }
    50%      { filter: brightness(1.3); }
  }

  @keyframes glow-breathe {
    0%, 100% { opacity: 0.3; transform: scale(1); }
    50%      { opacity: 0.8; transform: scale(1.06); }
  }

  /* ============================================================
     STATE: transition  — Cartoon poof disappear
     ============================================================ */

  :host([state="transition"]) .wrap {
    animation: poof 0.55s ease-in forwards;
  }

  @keyframes poof {
    0%   { transform: scale(1) rotate(0deg); opacity: 1; filter: blur(0); }
    25%  { transform: scale(1.25) rotate(8deg); opacity: 0.95; filter: blur(0); }
    50%  { transform: scale(0.6) rotate(-5deg); opacity: 0.6; filter: blur(1.5px); }
    75%  { transform: scale(0.15) rotate(15deg); opacity: 0.25; filter: blur(5px); }
    100% { transform: scale(0) rotate(40deg); opacity: 0; filter: blur(10px); }
  }

  /* ============================================================
     STATE: success  — Green glow
     ============================================================ */

  :host([state="success"]) .badge img {
    filter: hue-rotate(90deg) saturate(1.3) brightness(1.1);
  }

  :host([state="success"]) .asterisk-cover {
    background: radial-gradient(circle at 45% 40%, #a5d6a7 0%, #66bb6a 50%, #4caf50 100%);
  }

  :host([state="success"]) .asterisk {
    color: #1b5e20;
  }

  :host([state="success"]) .color-overlay {
    opacity: 0.35;
    background: #4caf50;
  }

  :host([state="success"]) .glow-ring {
    opacity: 1;
    background: radial-gradient(circle, transparent 40%, rgba(76, 175, 80, 0.4) 70%, rgba(76, 175, 80, 0.1) 100%);
    animation: success-pulse 1.6s ease-in-out infinite;
  }

  @keyframes success-pulse {
    0%, 100% { opacity: 0.6; transform: scale(1); }
    50%      { opacity: 1; transform: scale(1.08); }
  }

  /* ============================================================
     STATE: error  — Orange glow
     ============================================================ */

  :host([state="error"]) .badge img {
    filter: hue-rotate(-20deg) saturate(1.6) brightness(1.05);
  }

  :host([state="error"]) .asterisk-cover {
    background: radial-gradient(circle at 45% 40%, #ffe0b2 0%, #ffb74d 50%, #ff9800 100%);
  }

  :host([state="error"]) .asterisk {
    color: #bf360c;
  }

  :host([state="error"]) .color-overlay {
    opacity: 0.4;
    background: #ff9800;
  }

  :host([state="error"]) .glow-ring {
    opacity: 1;
    background: radial-gradient(circle, transparent 40%, rgba(255, 152, 0, 0.4) 70%, rgba(255, 152, 0, 0.1) 100%);
    animation: error-pulse 1.2s ease-in-out infinite;
  }

  @keyframes error-pulse {
    0%, 100% { opacity: 0.5; transform: scale(1); }
    50%      { opacity: 1; transform: scale(1.06); }
  }
</style>

<div class="wrap">
  <div class="glow-ring"></div>
  <div class="badge">
    <img src="/fh.png" alt="FH" />
  </div>
  <div class="asterisk-cover"></div>
  <div class="color-overlay"></div>
  <div class="asterisk">✳</div>
  <div class="particles">
    <div class="p"></div><div class="p"></div><div class="p"></div>
    <div class="p"></div><div class="p"></div><div class="p"></div>
  </div>
</div>
`;

class FHSpinner extends HTMLElement {
  static observedAttributes = ['state', 'size'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.appendChild(TEMPLATE.content.cloneNode(true));
  }

  connectedCallback() {
    this._applySize();
  }

  attributeChangedCallback(name: string, _old: string | null, _val: string | null) {
    if (name === 'size') this._applySize();
  }

  private _applySize() {
    const size = this.getAttribute('size') || '120';
    this.style.setProperty('--size', `${size}px`);
  }

  get state(): string { return this.getAttribute('state') || 'idle'; }
  set state(v: string) { this.setAttribute('state', v); }

  async load()       { this.state = 'spinner-1'; }
  async pulse()      { this.state = 'spinner-2'; }
  async success()    { this.state = 'success'; }
  async error()      { this.state = 'error'; }

  async disappear(): Promise<void> {
    this.state = 'transition';
    return new Promise(resolve => setTimeout(resolve, 600));
  }

  reset(): void {
    this.state = 'idle';
    const wrap = this.shadowRoot!.querySelector('.wrap') as HTMLElement;
    if (wrap) {
      wrap.style.animation = 'none';
      void wrap.offsetHeight;
      wrap.style.animation = '';
      wrap.style.transform = '';
      wrap.style.opacity = '';
      wrap.style.filter = '';
    }
  }
}

customElements.define('fh-spinner', FHSpinner);
export { FHSpinner };
