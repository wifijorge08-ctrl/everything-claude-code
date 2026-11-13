'use strict';

const fs = require('fs');
const { fechaHoy } = require('../metricas');

/**
 * Fuente de datos: Controla+ (api.controlaplus.com.mx).
 *
 * SOLO LECTURA. Usa unicamente el inicio de sesion y cinco consultas:
 *   - /company/get-one             nombre de la empresa
 *   - /branch/get-all-by-company   sucursales
 *   - /route/get-all               rutas y cobrador asignado (ruta = gestor)
 *   - /reports/collection-efficiency  esperado y cobrado por ruta
 *   - /reports/aging               saldo, vencido y dias de mora por prestamo
 *
 * Los dos reportes se piden con POST porque asi los expone Controla+, pero son
 * consultas: no crean ni modifican nada.
 */

const BASE = 'https://api.controlaplus.com.mx';
const MARGEN_TOKEN_MS = 5 * 60 * 1000;
const MAX_PAGINAS = 100;

function venceToken(token) {
  try {
    const carga = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return Number(carga.exp) * 1000 || 0;
  } catch (_err) {
    return 0;
  }
}

function leerMetas(fijas, ruta, mes) {
  if (fijas) return fijas[mes] || {};
  if (!ruta) return {};
  try {
    const todas = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    return (todas && todas[mes]) || {};
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[portal-gestores] metas (${ruta}): ${err.message}`);
    return {};
  }
}

function crearFuenteControlaPlus(opciones) {
  const {
    usuario,
    clave,
    sucursal,
    archivoMetas,
    metas: metasFijas,
    metaPorcentaje = 100,
    base = BASE,
    cacheMs = 60000,
    fetchImpl = fetch,
    reloj = () => new Date()
  } = opciones;
  if (!usuario || !clave) throw new Error('Controla+: faltan usuario y clave');

  let sesion = null;
  let cache = null;
  let enCurso = null;

  async function iniciarSesion() {
    const res = await fetchImpl(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usuario, password: clave, origin: 'ADMIN' })
    });
    const cuerpo = await res.json().catch(() => null);
    if (!res.ok || !cuerpo || !cuerpo.data || !cuerpo.data.token) {
      throw new Error(`Controla+: no se pudo iniciar sesion (HTTP ${res.status})`);
    }
    sesion = {
      token: cuerpo.data.token,
      vence: venceToken(cuerpo.data.token),
      empresa: cuerpo.data.company_uuid,
      zonaHoraria: cuerpo.data.timezone || undefined,
      moneda: cuerpo.data.currency || null,
      sucursal: sesion ? sesion.sucursal : sucursal || null,
      nombreEmpresa: sesion ? sesion.nombreEmpresa : undefined
    };
  }

  async function pedir(metodo, ruta, datos, reintento = true) {
    if (!sesion || (sesion.vence && sesion.vence - reloj().getTime() < MARGEN_TOKEN_MS)) await iniciarSesion();
    const res = await fetchImpl(`${base}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${sesion.token}`, 'Content-Type': 'application/json' },
      body: datos ? JSON.stringify(datos) : undefined
    });
    if (res.status === 401 && reintento) {
      sesion.vence = 1;
      return pedir(metodo, ruta, datos, false);
    }
    const cuerpo = await res.json().catch(() => null);
    if (!res.ok || !cuerpo || cuerpo.error) {
      throw new Error(`Controla+: ${ruta.split('?')[0]} respondio HTTP ${res.status}`);
    }
    return cuerpo.data;
  }

  async function resolverSucursal() {
    if (sesion.sucursal) return sesion.sucursal;
    const lista = (await pedir('GET', `/branch/get-all-by-company/${sesion.empresa}`)) || [];
    const elegida = lista.find(s => s.isHeadquarters && s.isActive) || lista.find(s => s.isActive) || lista[0];
    if (!elegida) throw new Error('Controla+: la empresa no tiene sucursales');
    sesion.sucursal = elegida.uuid;
    return sesion.sucursal;
  }

  async function nombreEmpresa() {
    if (sesion.nombreEmpresa === undefined) {
      // El nombre es decorativo: si no se puede leer, el portal sigue sin el.
      const datos = await pedir('GET', `/company/get-one/${sesion.empresa}`).catch(() => null);
      sesion.nombreEmpresa = (datos && datos.name) || null;
    }
    return sesion.nombreEmpresa;
  }

  async function prestamos(sucursalId) {
    const filas = [];
    let generado = null;
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const datos = await pedir('POST', '/reports/aging', {
        branchUuid: sucursalId,
        onlyOverdue: false,
        pageSize: 200,
        page: pagina
      });
      filas.push(...(datos.rows || []));
      generado = datos.generatedAt || generado;
      const info = datos.pageInfo || {};
      if (!(info.totalPages > pagina + 1)) break;
    }
    return { filas, generado };
  }

  async function consultar() {
    if (!sesion) await iniciarSesion();
    const sucursalId = await resolverSucursal();
    const hoy = fechaHoy(sesion.zonaHoraria, reloj());
    const mes = hoy.slice(0, 7);
    const [anio, mesNumero] = mes.split('-').map(Number);
    const ultimoDia = new Date(Date.UTC(anio, mesNumero, 0)).getUTCDate();
    // Controla+ interpreta estas fechas en la zona horaria de la sucursal.
    const rango = hasta => ({ branchUuid: sucursalId, from: `${mes}-01T00:00:00Z`, to: `${hasta}T23:59:59Z` });

    const [empresa, rutas, aLaFecha, delMes, cartera] = await Promise.all([
      nombreEmpresa(),
      pedir('GET', `/route/get-all?branch=${sucursalId}&page=0&size=500`),
      pedir('POST', '/reports/collection-efficiency', rango(hoy)),
      pedir('POST', '/reports/collection-efficiency', rango(`${mes}-${String(ultimoDia).padStart(2, '0')}`)),
      prestamos(sucursalId)
    ]);

    const listaRutas = (rutas.content || []).filter(r => r.isActive !== false);
    const metasDefinidas = leerMetas(metasFijas, archivoMetas, mes);
    const filaDelMes = new Map((delMes.rows || []).map(f => [f.routeUuid, f]));
    const filaALaFecha = new Map((aLaFecha.rows || []).map(f => [f.routeUuid, f]));

    const metas = [];
    const recaudo = [];
    for (const r of listaRutas) {
      const fecha = filaALaFecha.get(r.uuid) || {};
      const completo = filaDelMes.get(r.uuid) || {};
      recaudo.push({
        gestorId: r.uuid,
        mes,
        aLaFecha: true,
        porCobrar: fecha.expectedCollection || 0,
        recaudado: fecha.collected || 0,
        recaudadoMes: completo.totalCollected || 0
      });
      const definida = metasDefinidas[r.uuid] !== undefined ? metasDefinidas[r.uuid] : metasDefinidas[r.name];
      if (Number(definida) > 0) metas.push({ gestorId: r.uuid, mes, monto: Number(definida), origen: 'definida' });
      else if (completo.expectedCollection > 0) {
        // Sin meta definida: un porcentaje del cobro programado del mes en Controla+.
        metas.push({
          gestorId: r.uuid,
          mes,
          monto: Math.round((completo.expectedCollection * metaPorcentaje) / 100),
          origen: 'programado',
          porcentaje: metaPorcentaje
        });
      }
    }

    return {
      hoy,
      empresa,
      moneda: aLaFecha.currency || sesion.moneda,
      actualizado: cartera.generado || reloj().toISOString(),
      gestores: listaRutas.map(r => ({
        id: r.uuid,
        ruta: r.name,
        nombre: r.assignedEmployee_fullName ? `${r.name} (${r.assignedEmployee_fullName.trim()})` : r.name
      })),
      creditos: cartera.filas.map(f => ({
        id: f.loanUuid,
        cliente: f.clientName,
        gestorId: f.routeUuid,
        saldo: f.outstandingBalance,
        saldoVencido: f.totalOverdue,
        diasMora: f.daysPastDue
      })),
      recaudo,
      metas
    };
  }

  return {
    nombre: 'controla-plus',
    async obtenerCartera() {
      const ahora = reloj().getTime();
      if (cache && ahora - cache.momento < cacheMs) return cache.datos;
      // Varias pantallas abiertas comparten una sola consulta a Controla+.
      if (!enCurso) {
        enCurso = consultar()
          .then(datos => {
            cache = { datos, momento: reloj().getTime() };
            return datos;
          })
          .finally(() => {
            enCurso = null;
          });
      }
      return enCurso;
    }
  };
}

module.exports = { crearFuenteControlaPlus };
