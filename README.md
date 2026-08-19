# AMURA AR Lab

Laboratorio de tracking de muñeca para AMURA AR.

## Flujo de despliegue

Este repositorio es la fuente del despliegue automático de Cloudflare Pages para `https://amura-engine-2.pages.dev/`.

Cada cambio en `main` genera automáticamente una nueva implementación manteniendo la misma URL de producción. El contenido publicado se construye copiando `site/` íntegramente a `dist/`.

## Versión activa de prueba

MediaPipe V11.2 · Pose métrica Pretty. El contenido de `site/` procede sin modificaciones de `Amura_AR_v11_2_Metrico_Pretty.zip`.
