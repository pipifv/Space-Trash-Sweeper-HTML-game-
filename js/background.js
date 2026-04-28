// ======================= Background Rings Interaction (硬件加速版) =======================
const ringWrappers = document.querySelectorAll('.ring-wrapper');
let ringMouseX = window.innerWidth / 2;
let ringMouseY = window.innerHeight / 2;
let ringCurrX = window.innerWidth / 2;
let ringCurrY = window.innerHeight / 2;

window.addEventListener('mousemove', (e) => {
    ringMouseX = e.clientX; ringMouseY = e.clientY;
});

function animateBgRings() {
    // 核心优化：仅当主菜单可见时才进行运算，节省后台游戏时的 CPU/GPU 开销
    if (!document.getElementById('overlay').classList.contains('hidden')) {
        ringCurrX += (ringMouseX - ringCurrX) * 0.05;
        ringCurrY += (ringMouseY - ringCurrY) * 0.05;

        // 核心优化：修改外层 wrapper 的 transform 彻底避免浏览器重排 (reflow)
        ringWrappers.forEach((wrapper, index) => {
            const depthFactor = (index + 1) * 2;
            const tx = (ringCurrX - window.innerWidth / 2) / depthFactor;
            const ty = (ringCurrY - window.innerHeight / 2) / depthFactor;
            wrapper.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
        });
    }
    requestAnimationFrame(animateBgRings);
}
animateBgRings();
