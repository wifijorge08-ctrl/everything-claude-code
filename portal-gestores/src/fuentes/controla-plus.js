'use strict';

const fs = require('fs');
const { fechaHoy } = require('../metricas');

/**
 * Fuente de datos: Controla+ (api.controlaplus.com.mx).
 *
 * SOLO LECTURA. Usa unicamente el inicio de sesion y estas consultas:
 *   - /company/get-one                   nombre de la empresa
 *   - /branch/get-all-by-company         sucursales
 *   - /route/get-all                     rutas y cobrador asignado (ruta = gestor)
 *   - /reports/collection-efficiency     esperado y cobrado por ruta
 *   - /reports/aging                     saldo, vencido y dias de mora por prestamo
 *   - /collection-calendar/day-detail    cuotas programadas para hoy
 *   - /collection-calendar/day-payments  pagos recibidos cada dia
 *   - /collection-calendar/monthly-summary  cobro programado por dia
 *   - /payment-promise/search            promesas de pago pendientes
 *
 * Los reportes y la busqueda de promesas se piden con POST porque asi los
 * expone Controla+, pero son consultas: no crean ni modifican nada.
 */

const BASE = 'https://api.controlaplus.com.mx';
const MARGEN_TOKEN_MS = 5 * 60 * 1000;
const MAX_PAGINAS = 100;
const MINUTO = 60 * 1000;

function venceToken(token) {
  try {
    const carga = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return Number(carga.exp) * 1000 || 0;
  } catch (_err) {
    return 0;
  }
}

function leerMetas(fijas, ruta, mes) {
  const todas = typeof fijas === 'function' ? fijas() : fijas;
  if (todas) return todas[mes] || {};
  if (!ruta) return {};
  try {
    const delArchivo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    return (delArchivo && delArchivo[mes]) || {};
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[portal-gestores] metas (${ruta}): ${err.message}`);
    return {};
  }
}

function dosDigitos(n) {
  return String(n).padStart(2, '0');
}

function mesAnteriorDe(mes) {
  const [anio, numero] = mes.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, numero - 2, 1));
  const ultimo = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0)).getUTCDate();
  return { mes: `${fecha.getUTCFullYear()}-${dosDigitos(fecha.getUTCMonth() + 1)}`, ultimo };
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
  const memoria = new Map();

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

  /** Guarda el resultado de una consulta durante ttlMs para no repetirla en cada refresco. */
  async function conCache(llave, ttlMs, consulta) {
    const ahora = reloj().getTime();
    const previo = memoria.get(llave);
    if (previo && ahora - previo.momento < ttlMs) return previo.valor;
    const valor = await consulta();
    memoria.set(llave, { valor, momento: ahora });
    if (memoria.size > 500) memoria.delete(memoria.keys().next().value);
    return valor;
  }

  /** Los datos complementarios no deben tumbar el tablero si una consulta falla. */
  async function opcional(nombre, consulta, porDefecto) {
    try {
      return await consulta();
    } catch (err) {
      console.error(`[portal-gestores] ${nombre}: ${err.message}`);
      return porDefecto;
    }
  }

  async function enLotes(elementos, tamano, tarea) {
    const resultados = [];
    for (let i = 0; i < elementos.length; i += tamano) {
      resultados.push(...(await Promise.all(elementos.slice(i, i + tamano).map(tarea))));
    }
    return resultados;
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

  /** Cuotas programadas para hoy en toda la sucursal (cada una trae su ruta). */
  async function cobrosDeHoy(sucursalId, hoy) {
    const filas = [];
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const datos = await pedir('GET',
        `/collection-calendar/day-detail?date=${hoy}&branchUuid=${sucursalId}&page=${pagina}&size=200&isToday=true`);
      const clientes = datos.clients || {};
      filas.push(...(clientes.content || []));
      if (!(clientes.totalPages > pagina + 1)) break;
    }
    return filas.map(f => ({
      gestorId: f.routeUuid,
      cliente: f.clientFullName,
      monto: f.amount,
      pagado: f.amountPaid,
      cuota: f.installmentNumber && f.totalPayments ? `${f.installmentNumber}/${f.totalPayments}` : null
    }));
  }

  /** Total pagado en una fecha, por ruta, y cuanto de eso fue interes. */
  async function pagosDelDia(sucursalId, fecha) {
    const porRuta = {};
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const datos = await pedir('GET',
        `/collection-calendar/day-payments?date=${fecha}&branchUuid=${sucursalId}&page=${pagina}&size=200`);
      const pagos = datos.payments || {};
      for (const p of pagos.content || []) {
        const ruta = porRuta[p.routeUuid] || (porRuta[p.routeUuid] = { monto: 0, interes: 0 });
        ruta.monto += Number(p.amount) || 0;
        ruta.interes += Number(p.interestPaid) || 0;
      }
      if (!(pagos.totalPages > pagina + 1)) break;
    }
    return porRuta;
  }

  /** Cobrado y programado de cada dia del mes, por ruta. */
  async function serieDelMes(sucursalId, rutas, hoy, pagosHoy) {
    const mes = hoy.slice(0, 7);
    const [anio, mesNumero, diaHoy] = hoy.split('-').map(Number);
    const ultimoDia = new Date(Date.UTC(anio, mesNumero, 0)).getUTCDate();
    const fechas = Array.from({ length: ultimoDia }, (_, i) => `${mes}-${dosDigitos(i + 1)}`);

    // Los dias pasados cambian poco: se consultan cada 30 minutos; hoy, en cada refresco.
    const pasadas = fechas.slice(0, diaHoy - 1);
    const pagosPasados = await enLotes(pasadas, 6, fecha =>
      conCache(`pagos:${fecha}`, 30 * MINUTO, () => pagosDelDia(sucursalId, fecha)));
    const pagos = new Map(pasadas.map((fecha, i) => [fecha, pagosPasados[i]]));
    pagos.set(hoy, pagosHoy || (await pagosDelDia(sucursalId, hoy)));

    const programado = await enLotes(rutas, 5, r =>
      conCache(`programado:${mes}:${r.uuid}`, 10 * MINUTO, async () => {
        const datos = await pedir('GET',
          `/collection-calendar/monthly-summary?month=${mesNumero}&year=${anio}&branchUuid=${sucursalId}&routeUuid=${r.uuid}`);
        return datos.days || {};
      }));

    const serie = [];
    rutas.forEach((r, i) => {
      for (const fecha of fechas) {
        const delDia = pagos.get(fecha);
        serie.push({
          gestorId: r.uuid,
          fecha,
          programado: (programado[i][fecha] && programado[i][fecha].totalAmount) || 0,
          cobrado: delDia ? (delDia[r.uuid] && delDia[r.uuid].monto) || 0 : null
        });
      }
    });
    return serie;
  }

  async function promesasPendientes(sucursalId, rutas) {
    const listas = await enLotes(rutas, 5, r =>
      conCache(`promesas:${r.uuid}`, 5 * MINUTO, async () => {
        const datos = await pedir('POST', '/payment-promise/search', {
          branchUuid: sucursalId,
          routeUuid: r.uuid,
          status: 'PENDING',
          size: 50
        });
        return ((datos && datos.content) || []).map(p => ({
          gestorId: r.uuid,
          cliente: p.clientFullName || p.clientName || (p.client && (p.client.fullName || p.client.name)) || 'Cliente',
          fecha: String(p.promiseDate || '').slice(0, 10),
          monto: Number(p.promisedAmount) || 0,
          cumplido: Number(p.fulfilledAmount) || 0
        }));
      }));
    return listas.flat();
  }

  async function mesAnterior(sucursalId, mes) {
    const anterior = mesAnteriorDe(mes);
    return conCache(`anterior:${anterior.mes}`, 60 * MINUTO, async () => {
      const datos = await pedir('POST', '/reports/collection-efficiency', {
        branchUuid: sucursalId,
        from: `${anterior.mes}-01T00:00:00Z`,
        to: `${anterior.mes}-${dosDigitos(anterior.ultimo)}T23:59:59Z`
      });
      return (datos.rows || []).map(f => ({
        gestorId: f.routeUuid,
        mes: anterior.mes,
        cobrado: f.totalCollected || 0,
        recuperacion: f.collectionEfficiency === undefined ? null : f.collectionEfficiency
      }));
    });
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
      pedir('POST', '/reports/collection-efficiency', rango(`${mes}-${dosDigitos(ultimoDia)}`)),
      prestamos(sucursalId)
    ]);

    const listaRutas = (rutas.content || []).filter(r => r.isActive !== false);
    // Los pagos de hoy se consultan en cada refresco: dan el interes cobrado hoy y el ultimo punto del grafico.
    const pagosHoy = await opcional('pagos de hoy', () => pagosDelDia(sucursalId, hoy), null);
    const [cobrosHoy, serie, promesas, anterior] = await Promise.all([
      opcional('cobros de hoy', () => cobrosDeHoy(sucursalId, hoy), null),
      opcional('serie del mes', () => serieDelMes(sucursalId, listaRutas, hoy, pagosHoy), null),
      opcional('promesas de pago', () => promesasPendientes(sucursalId, listaRutas), null),
      opcional('mes anterior', () => mesAnterior(sucursalId, mes), [])
    ]);

    const { metas, recaudo, interes } = porRuta({
      rutas: listaRutas,
      mes,
      aLaFecha,
      delMes,
      pagosHoy,
      metasDefinidas: leerMetas(metasFijas, archivoMetas, mes)
    });

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
      metas,
      interes,
      cobrosHoy,
      serie,
      promesas,
      mesAnterior: anterior
    };
  }

  /** Recaudo, meta e interes de cada ruta a partir de los reportes de eficiencia. */
  function porRuta({ rutas, mes, aLaFecha, delMes, pagosHoy, metasDefinidas }) {
    const filaDelMes = new Map((delMes.rows || []).map(f => [f.routeUuid, f]));
    const filaALaFecha = new Map((aLaFecha.rows || []).map(f => [f.routeUuid, f]));
    const metas = [];
    const recaudo = [];
    const interes = [];
    for (const r of rutas) {
      const fecha = filaALaFecha.get(r.uuid) || {};
      const completo = filaDelMes.get(r.uuid) || {};
      interes.push({
        gestorId: r.uuid,
        mes,
        cobrado: fecha.interestCollected || 0,
        capital: fecha.capitalCollected || 0,
        total: fecha.totalCollected || 0,
        programadoALaFecha: fecha.expectedInterest || 0,
        programadoMes: completo.expectedInterest || 0,
        hoy: pagosHoy ? (pagosHoy[r.uuid] && pagosHoy[r.uuid].interes) || 0 : null
      });
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

    return { metas, recaudo, interes };
  }

  return {
    nombre: 'controla-plus',
    /** Fuerza una consulta nueva (p. ej. tras cambiar una meta). */
    invalidar() {
      cache = null;
    },
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
