// Olho de Deus — este arquivo existe só para desligar o service worker da v3.0.
// A v3.0 juntava rótulos e foto de satélite aqui; em computadores lentos isso
// travava a página. Desde a v3.1 o globo desenha as camadas sozinho. Quem já
// tinha o antigo instalado recebe esta versão, que se remove e não intercepta nada.
"use strict";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(self.registration.unregister().catch(() => {}));
});
