import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { resolve } from 'path';
export default defineConfig({
    plugins: [react(), tsconfigPaths()],
    publicDir: resolve(__dirname, 'public'),
    base: './',
    build: {
        outDir: resolve(__dirname, 'dist'),
        emptyOutDir: true,
    },
    server: {
        port: 5173,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, ''),
        },
    },
});
