# Gestor de Horario Híbrido

Aplicación web (HTML + Tailwind CSS + JavaScript, sin build) para organizar horarios de trabajo híbrido.

## Uso

Abre `index.html` en el navegador (o sirve la carpeta con `python3 -m http.server`).
Tailwind se carga desde su CDN, así que hace falta conexión a internet. Los datos se guardan en el `localStorage` del navegador.

## Funcionalidades

- **Equipo dinámico**: añadir, editar y eliminar integrantes. Cada uno tiene su número de días remotos por semana (por defecto 2).
- **Reglas por integrante y día**: remoto obligatorio, remoto preferido o presencial obligatorio.
- **Cobertura global**: mínimo de personas presenciales por día (por defecto 1).
- **Esquema fijo**: calcula una semana tipo que cumple las reglas obligatorias, maximiza las preferencias y reparte la ocupación de la oficina.
- **Esquema rotatorio de N semanas**: el ciclo dura por defecto tantas semanas como personas haya en el equipo. Reparte de forma equitativa los días de alta demanda (por defecto el viernes). Incluye la matriz de rotación y una tabla de equidad.
- **Tablas interactivas**: clic en una celda para alternar Remoto/Oficina. La fila de cobertura se muestra en verde (ok) o en rojo (oficina vacía o por debajo del mínimo). Las celdas que rompen una regla se marcan en ámbar.
- Exportación a CSV.

## Motor

`js/scheduler.js` modela la semana de cada persona como una máscara de 5 bits y busca la asignación de menor coste por ramificación y poda. El coste pondera, de mayor a menor peso: los déficits de cobertura, las preferencias no concedidas y el equilibrio de ocupación. En modo rotatorio se añade un coste de equidad según los turnos acumulados de cada persona en los días de alta demanda.

## Tests

```bash
node --test tests/*.test.js
```
