// ======================= 全局 DOM 缓存系统 =======================
const DOM = {
    overlay: document.getElementById('overlay'),
    panels: document.querySelectorAll('#overlay .panel'),
    hud: document.getElementById('hud'),
    tutorialUI: document.getElementById('tutorial-ui'),
    actionLog: document.getElementById('action-log-container'),
    floatingTexts: document.getElementById('floating-texts'),
    speedLines: document.getElementById('speed-lines'),
    doubleScoreHint: document.getElementById('double-score-hint'),
    missionTimer: document.getElementById('mission-timer'),
    toastContainer: document.getElementById('toast-container'),

    // HUD Stats
    hpVal: document.getElementById('hp-val'),
    shieldFill: document.getElementById('shield-fill'),
    energyVal: document.getElementById('energy-val'),
    energyFill: document.getElementById('energy-fill'),
    overloadVal: document.getElementById('overload-val'),
    overloadFill: document.getElementById('overload-fill'),
    invincibleVal: document.getElementById('invincible-val'),
    invincibleFill: document.getElementById('invincible-fill'),
    comboVal: document.getElementById('combo-val'),
    comboFill: document.getElementById('combo-fill'),

    // Scores
    scoreVal: document.getElementById('score-val'),
    goldVal: document.getElementById('gold-val'),
    modeVal: document.getElementById('mode-val'),

    // Skills
    qSkillFill: document.getElementById('q-skill-fill'),
    eSkillFill: document.getElementById('e-skill-fill'),
    eSkillUI: document.getElementById('e-skill-ui'),
    eSkillText: document.getElementById('e-skill-text'),

    bossHud: document.getElementById('boss-hud'),
    bossName: document.getElementById('boss-name'),
    bossHpFill: document.getElementById('boss-hp-fill')
};
