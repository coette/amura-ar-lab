# AMURA AR Lab

Laboratorio de tracking de muñeca para AMURA AR.

## Flujo de despliegue

Este repositorio será la fuente del despliegue automático de Cloudflare Pages para `https://amura-engine-2.pages.dev/`.

La versión base al iniciar el repositorio es la rama ORB 2D responsive (V2.7.2): X/Y + escala + giro en plano, con MediaPipe para calibración inicial y ORB para relocalización.

Una vez conectado Cloudflare al repositorio, cada cambio en `main` deberá crear automáticamente una nueva implementación manteniendo la misma URL de producción.
