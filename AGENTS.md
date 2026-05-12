# Code Review Rules

## JavaScript
- No usar `var` — solo `const` y `let`
- No exponer API keys, Client IDs ni tokens en el código fuente
- Datos sensibles van en `config.js` (gitignoreado) y se leen via `CONFIG.*`
- Los colores dinámicos generados por el usuario (ej: colores de épicas) pueden ser hex hardcodeados — se inyectan como inline styles porque son valores de usuario, no tokens de diseño

## CSS
- Usar CSS custom properties para todos los valores de color del sistema de diseño
- No hardcodear colores del design system — siempre `var(--token)`
- Excepción: colores generados dinámicamente por lógica de usuario (épicas, categorías) pueden ir como inline styles

## DOM
- Este proyecto usa vanilla JS con manipulación directa del DOM — es el patrón correcto para esta arquitectura sin framework
- Las funciones de render principales son `render()`, `renderKanban()`, `renderHabits()`, etc.
- Los módulos async (Drive, Reminders, Pomodoro) pueden actualizar el DOM directamente en sus callbacks — es comportamiento esperado
