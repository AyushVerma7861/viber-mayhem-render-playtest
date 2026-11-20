import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  build: {
    // Online images can load separately. Offline launchers carry their own artwork.
    assetsInlineLimit: mode === 'online' ? 0 : file => /\.(png|webp)$/.test(file),
    license: { fileName: 'THIRD-PARTY-NOTICES.md' },
  },
}));
