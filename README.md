# Gestor de turnos

App web para que el equipo (7 compañeros + jefa) vea y edite el calendario anual de turnos.

- **Cuadrante mensual** (personas × días) con fichas de color: 9–18, Mañana 6–15, Tarde 14–23, Noche 22–7, Libre, Vacaciones, Asuntos propios, Otros.
- **Calendario**, **Semana** y **Año** para consultar quién está de turno.
- **Edición ágil**: toca un día y elige ficha, o elige una ficha (pincel) y arrastra sobre varios días. `Mayús`+clic pinta un tramo. Teclas `1`–`8` eligen ficha, `0` borra, `Esc` suelta el pincel, `Ctrl+Z` deshace.
- **Cobertura**: los turnos de mañana/tarde/noche sin nadie aparecen en rojo (`!`). Un clic permite que una persona de 9–18 lo cubra (o "Cubrir automáticamente", que reparte equitativamente).
- **+ Ausencia**: vacaciones/asuntos propios por rango de fechas, cubriendo huecos de una vez.
- **Rellenar año**: genera la rotación de 6 días de trabajo + 4 libres para los 5 rotativos. Por defecto rota Mañana → Tarde → Noche en cada ciclo, con las 5 personas desfasadas 2 días: así los 3 turnos quedan cubiertos todos los días. Ajusta la fecha de inicio de cada persona a su ciclo real.
- Login por usuario, cada persona cambia su contraseña. La jefa es administradora (nombres, usuarios, restablecer contraseñas).
- Los cambios de los demás aparecen solos (se refresca cada 15 s).

## Puesta en marcha (GitHub + Netlify)

1. Sube esta carpeta a un repositorio de GitHub.
2. En Netlify: **Add new site → Import an existing project →** elige el repositorio. Netlify lee `netlify.toml` (carpeta pública `public`, funciones en `netlify/functions`); no hay comando de build.
3. **Antes de compartir la URL**, en *Site configuration → Environment variables* añade:
   - `INITIAL_PASSWORD` → contraseña inicial de todo el equipo (si no la pones, es `turnos2026`).
   - `JWT_SECRET` (opcional) → cadena larga aleatoria. Si no existe, la app genera una y la guarda sola.
4. Despliega. Los datos se guardan en **Netlify Blobs** (incluido en Netlify, sin base de datos que configurar).
5. Entra con `jefa` y la contraseña inicial. Te pedirá elegir una nueva. Después, en el menú de tu nombre → **Gestionar equipo**, pon los nombres reales y los usuarios de cada persona (hay 8 cuentas creadas: `jefa`, `oficina1`, `oficina2`, `turno1`…`turno5`).
6. Cada persona entra con su usuario y la contraseña inicial y debe cambiarla en el primer acceso. Si alguien la olvida: *Gestionar equipo → Nueva contraseña*.

## Reglas incorporadas

- Las 2 personas de 9–18 tienen L–V 9–18 por defecto (celdas tenues); solo se guarda lo que cambias.
- La jefa no tiene horario: solo se le pueden marcar ausencias.
- Las personas rotativas no pueden tener la ficha 9–18.
- Al cubrir, se evita poner Mañana a quien sale de Noche el día anterior, y Noche a quien entra de Mañana al día siguiente.

## Desarrollo local

```
npm install
npm test            # pruebas de la API (almacenamiento en memoria)
npm run dev:local   # http://localhost:8888, datos en memoria (usuario jefa / turnos2026)
npm run dev         # con Netlify CLI y Blobs reales (netlify dev)
```

## Estructura

```
public/                 index.html, app.js, style.css  (frontend sin build)
netlify/functions/api.mjs   API (/api/*): login, contraseñas, calendario, administración
netlify/lib/            auth (scrypt + token firmado) y almacenamiento (Netlify Blobs)
netlify.toml            configuración de Netlify
```
