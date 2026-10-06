import { defineConfig, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
// Match nginx's real /privacidad page during local dev and production previews too.
function privacyPage(server: Pick<ViteDevServer, 'middlewares'>) {
  server.middlewares.use((request, _response, next) => {
    if (/^\/privacidad\/?(?:\?|$)/.test(request.url || '')) request.url = request.url!.replace(/^\/privacidad\/?/, '/privacidad/index.html');
    next();
  });
}
export default defineConfig({
  plugins: [{ name: 'privacy-page', configureServer: privacyPage, configurePreviewServer: privacyPage }],
  build: { rollupOptions: { input: {
    universe: fileURLToPath(new URL('./index.html', import.meta.url)),
    privacy: fileURLToPath(new URL('./privacidad/index.html', import.meta.url)),
  } } },
});
