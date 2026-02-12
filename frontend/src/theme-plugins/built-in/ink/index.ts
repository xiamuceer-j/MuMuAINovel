import type { ThemePlugin } from '../../types';
import manifest from './manifest.json';

const theme: ThemePlugin = {
  manifest,

  antdTheme: {
    token: {
      colorPrimary: '#2C3E50',
      colorBgBase: '#F5F5F0',
      colorTextBase: '#1A1A1A',
      borderRadius: 2,
      wireframe: false,
      fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', serif",
    },
    components: {
      Layout: {
        bodyBg: '#F5F5F0',
        headerBg: '#FFFFFF',
        siderBg: '#FAFAF8',
      },
      Card: {
        colorBgContainer: '#FFFFFF',
        boxShadowTertiary: '0 2px 8px rgba(0, 0, 0, 0.04)',
      },
      Button: {
        borderRadius: 2,
        controlHeight: 36,
      },
    },
  },

  cssVars: {
    'color-primary': '#2C3E50',
    'color-primary-hover': '#34495E',
    'color-primary-active': '#1A252F',
    'color-success': '#27AE60',
    'color-warning': '#F39C12',
    'color-error': '#C0392B',
    'color-info': '#2980B9',
    'color-bg-base': '#F5F5F0',
    'color-bg-container': '#FFFFFF',
    'color-bg-layout': '#EBEBE5',
    'color-bg-spotlight': '#2C3E50',
    'color-bg-mask': 'rgba(0, 0, 0, 0.5)',
    'color-text-base': '#1A1A1A',
    'color-text-primary': '#1A1A1A',
    'color-text-secondary': '#4A4A4A',
    'color-text-tertiary': '#7A7A7A',
    'color-text-quaternary': '#AAAAAA',
    'color-border': '#D0D0C8',
    'color-border-secondary': '#E0E0D8',
    'shadow-card': '0 1px 4px rgba(0, 0, 0, 0.04)',
    'shadow-elevated': '0 4px 16px rgba(44, 62, 80, 0.08)',
    'shadow-primary': '0 2px 12px rgba(44, 62, 80, 0.15)',
    'shadow-header': '0 1px 4px rgba(0, 0, 0, 0.04)',
  },

  customCSS: `
    /* Ink style specific overrides */
    .modern-sider {
      background: linear-gradient(180deg,
        rgba(250, 250, 248, 0.98) 0%,
        rgba(245, 245, 240, 1) 100%) !important;
      border-right: 1px solid rgba(44, 62, 80, 0.1);
      box-shadow: 1px 0 8px rgba(0, 0, 0, 0.03);
    }

    .modern-sider .ant-menu-item-selected {
      background: linear-gradient(135deg,
        #2C3E50 0%,
        #34495E 100%) !important;
    }

    /* Ink painting style subtle texture effect */
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      opacity: 0.02;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
    }
  `,

  featureOverrides: {
    prompt_workshop: {
      cssVars: {
        'color-bg-layout': '#E7E7DF',
        'shadow-card': '0 2px 10px rgba(0, 0, 0, 0.06)',
      },
      customCSS: `
        html[data-theme="ink"][data-feature="prompt_workshop"] .ant-card {
          border: 1px solid rgba(44, 62, 80, 0.12);
        }
      `,
    },
  },

  motion: {
    enablePageTransition: true,
    durationMs: 420,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  },
};

export default theme;
