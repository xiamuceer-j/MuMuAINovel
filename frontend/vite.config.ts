import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'

  return {
    plugins: [react()],
    build: {
      outDir: '../backend/static',
      emptyOutDir: true,
    },
    server: {
      host: '0.0.0.0',  // Docker环境需要
      port: 3000,       // 开发服务器端口
      proxy: {
        '/api': {
          target: process.env.BACKEND_URL || 'http://backend-dev:8000',
          changeOrigin: true,
          secure: false,  // Docker环境
        }
      },
      watch: {
        // Docker环境下的文件监听配置
        usePolling: process.env.CHOKIDAR_USEPOLLING === 'true',
        interval: 1000,
      }
    },
    define: {
      // 开发环境标识
      __DEV__: isDev,
    },
    // 开发环境下关闭一些性能优化以加快启动
    optimizeDeps: !isDev ? {} : {
      force: true,
    }
  }
})
