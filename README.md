# Personal Tracker

Tracker personal de tareas con integración a Google Drive y Google Calendar. Funciona como una app estática servida localmente — sin backend, sin dependencias npm, sin build step.

## Stack

- **Vanilla JS + HTML + CSS** — sin frameworks, sin bundler
- **Google Drive API** — sincronización del estado en un JSON en tu Drive
- **Google Calendar API** — crea eventos y check-ins automáticos al iniciar tareas
- **LocalStorage** — persiste el estado localmente entre sesiones

---

## Requisitos previos

- Python 3 (para el servidor local) o cualquier servidor HTTP estático
- Una cuenta de Google
- Acceso a [Google Cloud Console](https://console.cloud.google.com)

---

## Configuración inicial

### 1. Clonar el repositorio

```bash
git clone https://github.com/svelascoinc/personal-tracker.git
cd personal-tracker
```

### 2. Crear el Client ID de Google

1. Ir a [console.cloud.google.com](https://console.cloud.google.com)
2. Crear un proyecto nuevo (o usar uno existente)
3. Habilitar las APIs necesarias:
   - **Google Drive API**
   - **Google Calendar API**
4. Ir a **APIs & Services → Credenciales → Crear credencial → OAuth 2.0 Client ID**
5. Tipo: **Aplicación web**
6. Agregar en **Orígenes autorizados de JavaScript**:
   ```
   http://localhost
   http://localhost:8080
   ```
7. Copiar el Client ID generado

### 3. Configurar el Client ID localmente

```bash
cp config.example.js config.js
```

Abrir `config.js` y reemplazar el valor:

```js
const CONFIG = {
  GOOGLE_CLIENT_ID: 'TU_CLIENT_ID.apps.googleusercontent.com'
};
```

> `config.js` está en `.gitignore` — nunca se sube al repositorio.

### 4. Iniciar el servidor local

```bash
python3 -m http.server 8080
```

Abrir el browser en: **http://localhost:8080**

---

## Estructura del proyecto

```
tracker/
├── index.html          # Estructura HTML y carga de scripts
├── style.css           # Sistema de diseño completo (tokens CSS, dark/light mode)
├── config.js           # Client ID de Google — ignorado por git (crearlo de config.example.js)
├── config.example.js   # Plantilla de configuración
├── AGENTS.md           # Reglas de code review para el pre-commit hook
├── js/
│   ├── app.js          # Lógica principal: estado, render, modales, épicas, backlog, pomodoro
│   ├── drive.js        # Integración Google Drive (OAuth + sync)
│   ├── calendar.js     # Integración Google Calendar (eventos + check-ins)
│   └── utils.js        # Helpers: uid(), today(), getWeekId(), etc.
```

---

## Funcionalidades

| Módulo | Descripción |
|---|---|
| **Kanban** | Columnas Todo / En progreso / Completado con drag & drop |
| **Sprints semanales** | Se crean automáticamente por semana ISO. Las tareas pendientes se pasan al sprint siguiente automáticamente |
| **Épicas** | Agrupación de tareas a largo plazo estilo Jira, con barra de progreso y colores |
| **Backlog** | Tareas sin sprint asignado, programables para semanas futuras |
| **Hábitos** | Registro diario con racha, historial de 14 días y generación automática de tarea diaria |
| **Pomodoro** | Timer 25/5 integrado en el header con check-in al finalizar cada foco |
| **Google Drive** | Sincronización bidireccional del JSON de estado |
| **Google Calendar** | Crea evento al mover una tarea a "En progreso" + recordatorios de check-in cada 30 min |
| **Notificaciones** | Browser notifications para check-ins (requiere permiso en el browser) |
| **Stats** | Métricas acumuladas: tareas, hábitos, épicas, sprints |
| **Historial** | Vista de sprints cerrados con detalle de tareas |
| **Dark / Light mode** | Toggle en el header, persiste en localStorage |
| **Exportar / Importar** | JSON completo para análisis externo o backup |

---

## Sincronización con Google Drive

Al conectar Drive por primera vez:

1. Clic en **Drive: local** en el header
2. Autorizar los permisos de Google (Drive + Calendar en un solo flujo OAuth)
3. El estado se guarda en un archivo `tracker-personal-data.json` en tu Drive

Cada cambio se sincroniza automáticamente con debounce de 2 segundos.

---

## Schema del JSON de estado

```json
{
  "schemaVersion": 3,
  "currentSprintId": "2026-W21",
  "tasks": [...],
  "habits": [...],
  "sprints": [...],
  "epics": [...]
}
```

Cada tarea incluye: `id`, `title`, `firstStep`, `category`, `priority`, `due`, `status`, `sprintId`, `epicId`, `habitId`, `calendarEventId`, `completedAt`, `createdAt`, `updatedAt`.

---

## Análisis de datos

El JSON exportado (botón **↓ export**) contiene toda la información necesaria para análisis con herramientas externas como Claude. Incluye fechas de creación, vencimiento y completado por tarea — suficiente para calcular puntualidad, velocidad por sprint y patrones de atraso.
