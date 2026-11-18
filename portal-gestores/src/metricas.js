'use strict';

/**
 * Calculo de indicadores por gestor. Todo se filtra por gestorId aqui, en el
 * servidor: al navegador de un gestor solo llega el resultado de su cartera.
 */

const TRAMOS = [
  { etiqueta: '1-30', min: 1, max: 30 },
  { etiqueta: '31-60', min: 31, max: 60 },
  { etiqueta: '61-90', min: 61, max: 90 },
  { etiqueta: '+90', min: 91, max: Infinity }
];

const MAX_CLIENTES_EN_MORA = 10;

function monto(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function redondear(n) {
  return Math.round(n * 100) / 100;
}

function porcentaje(parte, total) {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : null;
}

function fechaHoy(zonaHoraria, ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(ahora);
}

function pagosDelMes(cartera, gestorId, mes) {
  const gestorPorCredito = new Map();
  for (const c of cartera.creditos || []) {
    if (c && c.id !== undefined) gestorPorCredito.set(String(c.id), c.gestorId);
  }
  return (cartera.pagos || []).filter(p => {
    if (!p || typeof p.fecha !== 'string' || p.fecha.slice(0, 7) !== mes) return false;
    const gestor = p.gestorId !== undefined ? p.gestorId : gestorPorCredito.get(String(p.creditoId));
    return gestor === gestorId;
  });
}

function calcularMora(creditos) {
  const saldoTotal = creditos.reduce((s, c) => s + monto(c.saldo), 0);
  const enMora = creditos.filter(c => monto(c.diasMora) > 0 && monto(c.saldoVencido) > 0);
  const saldoVencido = enMora.reduce((s, c) => s + monto(c.saldoVencido), 0);

  const tramos = TRAMOS.map(t => {
    const delTramo = enMora.filter(c => c.diasMora >= t.min && c.diasMora <= t.max);
    return {
      etiqueta: t.etiqueta,
      clientes: delTramo.length,
      monto: redondear(delTramo.reduce((s, c) => s + monto(c.saldoVencido), 0))
    };
  });

  const clientes = enMora
    .slice()
    .sort((a, b) => b.diasMora - a.diasMora)
    .slice(0, MAX_CLIENTES_EN_MORA)
    .map(c => ({
      cliente: String(c.cliente || c.id),
      diasMora: Math.floor(monto(c.diasMora)),
      saldoVencido: redondear(monto(c.saldoVencido))
    }));

  return {
    indice: porcentaje(saldoVencido, saldoTotal),
    saldoVencido: redondear(saldoVencido),
    saldoTotal: redondear(saldoTotal),
    clientesEnMora: enMora.length,
    clientesTotal: creditos.length,
    tramos,
    clientes
  };
}

function calcularMeta(metaMonto, recaudado, dia, diasDelMes) {
  if (!(metaMonto > 0)) return null;
  const faltante = Math.max(metaMonto - recaudado, 0);
  const esperadoAHoy = (metaMonto * dia) / diasDelMes;
  const diasRestantes = diasDelMes - dia + 1;
  let ritmo = 'atrasado';
  if (recaudado >= metaMonto) ritmo = 'cumplida';
  else if (recaudado >= esperadoAHoy) ritmo = 'al-dia';
  return {
    monto: redondear(metaMonto),
    recaudado: redondear(recaudado),
    cumplimiento: porcentaje(recaudado, metaMonto),
    faltante: redondear(faltante),
    esperadoAHoy: redondear(esperadoAHoy),
    avanceEsperado: porcentaje(esperadoAHoy, metaMonto),
    necesarioPorDia: redondear(faltante / diasRestantes),
    diasRestantes,
    ritmo
  };
}

/**
 * @param {object} cartera  { creditos, pagos, metas, actualizado }
 * @param {string} gestorId gestor cuya cartera se resume
 * @param {string} hoy      fecha local 'YYYY-MM-DD'
 */
function calcularResumen(cartera, gestorId, hoy) {
  const mes = hoy.slice(0, 7);
  const [anio, mesNumero, dia] = hoy.split('-').map(Number);
  const diasDelMes = new Date(Date.UTC(anio, mesNumero, 0)).getUTCDate();

  const creditos = (cartera.creditos || []).filter(c => c && c.gestorId === gestorId);
  const pagos = pagosDelMes(cartera, gestorId, mes);

  // Una fuente puede entregar el recaudo ya agregado por gestor (p. ej. un
  // reporte del sistema de cartera); si no, se calcula de pagos y cuotas.
  const agregado = (cartera.recaudo || []).find(r => r && r.gestorId === gestorId && r.mes === mes);
  const recaudado = agregado ? monto(agregado.recaudado) : pagos.reduce((s, p) => s + monto(p.monto), 0);
  const porCobrar = agregado ? monto(agregado.porCobrar) : creditos.reduce((s, c) => s + monto(c.cuotaMes), 0);
  const recaudadoMes = agregado && agregado.recaudadoMes !== undefined ? monto(agregado.recaudadoMes) : recaudado;
  const meta = (cartera.metas || []).find(m => m && m.gestorId === gestorId && m.mes === mes);
  const resumenMeta = calcularMeta(meta ? monto(meta.monto) : 0, recaudadoMes, dia, diasDelMes);
  if (resumenMeta) {
    resumenMeta.origen = meta.origen || 'definida';
    if (meta.porcentaje) resumenMeta.porcentajeProgramado = meta.porcentaje;
  }

  return {
    gestorId,
    mes,
    dia,
    diasDelMes,
    moneda: cartera.moneda || null,
    actualizado: cartera.actualizado || null,
    recuperacion: {
      porcentaje: porcentaje(recaudado, porCobrar),
      recaudado: redondear(recaudado),
      porCobrar: redondear(porCobrar),
      pagos: agregado ? null : pagos.length,
      aLaFecha: Boolean(agregado && agregado.aLaFecha)
    },
    mora: calcularMora(creditos),
    meta: resumenMeta,
    hoy: cobrosDeHoy(cartera, gestorId),
    serie: serieDiaria(cartera, gestorId, pagos, mes, diasDelMes, dia),
    promesas: promesasDe(cartera, gestorId),
    mesAnterior: (cartera.mesAnterior || []).find(m => m && m.gestorId === gestorId) || null
  };
}

/** Cuotas programadas para hoy; null si la fuente no las entrega. */
function cobrosDeHoy(cartera, gestorId) {
  if (!Array.isArray(cartera.cobrosHoy)) return null;
  const clientes = cartera.cobrosHoy
    .filter(c => c && c.gestorId === gestorId)
    .map(c => ({
      cliente: String(c.cliente || 'Cliente'),
      monto: redondear(monto(c.monto)),
      pagado: redondear(monto(c.pagado)),
      cuota: c.cuota || null
    }))
    // Primero lo que falta por cobrar, de mayor a menor.
    .sort((a, b) => (b.monto - b.pagado) - (a.monto - a.pagado));
  const programado = clientes.reduce((s, c) => s + c.monto, 0);
  const cobrado = clientes.reduce((s, c) => s + Math.min(c.pagado, c.monto), 0);
  return {
    programado: redondear(programado),
    cobrado: redondear(cobrado),
    porcentaje: porcentaje(cobrado, programado),
    total: clientes.length,
    pendientes: clientes.filter(c => c.pagado < c.monto).length,
    clientes
  };
}

/** Un punto por dia del mes: programado y cobrado (cobrado null en dias futuros). */
function serieDiaria(cartera, gestorId, pagos, mes, diasDelMes, dia) {
  if (Array.isArray(cartera.serie)) {
    const puntos = cartera.serie
      .filter(p => p && p.gestorId === gestorId && String(p.fecha).slice(0, 7) === mes)
      .map(p => ({
        dia: Number(String(p.fecha).slice(8, 10)),
        programado: redondear(monto(p.programado)),
        cobrado: p.cobrado === null || p.cobrado === undefined ? null : redondear(monto(p.cobrado))
      }))
      .sort((a, b) => a.dia - b.dia);
    return puntos.length ? puntos : null;
  }
  if (pagos.length === 0) return null;
  const porDia = new Map();
  for (const p of pagos) {
    const d = Number(p.fecha.slice(8, 10));
    porDia.set(d, (porDia.get(d) || 0) + monto(p.monto));
  }
  return Array.from({ length: diasDelMes }, (_, i) => ({
    dia: i + 1,
    programado: null,
    cobrado: i + 1 <= dia ? redondear(porDia.get(i + 1) || 0) : null
  }));
}

function promesasDe(cartera, gestorId) {
  if (!Array.isArray(cartera.promesas)) return null;
  return cartera.promesas
    .filter(p => p && p.gestorId === gestorId)
    .map(p => ({
      cliente: String(p.cliente || 'Cliente'),
      fecha: String(p.fecha || ''),
      monto: redondear(monto(p.monto)),
      cumplido: redondear(monto(p.cumplido))
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .slice(0, 20);
}

function idsDeGestores(cartera) {
  const ids = new Set();
  for (const g of cartera.gestores || []) if (g && g.id) ids.add(g.id);
  for (const c of cartera.creditos || []) if (c && c.gestorId) ids.add(c.gestorId);
  for (const m of cartera.metas || []) if (m && m.gestorId) ids.add(m.gestorId);
  return [...ids].sort();
}

/**
 * Interes cobrado por un gestor en el mes. Solo se calcula para la vista del
 * administrador: es un dato de rentabilidad, no de la gestion de cobro.
 */
function interesDe(cartera, gestorId, mes) {
  const fila = (cartera.interes || []).find(i => i && i.gestorId === gestorId && i.mes === mes);
  if (!fila) return null;
  const cobrado = monto(fila.cobrado);
  return {
    cobrado: redondear(cobrado),
    capital: redondear(monto(fila.capital)),
    total: redondear(monto(fila.total)),
    programadoALaFecha: redondear(monto(fila.programadoALaFecha)),
    programadoMes: redondear(monto(fila.programadoMes)),
    hoy: fila.hoy === null || fila.hoy === undefined ? null : redondear(monto(fila.hoy)),
    porcentaje: porcentaje(cobrado, monto(fila.programadoALaFecha))
  };
}

/** Vista del administrador: un resumen por cada gestor. */
function calcularEquipo(cartera, hoy) {
  const nombres = new Map((cartera.gestores || []).filter(Boolean).map(g => [g.id, g.nombre]));
  return idsDeGestores(cartera)
    .map(id => {
      const resumen = calcularResumen(cartera, id, hoy);
      // El administrador ve totales por gestor, no el detalle de cada cliente.
      delete resumen.mora.clientes;
      delete resumen.serie;
      if (resumen.hoy) delete resumen.hoy.clientes;
      resumen.promesas = resumen.promesas ? resumen.promesas.length : null;
      resumen.interes = interesDe(cartera, id, resumen.mes);
      return { ...resumen, nombre: nombres.get(id) || id };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

module.exports = { calcularResumen, calcularEquipo, fechaHoy };
