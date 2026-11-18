'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearFuenteControlaPlus } = require('../src/fuentes/controla-plus');
const { calcularResumen, calcularEquipo } = require('../src/metricas');

function tokenFalso(segundos) {
  const carga = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + segundos })).toString('base64url');
  return `x.${carga}.y`;
}

/** Simula la API de Controla+ con datos inventados y registra cada llamada. */
function apiFalsa() {
  const llamadas = [];
  const filaEficiencia = (esperado, cobrado, total) => ({
    routeUuid: 'R1',
    expectedCollection: esperado,
    collected: cobrado,
    totalCollected: total,
    interestCollected: 120,
    capitalCollected: total - 120,
    expectedInterest: esperado / 4
  });
  const respuestas = {
    'POST /auth/login': () => ({
      token: tokenFalso(3600),
      company_uuid: 'EMP',
      timezone: 'America/Managua',
      currency: 'NIO'
    }),
    'GET /company/get-one/EMP': () => ({ name: 'Creditos Ejemplo' }),
    'GET /branch/get-all-by-company/EMP': () => [{ uuid: 'SUC', isHeadquarters: true, isActive: true }],
    'GET /route/get-all': () => ({
      content: [
        { uuid: 'R1', name: 'Ruta Norte', isActive: true, assignedEmployee_fullName: 'Ana Torres' },
        { uuid: 'R2', name: 'Ruta Vieja', isActive: false }
      ]
    }),
    'POST /reports/collection-efficiency': cuerpo => ({
      currency: 'NIO',
      rows: [cuerpo.to.startsWith('2026-11-30') ? filaEficiencia(1000, 400, 500) : filaEficiencia(400, 300, 500)]
    }),
    'GET /collection-calendar/day-detail': () => ({
      clients: {
        totalPages: 1,
        content: [
          { routeUuid: 'R1', clientFullName: 'Cliente Uno', amount: 100, amountPaid: 100, installmentNumber: 2, totalPayments: 10 },
          { routeUuid: 'R1', clientFullName: 'Cliente Dos', amount: 50, amountPaid: 0, installmentNumber: 1, totalPayments: 5 }
        ]
      }
    }),
    'GET /collection-calendar/day-payments': () => ({ payments: { totalPages: 1, content: [{ routeUuid: 'R1', amount: 40, interestPaid: 9 }] } }),
    'GET /collection-calendar/monthly-summary': () => ({ days: { '2026-11-12': { totalAmount: 150 } } }),
    'POST /payment-promise/search': () => ({
      content: [{ clientFullName: 'Cliente Dos', promiseDate: '2026-11-14T06:00:00Z', promisedAmount: 50, fulfilledAmount: 0 }]
    }),
    'POST /reports/aging': cuerpo => ({
      generatedAt: '2026-11-12T20:00:00Z',
      pageInfo: { totalPages: 2 },
      rows: cuerpo.page === 0
        ? [{ loanUuid: 'L1', clientName: 'Cliente Uno', routeUuid: 'R1', outstandingBalance: 2000, totalOverdue: 500, daysPastDue: 40 }]
        : [{ loanUuid: 'L2', clientName: 'Cliente Dos', routeUuid: 'R1', outstandingBalance: 3000, totalOverdue: 0, daysPastDue: 0 }]
    })
  };
  const fetchImpl = async (url, opciones) => {
    const ruta = new URL(url).pathname;
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : null;
    llamadas.push({ metodo: opciones.method, ruta, cuerpo });
    const responder = respuestas[`${opciones.method} ${ruta}`];
    if (!responder) return { ok: false, status: 404, json: async () => ({ error: true }) };
    return { ok: true, status: 200, json: async () => ({ error: false, data: responder(cuerpo) }) };
  };
  return { fetchImpl, llamadas };
}

test('Controla+: arma la cartera por ruta y solo hace consultas', async () => {
  const { fetchImpl, llamadas } = apiFalsa();
  const fuente = crearFuenteControlaPlus({
    usuario: 'u',
    clave: 'c',
    fetchImpl,
    reloj: () => new Date('2026-11-12T18:00:00Z')
  });

  const cartera = await fuente.obtenerCartera();
  assert.equal(cartera.hoy, '2026-11-12');
  assert.equal(cartera.moneda, 'NIO');
  assert.equal(cartera.empresa, 'Creditos Ejemplo');
  assert.deepEqual(cartera.gestores, [{ id: 'R1', ruta: 'Ruta Norte', nombre: 'Ruta Norte (Ana Torres)' }]);
  assert.equal(cartera.creditos.length, 2);

  const r = calcularResumen(cartera, 'R1', cartera.hoy);
  assert.equal(r.recuperacion.porcentaje, 75);
  assert.equal(r.recuperacion.aLaFecha, true);
  assert.equal(r.mora.indice, 10);
  assert.equal(r.meta.monto, 1000);
  assert.equal(r.meta.recaudado, 500);
  assert.equal(r.meta.origen, 'programado');

  assert.deepEqual({ ...r.hoy, clientes: r.hoy.clientes.length },
    { programado: 150, cobrado: 100, porcentaje: 66.7, total: 2, pendientes: 1, clientes: 2 });
  assert.equal(r.hoy.clientes[0].cliente, 'Cliente Dos');
  assert.equal(r.serie.length, 30);
  assert.deepEqual(r.serie[11], { dia: 12, programado: 150, cobrado: 40 });
  assert.equal(r.serie[12].cobrado, null);
  assert.deepEqual(r.promesas, [{ cliente: 'Cliente Dos', fecha: '2026-11-14', monto: 50, cumplido: 0 }]);
  assert.equal(r.mesAnterior.cobrado, 500);
  // El interes no llega a la vista del gestor, solo a la del administrador.
  assert.equal(r.interes, undefined);
  const [equipo] = calcularEquipo(cartera, cartera.hoy);
  assert.deepEqual(equipo.interes, {
    cobrado: 120, capital: 380, total: 500, programadoALaFecha: 100, programadoMes: 250, hoy: 9, porcentaje: 120
  });

  const usadas = new Set(llamadas.map(l => `${l.metodo} ${l.ruta}`));
  assert.deepEqual([...usadas].sort(), [
    'GET /branch/get-all-by-company/EMP',
    'GET /collection-calendar/day-detail',
    'GET /collection-calendar/day-payments',
    'GET /collection-calendar/monthly-summary',
    'GET /company/get-one/EMP',
    'GET /route/get-all',
    'POST /auth/login',
    'POST /payment-promise/search',
    'POST /reports/aging',
    'POST /reports/collection-efficiency'
  ]);

  // Dentro de la ventana de cache no se vuelve a consultar.
  const antes = llamadas.length;
  await fuente.obtenerCartera();
  assert.equal(llamadas.length, antes);
});

test('Controla+: meta definida por nombre de ruta, o porcentaje de lo programado', async () => {
  const opciones = { usuario: 'u', clave: 'c', reloj: () => new Date('2026-11-12T18:00:00Z') };

  const conPorcentaje = crearFuenteControlaPlus({ ...opciones, fetchImpl: apiFalsa().fetchImpl, metaPorcentaje: 95 });
  const calculada = (await conPorcentaje.obtenerCartera()).metas[0];
  assert.deepEqual(calculada, { gestorId: 'R1', mes: '2026-11', monto: 950, origen: 'programado', porcentaje: 95 });

  const conMeta = crearFuenteControlaPlus({
    ...opciones,
    fetchImpl: apiFalsa().fetchImpl,
    metaPorcentaje: 95,
    metas: { '2026-11': { 'Ruta Norte': 800 } }
  });
  assert.deepEqual((await conMeta.obtenerCartera()).metas[0], {
    gestorId: 'R1',
    mes: '2026-11',
    monto: 800,
    origen: 'definida'
  });
});

test('Controla+: sin credenciales o con login rechazado falla con un mensaje claro', async () => {
  assert.throws(() => crearFuenteControlaPlus({ usuario: '', clave: '' }), /faltan usuario y clave/);
  const fuente = crearFuenteControlaPlus({
    usuario: 'u',
    clave: 'mala',
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: true }) })
  });
  await assert.rejects(fuente.obtenerCartera(), /no se pudo iniciar sesion \(HTTP 401\)/);
});
