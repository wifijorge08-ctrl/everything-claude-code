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

### Conectar otro sistema (Controla Plus)

Una fuente de datos es un objeto con un método `async obtenerCartera()` que
devuelve el formato anterior (ver `src/fuentes/`). La conexión directa con
Controla Plus está **pendiente**: depende de cómo ese sistema permita leer los
datos (API, base de datos o exportación programada).

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
