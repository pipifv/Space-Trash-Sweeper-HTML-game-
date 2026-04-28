// ======================= 游标系统 Target Cursor (深度优化版) =======================
class TargetCursorVanilla {
    constructor() {
        this.cursor = document.getElementById('target-cursor-wrapper');
        this.dot = document.getElementById('target-cursor-dot');
        this.init();
    }

    init() {
        // 在移动设备完全禁用
        if (/Mobi|Android/i.test(navigator.userAgent)) {
            this.cursor.style.display = 'none';
            return;
        }

        gsap.set(this.cursor, { xPercent: -50, yPercent: -50 });

        // 彻底去除高耗能的 DOM 磁吸计算，改为轻量、纯粹的跟随动画
        window.addEventListener('mousemove', (e) => {
            gsap.to(this.cursor, {
                x: e.clientX, y: e.clientY, duration: 0.15, ease: 'power2.out', overwrite: 'auto'
            });
        });

        // 保持极具科幻感的连续自转
        gsap.to(this.cursor, { rotation: 360, duration: 4, repeat: -1, ease: "none" });

        // 清爽的点击反馈
        window.addEventListener('mousedown', () => {
            gsap.to(this.dot, { scale: 0.5, duration: 0.2 });
            gsap.to(this.cursor, { scale: 0.8, duration: 0.2 });
        });
        window.addEventListener('mouseup', () => {
            gsap.to(this.dot, { scale: 1, duration: 0.2 });
            gsap.to(this.cursor, { scale: 1, duration: 0.2 });
        });
    }

    setVisibility(isVisible) {
        if (/Mobi|Android/i.test(navigator.userAgent)) return;
        this.cursor.style.display = isVisible ? 'block' : 'none';
        if (isVisible) document.body.classList.add('hide-cursor');
        else document.body.classList.remove('hide-cursor');
    }
}
