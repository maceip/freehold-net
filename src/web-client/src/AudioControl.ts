// Audio Control Utility
class AudioController {
  private static instance: AudioController;
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted: boolean = false;

  private constructor() {
    this.init();
  }

  static getInstance() {
    if (!AudioController.instance) AudioController.instance = new AudioController();
    return AudioController.instance;
  }

  private init() {
    // Only init on user interaction to satisfy browser policy
    const startAudio = () => {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.connect(this.audioCtx.destination);
        this.masterGain.gain.value = 0.3;
      }
      window.removeEventListener('click', startAudio);
      window.removeEventListener('keydown', startAudio);
    };
    window.addEventListener('click', startAudio);
    window.addEventListener('keydown', startAudio);
  }

  public playTone(freq: number, type: OscillatorType = 'sine', duration: number = 0.1) {
    if (!this.audioCtx || !this.masterGain || this.isMuted) return;
    
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
    
    gain.gain.setValueAtTime(this.masterGain.gain.value, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start();
    osc.stop(this.audioCtx.currentTime + duration);
  }

  public toggleMute() {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }
  
  public setVolume(val: number) {
    if (this.masterGain) this.masterGain.gain.value = val;
  }
}

export const audio = AudioController.getInstance();
