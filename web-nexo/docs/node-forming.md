# Formación de nodos y conexión única

`node.forming` usa el sobre v2 de la ejecución y `data: { sources: [ids] }`.
La UI está preparada aunque el gateway mantenga apagado `NODE_FORMING_EVENT`; no se cambió esa opción ni el backend.

La formación reserva la posición del nuevo nodo en el mismo mundo. Las fuentes visibles (o sus nodos ascendentes si están en otro nivel) se iluminan; hilos convergen y el poliedro se arma con sus caras wireframe. `node.spawn` aporta el contenido y aprovecha la formación de su propio `run_id`, sin esperar la animación para aceptar el estado del servidor. Los tiempos están en `src/motion.ts`: 360 ms de hilos, 560 ms de armado y 320 ms de pulso, 1240 ms en total.

Con `prefers-reduced-motion`, el nodo aparece directamente, sin hilos, crecimiento ni pulso. La formación no mueve la cámara y sus coordenadas se proyectan con pan/zoom. Los estados pendientes se limpian ante error, desconexión, cambio de identidad o eliminación; una formación sin payload vence a los 15 s. Fuera de su nivel no provoca navegación ni abre otro panel.

Los eventos con tipos desconocidos se convierten en marcadores locales sin payload: consumen su `seq` y se omiten en chat y trazas. El siguiente evento conserva su orden incluso si llega antes que el anterior. Solo se registra el nombre del tipo, una vez por tipo y con un límite de 64 nombres; nunca `data`. `event.ignored` es un marcador interno, no un nuevo evento del contrato público.

Al arrancar se comprueba la sesión antes de conectar. El transporte espera un acceso que esté en curso, adopta ID/token de manera conjunta, comparte la promesa de conexión (también ante listeners reentrantes) y espera el cierre del socket anterior antes de pedir otro ticket. Si una adquisición de invitado coincide con un cambio de visitor_id, se descarta la credencial anterior. Las esperas por 429 y la reconexión creciente siguen funcionando.

El panel de Nexo contiene tres sugerencias ES/EN para frontend, IA y bases de datos. Solo rellenan el campo; enviar sigue siendo una acción explícita. En móvil tienen áreas de toque de al menos 44 px.

## Probar

- En desarrollo con MockBackend, reproducir `generated-ia` desde el laboratorio: emite `node.forming` antes de `node.spawn`, con secuencias contiguas.
- `npm test`: WS falso para arranque/adopción/cierre, contrato real simulado con un tipo desconocido intercalado, secuencias fuera de orden, aprobación tardía, mock, sugerencias, proyección y movimiento reducido.
- `npm run build` y luego `npm run preview -- --port 4190`.
- En otro terminal: `npm run test:forming-browser`. Comprueba la compilación de producción a 1366×768, con movimiento reducido y a 390×844. Simula un intercambio Google pendiente: cero tickets antes de completarlo, uno después y un solo socket. También comprueba sugerencias sin envío automático, ES/EN, formación y finalización pese a un evento desconocido. No usa credenciales reales.
