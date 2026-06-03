import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        jarvis: {
          bg: '#000408',
          surface: 'rgba(0, 20, 40, 0.6)',
          border: 'rgba(0, 180, 216, 0.15)',
          cyan: '#00b4d8',
          'cyan-dim': 'rgba(0, 180, 216, 0.4)',
          'cyan-glow': 'rgba(0, 180, 216, 0.15)',
          purple: '#7c3aed',
          amber: '#f59e0b',
          red: '#ef4444',
          green: '#22c55e',
          fg: '#e2e8f0',
          'fg-dim': 'rgba(226, 232, 240, 0.4)',
        },
      },
      fontFamily: {
        mono: ['Courier New', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      animation: {
        'orb-pulse': 'orbPulse 4s ease-in-out infinite',
        'orb-pulse-fast': 'orbPulse 1.5s ease-in-out infinite',
        'orb-pulse-think': 'orbPulse 0.8s ease-in-out infinite',
        'ring-rotate': 'ringRotate 20s linear infinite',
        'ring-rotate-fast': 'ringRotate 8s linear infinite',
        'ring-rotate-think': 'ringRotate 3s linear infinite',
        scanline: 'scanline 8s linear infinite',
        'boot-glow': 'bootGlow 2s ease-in-out infinite alternate',
        'boot-pulse': 'bootPulse 2s ease-in-out infinite',
        'msg-fade': 'msgFade 0.4s ease-out',
        'dot-bounce': 'dotBounce 1.2s ease-in-out infinite',
        'hud-blink': 'hudBlink 0.6s infinite',
        'conv-pulse': 'convPulse 3s ease-in-out infinite',
      },
      keyframes: {
        orbPulse: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.8' },
          '50%': { transform: 'scale(1.05)', opacity: '1' },
        },
        ringRotate: {
          to: { transform: 'rotate(360deg)' },
        },
        scanline: {
          '0%': { top: '-120px' },
          '100%': { top: '100vh' },
        },
        bootGlow: {
          from: { textShadow: '0 0 20px rgba(0,180,216,0.3), 0 0 40px rgba(0,180,216,0.1)' },
          to: { textShadow: '0 0 40px rgba(0,180,216,0.6), 0 0 80px rgba(0,180,216,0.3)' },
        },
        bootPulse: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(0,180,216,0.3)' },
          '50%': { boxShadow: '0 0 20px 5px rgba(0,180,216,0.1)' },
        },
        msgFade: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        dotBounce: {
          '0%, 60%, 100%': { transform: 'translateY(0)', opacity: '0.3' },
          '30%': { transform: 'translateY(-6px)', opacity: '1' },
        },
        hudBlink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        convPulse: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '0.9' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
