import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        booking: fileURLToPath(new URL('./booking.html', import.meta.url)),
        cafe: fileURLToPath(new URL('./cafe.html', import.meta.url)),
        auth: fileURLToPath(new URL('./auth.html', import.meta.url)),
        profile: fileURLToPath(new URL('./profile.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
  },
});
