// ======================= 音效系统 =======================
const SFX = {
    ctx: null, masterGain: null, bgmTimer: null, heartbeat: null, lowpassFilter: null, heartbeatGain: null, bgmPlaying: false, heartbeatInitialized: false,
    init() {
        if(!this.ctx && window.AudioContext) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = CONFIG.BGM_VOLUME;
            this.masterGain.connect(this.ctx.destination);

            this.lowpassFilter = this.ctx.createBiquadFilter(); this.lowpassFilter.type = 'lowpass';
            this.lowpassFilter.frequency.value = 2000; this.lowpassFilter.connect(this.masterGain);
            this.initHeartbeat();
        }
        if(this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        this.initBGM();
    },
    initBGM() {
        if (!this.ctx || this.bgmPlaying) return;
        this.bgmPlaying = true; this.nextNoteTime = this.ctx.currentTime + 0.1; this.currentStep = 0;
        const schedule = () => {
            if(!this.bgmPlaying || this.ctx.state === 'suspended') return;
            while (this.nextNoteTime < this.ctx.currentTime + 0.15) {
                this.playSynthStep(this.currentStep, this.nextNoteTime);
                this.nextNoteTime += 0.13; this.currentStep = (this.currentStep + 1) % 16;
            }
            this.bgmTimer = setTimeout(schedule, 30);
        };
        schedule();
    },
    stopBGM() {
        this.bgmPlaying = false;
        if(this.bgmTimer) { clearTimeout(this.bgmTimer); this.bgmTimer=null; }
    },
    playSynthStep(step, time) {
        if (step % 4 === 0) {
            const o = this.ctx.createOscillator(), g = this.ctx.createGain();
            o.type = 'sine'; o.frequency.setValueAtTime(150, time); o.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
            g.gain.setValueAtTime(0.4, time); g.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
            o.connect(g); g.connect(this.lowpassFilter); o.start(time); o.stop(time + 0.5);
        }
        const bass = [55, 0, 55, 0, 65.4, 0, 65.4, 0, 73.4, 73.4, 0, 0, 55, 0, 82.4, 0];
        if (bass[step] > 0) {
            const o = this.ctx.createOscillator(), g = this.ctx.createGain();
            o.type = 'sawtooth'; o.frequency.setValueAtTime(bass[step], time);
            g.gain.setValueAtTime(0.15, time); g.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
            o.connect(g); g.connect(this.lowpassFilter); o.start(time); o.stop(time + 0.15);
        }
        const melody = [330, 0, 392, 0, 440, 0, 392, 0, 523.25, 0, 440, 0, 392, 0, 330, 0];
        if (melody[step] > 0) {
            const o = this.ctx.createOscillator(), g = this.ctx.createGain();
            o.type = 'square'; o.frequency.setValueAtTime(melody[step], time);
            g.gain.setValueAtTime(0.05, time); g.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
            o.connect(g); g.connect(this.lowpassFilter); o.start(time); o.stop(time + 0.2);
        }
    },
    initHeartbeat() {
        if (this.heartbeatInitialized) return;
        this.heartbeatInitialized = true;
        this.heartbeat = this.ctx.createOscillator(); this.heartbeat.type = 'sine'; this.heartbeat.frequency.value = 80;
        this.heartbeatGain = this.ctx.createGain(); this.heartbeatGain.gain.value = 0;
        this.heartbeat.connect(this.heartbeatGain); this.heartbeatGain.connect(this.masterGain);
        this.heartbeat.start();
        setInterval(() => {
            if(this.heartbeatGain.gain.value === 0) return;
            this.heartbeatGain.gain.setValueAtTime(0.1, this.ctx.currentTime);
            this.heartbeatGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
        }, 800);
    },
    enableLowHealthAudio() { if(!this.ctx) return; this.lowpassFilter.frequency.value = 500; if(this.heartbeatGain) this.heartbeatGain.gain.value = 0.1; },
    disableLowHealthAudio() { if(!this.ctx) return; this.lowpassFilter.frequency.value = 2000; if(this.heartbeatGain) this.heartbeatGain.gain.value = 0; },
    play(f, t, d, v=0.1) {
        if(!this.ctx || this.ctx.state === 'suspended') return;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = t; o.frequency.setValueAtTime(f, this.ctx.currentTime); o.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + d);
        g.gain.setValueAtTime(v, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + d);
        o.connect(g); g.connect(this.masterGain); o.start(); o.stop(this.ctx.currentTime + d);
    },
    shoot() { this.play(1200, 'square', 0.15, 0.05); },
    hitObj() { this.play(100, 'sawtooth', 0.4, 0.2); },
    rockExplode() { this.play(80, 'sawtooth', 0.6, 0.3); },
    takeDamage() { this.play(80, 'square', 0.6, 0.3); },
    getGold() { this.play(2000, 'sine', 0.3, 0.1); },
    getPower() { this.play(800, 'triangle', 0.8, 0.1); },
    getDouble() { this.play(1500, 'triangle', 0.6, 0.15); },
    bulletTime() { this.play(440, 'sine', 1.0, 0.1); },
    graze() { this.play(1760, 'sine', 0.5, 0.1); },
    crazyGraze() { this.play(2500, 'square', 0.6, 0.15); },
    coreString() { this.play(1320, 'sine', 0.8, 0.1); },
    glassShatter() { this.play(660, 'sawtooth', 1.2, 0.2); },
    rampage() { this.play(300, 'sawtooth', 3.0, 0.3); },
    mineExplosion() { this.play(60, 'sawtooth', 1.5, 0.4); },
    laserHum() { this.play(120, 'square', 0.3, 0.2); },
    droneSpawn() { this.play(400, 'triangle', 0.4, 0.15); },
    rankUp() { this.play(440, 'sine', 0.3, 0.1); setTimeout(() => { if (this.ctx && this.ctx.state !== 'closed') { this.play(554, 'sine', 0.3, 0.1); } }, 80); setTimeout(() => { if (this.ctx && this.ctx.state !== 'closed') { this.play(659, 'sine', 0.3, 0.1); } }, 160); setTimeout(() => { if (this.ctx && this.ctx.state !== 'closed') { this.play(880, 'sine', 0.3, 0.15); } }, 240); },
    synergyUnlock() { this.play(523, 'triangle', 0.5, 0.2); setTimeout(() => { if (this.ctx && this.ctx.state !== 'closed') { this.play(659, 'triangle', 0.5, 0.2); } }, 100); setTimeout(() => { if (this.ctx && this.ctx.state !== 'closed') { this.play(784, 'triangle', 0.6, 0.3); } }, 200); },
    waveStart() { this.play(220, 'sawtooth', 0.8, 0.3); setTimeout(() => { if (this.ctx && this.ctx.state !== 'closed') { this.play(330, 'sawtooth', 0.6, 0.2); } }, 150); },
    warning() { this.play(880, 'square', 0.3, 0.1); },
    bossWarning() { this.play(55, 'sawtooth', 2.0, 0.5); },
    bossDefeat() { this.play(330, 'triangle', 1.0, 0.2); setTimeout(() => { if (this.ctx && this.ctx.state !== 'closed') { this.play(440, 'triangle', 1.0, 0.2); } }, 150); setTimeout(() => { if (this.ctx && this.ctx.state !== 'closed') { this.play(554, 'triangle', 1.0, 0.3); } }, 300); setTimeout(() => { if (this.ctx && this.ctx.state !== 'closed') { this.play(880, 'triangle', 1.2, 0.5); } }, 450); }
};
