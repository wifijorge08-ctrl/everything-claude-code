# Portal de gestores

Sub-aplicación web para gestores de cobranza. Cada gestor entra con su usuario
y clave y ve, en vivo, **solo los datos de su cartera**:

- **Recuperación**: porcentaje recaudado sobre lo que debía cobrar en el mes.
- **Mora**: índice de mora, saldo vencido, clientes en mora y tramos por días.
- **Meta mensual**: avance, faltante y si va al ritmo necesario para cumplirla.

El administrador ve una tabla con los tres indicadores de todo el equipo.

No tiene dependencias externas: solo necesita Node.js 18 o superior.

## Probar con datos de demostración

```bash
cd portal-gestores
npm run demo
```

Abre `http://localhost:3000` e ingresa con `ana`, `luis`, `marta` o `admin`
(clave `demo1234`). Los datos de la demo son inventados y el modo demo se niega
a arrancar con `NODE_ENV=production`.

## Cómo se calculan los indicadores

| Indicador | Fórmula |
|-----------|---------|
| Recuperación | pagos del mes ÷ suma de `cuotaMes` de la cartera del gestor |
| Índice de mora | suma de `saldoVencido` ÷ suma de `saldo` de la cartera del gestor |
| Cumplimiento de meta | pagos del mes ÷ meta del mes |
| Ritmo | compara lo recaudado con `meta × día actual ÷ días del mes` |

Si en tu operación la mora o la recuperación se miden distinto (por ejemplo,
cartera en riesgo sobre el saldo total del crédito), se ajusta en
`src/metricas.js`.

## Uso con datos reales

1. Crea los usuarios (la clave se guarda solo como hash `scrypt`):

   ```bash
   node bin/crear-usuario.js --usuario ana --nombre "Ana Torres" --gestor G01
   node bin/crear-usuario.js --usuario jefe --nombre "Jefe de cobranza" --rol admin
   ```

2. Arranca el servidor indicando la fuente de datos:

   ```bash
   PORTAL_ARCHIVO_CARTERA=/ruta/cartera.json PORTAL_ZONA_HORARIA=America/Bogota npm start
   ```

| Variable | Uso |
|----------|-----|
| `PORT` | Puerto (por defecto 3000) |
| `PORTAL_ARCHIVO_CARTERA` | Ruta del JSON de cartera |
| `PORTAL_USUARIOS` | Ruta de `usuarios.json` (por defecto `datos/usuarios.json`) |
| `PORTAL_ZONA_HORARIA` | Zona horaria para determinar el día y el mes en curso |
| `PORTAL_INTERVALO_MS` | Cada cuánto se revisan cambios (por defecto 5000) |
| `PORTAL_COOKIE_SEGURA` | `0` solo para pruebas sin HTTPS |

En producción debe publicarse detrás de HTTPS.

### Formato de los datos

```json
{
  "gestores": [{ "id": "G01", "nombre": "Ana Torres" }],
  "creditos": [
    { "id": "C-100", "cliente": "Carlos Vargas", "gestorId": "G01",
      "saldo": 3000, "saldoVencido": 400, "diasMora": 45, "cuotaMes": 600 }
  ],
  "pagos": [
    { "creditoId": "C-100", "gestorId": "G01", "fecha": "2026-11-08", "monto": 200 }
  ],
  "metas": [{ "gestorId": "G01", "mes": "2026-11", "monto": 9000 }]
}
```

El portal relee el archivo cuando cambia y empuja la actualización a los
navegadores abiertos, sin recargar la página.

### Conectar otro sistema

Una fuente de datos es un objeto con un método `async obtenerCartera()` que
devuelve el formato anterior (ver `src/fuentes/`).

## Uso con Controla+

El portal lee directamente de Controla+ (`src/fuentes/controla-plus.js`), en
**solo lectura**: inicia sesión y consulta las rutas, el reporte de eficiencia
de cobro y el reporte de antigüedad de mora. No crea ni modifica nada.

Cada **ruta** de Controla+ es la cartera de un gestor.

1. Lista las rutas para obtener el identificador de cada una:

   ```bash
   CONTROLA_USUARIO=... CONTROLA_CLAVE=... node bin/listar-rutas.js
   ```

2. Crea un usuario del portal por gestor, con el identificador de su ruta:

   ```bash
   node bin/crear-usuario.js --usuario ana --nombre "Ana Torres" --gestor <id-de-la-ruta>
   ```

3. Arranca el servidor:

   ```bash
   CONTROLA_USUARIO=... CONTROLA_CLAVE=... npm start
   ```

| Variable | Uso |
|----------|-----|
| `CONTROLA_USUARIO`, `CONTROLA_CLAVE` | Cuenta de Controla+ con la que se consulta. Se recomienda una cuenta propia del portal, no la del dueño |
| `CONTROLA_SUCURSAL` | Identificador de la sucursal (por defecto, la principal) |
| `PORTAL_CACHE_MS` | Cada cuánto se vuelve a consultar Controla+ (por defecto 60000) |
| `PORTAL_METAS` | Ruta del archivo de metas (por defecto `datos/metas.json`) |
| `PORTAL_METAS_JSON` | Las metas como texto JSON, en vez de archivo |
| `PORTAL_META_PORCENTAJE` | Porcentaje del cobro programado que se usa como meta cuando no hay una definida (por defecto 100) |
| `PORTAL_USUARIOS_JSON` | Los usuarios (con la clave ya en hash) como texto JSON, en vez de archivo |

Las credenciales se pasan solo por variables de entorno; nunca se guardan en
el repositorio.

Con Controla+ los indicadores se toman así:

| Indicador | Origen |
|-----------|--------|
| Recuperación | Eficiencia de cobro del mes a la fecha: cobrado de las cuotas programadas ÷ cuotas programadas hasta hoy |
| Mora | Saldo vencido ÷ saldo pendiente de los préstamos activos de la ruta |
| Meta mensual | Total cobrado en el mes ÷ meta |

### Metas mensuales

Controla+ no maneja metas, así que se definen en `datos/metas.json`, por mes y
por nombre (o identificador) de ruta:

```json
{
  "2026-11": { "Ruta Norte": 150000, "Ruta Sur": 200000 }
}
```

Mientras una ruta no tenga meta definida, el portal calcula la meta como un
porcentaje (`PORTAL_META_PORCENTAJE`) del cobro programado del mes en
Controla+ y lo indica en pantalla. Ese monto se mueve durante el mes si se
otorgan préstamos nuevos; una meta definida queda fija.

## Publicar en internet

El portal necesita un servidor Node.js que esté siempre encendido y con HTTPS.
Sirve cualquier hosting de aplicaciones Node (Render, Railway, Fly.io) o un
servidor propio. En un hosting de este tipo:

1. Crea un servicio web a partir de este repositorio, con `portal-gestores`
   como directorio raíz y `npm start` como comando de inicio. No hay nada que
   compilar ni dependencias que instalar.
2. Define las variables de entorno: `CONTROLA_USUARIO`, `CONTROLA_CLAVE`,
   `PORTAL_USUARIOS_JSON` y, si quieres, `PORTAL_METAS_JSON`,
   `PORTAL_META_PORCENTAJE` y `PORTAL_ZONA_HORARIA`. El puerto lo toma de
   `PORT`, que estos servicios asignan solos.
3. Usa una sola instancia: las sesiones viven en memoria.

Como estos servicios no conservan archivos entre despliegues, los usuarios y
las metas se pasan por variables de entorno en lugar de `datos/*.json`. Para
obtener el hash de una clave, crea el usuario con `bin/crear-usuario.js` en tu
equipo y copia el contenido de `datos/usuarios.json` a `PORTAL_USUARIOS_JSON`.

## Seguridad

- El filtro por gestor se aplica en el servidor a partir de la sesión; el
  navegador nunca recibe datos de otra cartera ni puede pedirlos por parámetro.
- Claves con hash `scrypt` y sal; sesión en cookie `HttpOnly`, `SameSite=Strict`.
- Bloqueo de 15 minutos tras 5 intentos fallidos de ingreso.
- `datos/usuarios.json` y `datos/cartera.json` están excluidos de git.
- Las sesiones viven en memoria: al reiniciar el servidor hay que volver a
  ingresar.

## Pruebas

```bash
npm test
```
