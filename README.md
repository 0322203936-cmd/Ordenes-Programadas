# Órdenes Automáticas

Prototipo local para registrar órdenes recurrentes de Wholesale y preparar la semana siguiente.

## Abrir

```text
npm start
```

Después abre `http://127.0.0.1:4170`.

## Incluye

- Órdenes recurrentes con cliente, día, flor, color, cajas, tallos, tipo de caja y vigencia.
- Activar, pausar, editar y eliminar.
- Vista previa de tres semanas.
- Guardado local en el navegador.

## Revisión en POSCO mediante GitHub Actions

1. Usa **Ejecutar órdenes** desde el servidor local. El botón guarda las órdenes activas en `orders.json`, hace commit/push y dispara el workflow automáticamente.
   **Exportar órdenes** solo descarga una copia manual del `orders.json`; no ejecuta el bot.
2. En el repositorio, agrega los secretos `POSCO_USER` y `POSCO_PASSWORD`.
3. Abre `Actions` → `POSCO - Revisar órdenes programadas` → `Run workflow`.
4. Descarga el artefacto `posco-review-*` para ver el Excel y las capturas.

El workflow llega hasta la revisión de POSCO y se detiene antes de `Actualizar`. Todavía no registra la ejecución ni mueve fechas, para evitar duplicados mientras validamos el flujo.
