'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularResumen, calcularEquipo } = require('../src/metricas');
const { hashClave, verificarClave, Sesiones, Limitador } = require('../src/auth');
const { crearUsuariosEnMemoria } = require('../src/usuarios');
const { crearApp } = require('../src/app');

const HOY = '2026-11-10';
const CARTERA = {
  actualizado: '2026-11-10T15:00:00Z',
  gestores: [{ id: 'G01', nombre: 'Ana' }, { id: 'G02', nombre: 'Luis' }],
  creditos: [
    { id: 'A1', cliente: 'Cliente A1', gestorId: 'G01', saldo: 1000, saldoVencido: 0, diasMora: 0, cuotaMes: 200 },
    { id: 'A2', cliente: 'Cliente A2', gestorId: 'G01', saldo: 3000, saldoVencido: 400, diasMora: 45, cuotaMes: 600 },
    { id: 'B1', cliente: 'Cliente B1', gestorId: 'G02', saldo: 5000, saldoVencido: 2500, diasMora: 95, cuotaMes: 3000 }
  ],
  pagos: [
    { creditoId: 'A1', gestorId: 'G01', fecha: '2026-11-03', monto: 200 },
    { creditoId: 'A2', fecha: '2026-11-08', monto: 200 },
    { creditoId: 'A1', gestorId: 'G01', fecha: '2026-10-28', monto: 999 },
    { creditoId: 'B1', gestorId: 'G02', fecha: '2026-11-05', monto: 300 }
  ],
  metas: [{ gestorId: 'G01', mes: '2026-11', monto: 600 }]
};

test('calcularResumen: recuperacion, mora y meta del gestor', () => {
  const r = calcularResumen(CARTERA, 'G01', HOY);
  assert.deepEqual(r.recuperacion, { porcentaje: 50, recaudado: 400, porCobrar: 800, pagos: 2 });
  assert.equal(r.mora.indice, 10);
  assert.equal(r.mora.clientesEnMora, 1);
  assert.deepEqual(r.mora.tramos.find(t => t.etiqueta === '31-60'), { etiqueta: '31-60', clientes: 1, monto: 400 });
  assert.equal(r.meta.cumplimiento, 66.7);
  assert.equal(r.meta.faltante, 200);
  assert.equal(r.meta.esperadoAHoy, 200);
  assert.equal(r.meta.ritmo, 'al-dia');
  assert.equal(r.meta.diasRestantes, 21);
});

test('calcularResumen: no mezcla carteras ni meses', () => {
  const texto = JSON.stringify(calcularResumen(CARTERA, 'G01', HOY));
  assert.ok(!texto.includes('Cliente B1'));
  const otro = calcularResumen(CARTERA, 'G02', HOY);
  assert.equal(otro.recuperacion.recaudado, 300);
  assert.equal(otro.meta, null);
  assert.equal(calcularResumen(CARTERA, 'NO-EXISTE', HOY).mora.indice, null);
});

test('calcularEquipo: un resumen por gestor, sin detalle de clientes', () => {
  const equipo = calcularEquipo(CARTERA, HOY);
  assert.deepEqual(equipo.map(g => g.nombre), ['Ana', 'Luis']);
  assert.equal(equipo[0].mora.clientes, undefined);
});

test('claves: hash con sal y verificacion', async () => {
  const hash = await hashClave('secreta-123');
  assert.notEqual(hash, await hashClave('secreta-123'));
  assert.equal(await verificarClave('secreta-123', hash), true);
  assert.equal(await verificarClave('otra', hash), false);
  assert.equal(await verificarClave('secreta-123', 'texto-plano'), false);
});

test('sesiones vencen y el limitador bloquea', () => {
  let ahora = 0;
  const sesiones = new Sesiones({ duracionMs: 100, reloj: () => ahora });
  const token = sesiones.crear({ usuario: 'ana' });
  assert.equal(sesiones.obtener(token).usuario, 'ana');
  ahora = 101;
  assert.equal(sesiones.obtener(token), null);

  const limitador = new Limitador({ maxFallos: 2, bloqueoMs: 50, reloj: () => ahora });
  limitador.fallo('k');
  assert.equal(limitador.bloqueado('k'), false);
  limitador.fallo('k');
  assert.equal(limitador.bloqueado('k'), true);
  ahora += 51;
  assert.equal(limitador.bloqueado('k'), false);
});

async function levantar() {
  const clave = await hashClave('clave-de-prueba');
  const usuarios = crearUsuariosEnMemoria([
    { usuario: 'ana', nombre: 'Ana', rol: 'gestor', gestorId: 'G01', clave },
    { usuario: 'luis', nombre: 'Luis', rol: 'gestor', gestorId: 'G02', clave },
    { usuario: 'jefe', nombre: 'Jefe', rol: 'admin', clave }
  ]);
  const app = crearApp({
    fuente: { obtenerCartera: async () => CARTERA },
    usuarios,
    cookieSegura: false,
    intervaloMs: 20,
    limitador: new Limitador({ maxFallos: 3 })
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  const entrar = async (usuario, claveTexto = 'clave-de-prueba') => {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, clave: claveTexto })
    });
    return { res, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  return { app, base, entrar };
}

test('API: cada gestor recibe solo su cartera', async t => {
  const { app, base, entrar } = await levantar();
  t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve); }));

  assert.equal((await fetch(`${base}/api/vista`)).status, 401);
  assert.equal((await fetch(`${base}/api/eventos`)).status, 401);

  const ana = await entrar('ana');
  assert.equal(ana.res.status, 200);
  assert.match(ana.res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);

  // Intentar pedir la cartera de otro gestor por parametro no cambia nada.
  const vistaAna = await (await fetch(`${base}/api/vista?gestorId=G02`, { headers: { cookie: ana.cookie } })).json();
  assert.equal(vistaAna.tipo, 'gestor');
  assert.equal(vistaAna.resumen.gestorId, 'G01');
  assert.ok(!JSON.stringify(vistaAna).includes('Cliente B1'));

  const luis = await entrar('luis');
  const vistaLuis = await (await fetch(`${base}/api/vista`, { headers: { cookie: luis.cookie } })).json();
  assert.equal(vistaLuis.resumen.gestorId, 'G02');
  assert.ok(!JSON.stringify(vistaLuis).includes('Cliente A'));

  const jefe = await entrar('jefe');
  const vistaJefe = await (await fetch(`${base}/api/vista`, { headers: { cookie: jefe.cookie } })).json();
  assert.equal(vistaJefe.tipo, 'admin');
  assert.equal(vistaJefe.equipo.length, 2);

  await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie: ana.cookie } });
  assert.equal((await fetch(`${base}/api/vista`, { headers: { cookie: ana.cookie } })).status, 401);
});

test('API: flujo en vivo y bloqueo por intentos fallidos', async t => {
  const { app, base, entrar } = await levantar();
  t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve); }));

  const ana = await entrar('ana');
  const flujo = await fetch(`${base}/api/eventos`, { headers: { cookie: ana.cookie } });
  assert.match(flujo.headers.get('content-type'), /text\/event-stream/);
  const lector = flujo.body.getReader();
  const primero = new TextDecoder().decode((await lector.read()).value);
  assert.match(primero, /^event: vista\ndata: \{"tipo":"gestor"/);
  assert.ok(!primero.includes('Cliente B1'));
  await lector.cancel();

  assert.equal((await entrar('ana', 'mala')).res.status, 401);
  assert.equal((await entrar('nadie', 'mala')).res.status, 401);
  assert.equal((await entrar('ana', 'mala')).res.status, 401);
  assert.equal((await entrar('ana', 'mala')).res.status, 401);
  assert.equal((await entrar('ana')).res.status, 429);
});
