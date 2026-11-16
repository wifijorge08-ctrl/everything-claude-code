'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hashClave } = require('../src/auth');
const { crearAlmacen } = require('../src/almacen');
const { crearApp } = require('../src/app');

const CARTERA = {
  hoy: '2026-11-10',
  gestores: [{ id: 'G01', ruta: 'Norte', nombre: 'Norte (Ana)' }, { id: 'G02', ruta: 'Sur', nombre: 'Sur (Luis)' }],
  creditos: [
    { id: 'A1', cliente: 'Cliente A1', gestorId: 'G01', saldo: 1000, saldoVencido: 0, diasMora: 0, cuotaMes: 200 },
    { id: 'B1', cliente: 'Cliente B1', gestorId: 'G02', saldo: 5000, saldoVencido: 2500, diasMora: 95, cuotaMes: 3000 }
  ],
  pagos: [],
  metas: []
};

async function levantar(t, dir) {
  const clave = await hashClave('clave-de-prueba');
  const almacen = crearAlmacen(dir);
  almacen.sembrar({
    usuarios: [
      { usuario: 'ana', nombre: 'Ana', rol: 'gestor', gestorId: 'G01', clave },
      { usuario: 'jefe', nombre: 'Jefe', rol: 'admin', clave }
    ]
  });
  const fuente = { obtenerCartera: async () => CARTERA, invalidar() { fuente.invalidaciones += 1; }, invalidaciones: 0 };
  const app = crearApp({ fuente, almacen, cookieSegura: false, intervaloMs: 20 });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve); }));
  const base = `http://127.0.0.1:${app.address().port}`;
  const pedir = async (cookie, metodo, ruta, cuerpo, tipo) => {
    const res = await fetch(base + ruta, {
      method: metodo,
      headers: { cookie: cookie || '', ...(cuerpo === undefined ? {} : { 'Content-Type': tipo || 'application/json' }) },
      body: cuerpo === undefined ? undefined : tipo ? cuerpo : JSON.stringify(cuerpo)
    });
    return { estado: res.status, datos: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const entrar = async (usuario, claveTexto = 'clave-de-prueba') => pedir('', 'POST', '/api/login', { usuario, clave: claveTexto });
  return { pedir, entrar, almacen, fuente };
}

test('sin almacenamiento los ajustes son de solo lectura', async t => {
  const { pedir, entrar } = await levantar(t, null);
  const jefe = (await entrar('jefe')).cookie;
  const ajustes = await pedir(jefe, 'GET', '/api/admin/ajustes');
  assert.equal(ajustes.estado, 200);
  assert.equal(ajustes.datos.editable, false);
  assert.deepEqual(ajustes.datos.usuarios.map(u => u.usuario), ['ana', 'jefe']);
  assert.ok(!JSON.stringify(ajustes.datos).includes('scrypt'));
  assert.equal((await pedir(jefe, 'PUT', '/api/admin/metas', { metas: { G01: 500 } })).estado, 409);
  assert.equal((await pedir(jefe, 'POST', '/api/clave', { actual: 'clave-de-prueba', nueva: 'otra-clave-123' })).estado, 409);
  assert.equal((await pedir(jefe, 'GET', '/api/yo')).datos.puedeCambiarClave, false);
});

test('un gestor no puede usar los ajustes del administrador', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { pedir, entrar } = await levantar(t, dir);
  const ana = (await entrar('ana')).cookie;
  assert.equal((await pedir(ana, 'GET', '/api/admin/ajustes')).estado, 403);
  assert.equal((await pedir(ana, 'PUT', '/api/admin/metas', { metas: { G01: 1 } })).estado, 403);
  assert.equal((await pedir(ana, 'POST', '/api/admin/usuarios', { usuario: 'x', rol: 'admin', clave: 'clave-larga-1' })).estado, 403);
  assert.equal((await pedir('', 'GET', '/api/admin/ajustes')).estado, 401);
});

test('el administrador guarda metas, usuarios, apariencia y carteras ocultas', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { pedir, entrar, almacen, fuente } = await levantar(t, dir);
  const jefe = (await entrar('jefe')).cookie;

  assert.equal((await pedir(jefe, 'PUT', '/api/admin/metas', { metas: { G01: 900, G02: null } })).estado, 200);
  assert.deepEqual(almacen.datos().metas, { '2026-11': { G01: 900 } });
  assert.equal(fuente.invalidaciones, 1);
  assert.equal((await pedir(jefe, 'PUT', '/api/admin/metas', { metas: { NOEXISTE: 5 } })).estado, 400);
  assert.equal((await pedir(jefe, 'PUT', '/api/admin/metas', { metas: { G01: -3 } })).estado, 400);

  assert.equal((await pedir(jefe, 'POST', '/api/admin/usuarios', { usuario: 'luis', nombre: 'Luis', rol: 'gestor', gestorId: 'G02', clave: 'corta' })).estado, 400);
  assert.equal((await pedir(jefe, 'POST', '/api/admin/usuarios', { usuario: 'luis', nombre: 'Luis', rol: 'gestor', gestorId: 'NO', clave: 'clave-larga-1' })).estado, 400);
  assert.equal((await pedir(jefe, 'POST', '/api/admin/usuarios', { usuario: 'luis', nombre: 'Luis', rol: 'gestor', gestorId: 'G02', clave: 'clave-larga-1' })).estado, 200);
  const luis = await entrar('luis', 'clave-larga-1');
  assert.equal(luis.estado, 200);
  assert.equal((await pedir(luis.cookie, 'GET', '/api/vista')).datos.resumen.gestorId, 'G02');

  // Cambiarle la clave cierra su sesion abierta.
  assert.equal((await pedir(jefe, 'POST', '/api/admin/usuarios', { usuario: 'luis', nombre: 'Luis', rol: 'gestor', gestorId: 'G02', clave: 'clave-nueva-22' })).estado, 200);
  assert.equal((await pedir(luis.cookie, 'GET', '/api/vista')).estado, 401);
  assert.equal((await entrar('luis', 'clave-larga-1')).estado, 401);

  assert.equal((await pedir(jefe, 'DELETE', '/api/admin/usuarios?usuario=jefe')).estado, 400);
  assert.equal((await pedir(jefe, 'DELETE', '/api/admin/usuarios?usuario=luis')).estado, 200);
  assert.equal((await entrar('luis', 'clave-nueva-22')).estado, 401);

  assert.equal((await pedir(jefe, 'PUT', '/api/admin/apariencia', { tema: 'rosa' })).estado, 400);
  assert.equal((await pedir(jefe, 'PUT', '/api/admin/apariencia', { nombre: 'Mi Empresa', tema: 'verde', ocultas: ['G02', 'NO'] })).estado, 200);
  assert.deepEqual((await pedir('', 'GET', '/api/config')).datos, { nombre: 'Mi Empresa', tema: 'verde', logo: null, editable: true });
  assert.deepEqual((await pedir(jefe, 'GET', '/api/vista')).datos.equipo.map(g => g.gestorId), ['G01']);

  // Lo guardado sobrevive a un reinicio.
  const guardado = JSON.parse(fs.readFileSync(path.join(dir, 'portal.json'), 'utf8'));
  assert.deepEqual(guardado.usuarios.map(u => u.usuario), ['ana', 'jefe']);
  assert.equal(crearAlmacen(dir).datos().ajustes.nombre, 'Mi Empresa');
});

test('cada usuario cambia su propia clave; el logo solo acepta imagenes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { pedir, entrar } = await levantar(t, dir);
  const ana = (await entrar('ana')).cookie;
  assert.equal((await pedir(ana, 'GET', '/api/yo')).datos.puedeCambiarClave, true);
  assert.equal((await pedir(ana, 'POST', '/api/clave', { actual: 'incorrecta', nueva: 'clave-nueva-33' })).estado, 400);
  assert.equal((await pedir(ana, 'POST', '/api/clave', { actual: 'clave-de-prueba', nueva: 'corta' })).estado, 400);
  assert.equal((await pedir(ana, 'POST', '/api/clave', { actual: 'clave-de-prueba', nueva: 'clave-nueva-33' })).estado, 200);
  assert.equal((await entrar('ana')).estado, 401);
  assert.equal((await entrar('ana', 'clave-nueva-33')).estado, 200);

  const jefe = (await entrar('jefe')).cookie;
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await pedir(jefe, 'PUT', '/api/admin/logo', svg, 'image/svg+xml')).estado, 400);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  assert.equal((await pedir(ana, 'PUT', '/api/admin/logo', png, 'image/png')).estado, 403);
  const subido = await pedir(jefe, 'PUT', '/api/admin/logo', png, 'image/png');
  assert.equal(subido.estado, 200);
  assert.match(subido.datos.marca.logo, /^\/logo\?v=\d+$/);
  assert.equal((await pedir(jefe, 'DELETE', '/api/admin/logo')).datos.marca.logo, null);
});
