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
  if (resumenMeta) resumenMeta.origen = meta.origen || 'definida';

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
    meta: resumenMeta
  };
}

function idsDeGestores(cartera) {
  const ids = new Set();
  for (const g of cartera.gestores || []) if (g && g.id) ids.add(g.id);
  for (const c of cartera.creditos || []) if (c && c.gestorId) ids.add(c.gestorId);
  for (const m of cartera.metas || []) if (m && m.gestorId) ids.add(m.gestorId);
  return [...ids].sort();
}

/** Vista del administrador: un resumen por cada gestor. */
function calcularEquipo(cartera, hoy) {
  const nombres = new Map((cartera.gestores || []).filter(Boolean).map(g => [g.id, g.nombre]));
  return idsDeGestores(cartera)
    .map(id => {
      const resumen = calcularResumen(cartera, id, hoy);
      delete resumen.mora.clientes;
      return { ...resumen, nombre: nombres.get(id) || id };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

module.exports = { calcularResumen, calcularEquipo, fechaHoy };
