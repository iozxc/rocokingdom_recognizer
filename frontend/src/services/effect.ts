import confetti from 'canvas-confetti';
import { EffectLevel } from '../types';

/**
 * 未遇见 -> 遇见：轻量纸花彩屑动效
 */
export function fireEncounterConfetti(level: EffectLevel = 1) {
    if (level === 0) return;
    try {
        if (level === 1) {
            // 1 级 · 轻微：极简轻量微粒轻扬
            confetti({
                particleCount: 26,
                spread: 50,
                startVelocity: 24,
                origin: { x: 0.5, y: 0.82 },
                colors: ['#38BDF8', '#818CF8', '#34D399', '#FBBF24'],
                ticks: 120,
                gravity: 1.2,
                scalar: 0.75,
                disableForReducedMotion: true,
            });
        } else if (level === 2) {
            // 2 级 · 标准：双侧对称抛射
            confetti({
                particleCount: 36,
                angle: 60,
                spread: 55,
                startVelocity: 35,
                origin: { x: 0.15, y: 0.85 },
                colors: ['#0EA5E9', '#6366F1', '#10B981', '#F59E0B', '#EC4899'],
                ticks: 140,
                gravity: 1.1,
                scalar: 0.85,
                disableForReducedMotion: true,
            });
            confetti({
                particleCount: 36,
                angle: 120,
                spread: 55,
                startVelocity: 35,
                origin: { x: 0.85, y: 0.85 },
                colors: ['#0EA5E9', '#6366F1', '#10B981', '#F59E0B', '#EC4899'],
                ticks: 140,
                gravity: 1.1,
                scalar: 0.85,
                disableForReducedMotion: true,
            });
        } else {
            // 3 级 · 丰富：多段优雅绽放
            const count = 110;
            const defaults = {
                origin: { y: 0.75 },
                disableForReducedMotion: true,
            };

            const fire = (particleRatio: number, opts: confetti.Options) => {
                confetti({
                    ...defaults,
                    ...opts,
                    particleCount: Math.floor(count * particleRatio),
                });
            };

            fire(0.25, {
                spread: 30,
                startVelocity: 42,
                colors: ['#38BDF8', '#818CF8', '#FBBF24'],
            });
            fire(0.2, {
                spread: 60,
                colors: ['#34D399', '#60A5FA', '#A78BFA'],
            });
            fire(0.35, {
                spread: 90,
                decay: 0.92,
                scalar: 0.8,
                colors: ['#F59E0B', '#EC4899', '#38BDF8', '#10B981'],
            });
            fire(0.2, {
                spread: 110,
                startVelocity: 28,
                decay: 0.92,
                scalar: 1.0,
                colors: ['#6366F1', '#FBBF24'],
            });
        }
    } catch (err) {
        console.warn('[Confetti] failed to fire encounter confetti', err);
    }
}

/**
 * 遇见 -> 未遇见：极简静谧微粒消散动效（iOS 端庄克制风格，非彩屑）
 */
export function fireUnencounterEffect(level: EffectLevel = 1) {
    if (level === 0) return;
    try {
        const particleCount = level === 1 ? 12 : level === 2 ? 20 : 30;
        confetti({
            particleCount,
            spread: 40,
            startVelocity: 16,
            origin: { x: 0.5, y: 0.75 },
            colors: ['#94A3B8', '#CBD5E1', '#E2E8F0', '#64748B'],
            ticks: 70,
            gravity: 0.85,
            decay: 0.94,
            scalar: 0.55,
            shapes: ['circle'],
            disableForReducedMotion: true,
        });
    } catch (err) {
        console.warn('[Confetti] failed to fire unencounter effect', err);
    }
}

/**
 * 兼容旧方法
 */
export const fireConfetti = fireEncounterConfetti;

