#!/usr/bin/env node
'use strict';

const path = require('path');
const { crearApp } = require('./src/app');
const { fechaHoy } = require('./src/metricas');
const { hashClave } = require('./src/auth');
const { crearUsuariosEnMemoria, crearUsuariosDesdeArchivo } = require('./src/usuarios');
const { crearFuenteArchivo } = require('./src/fuentes/archivo-json');
const { crearFuenteDemo, GESTORES } = require('./src/fuentes/demo');

const CLAVE_DEMO = 'demo1234';

async function usuariosDemo() {
  const clave = await hashClave(CLAVE_DEMO);
  const gestores = GESTORES.map(g => ({
    usuario: g.nombre.split(' ')[0].toLowerCase(),
    nombre: g.nombre,
    rol: 'gestor',
    gestorId: g.id,
    clave
  }));
  return crearUsuariosEnMemoria([...gestores, { usuario: 'admin', nombre: 'Administrador', rol: 'admin', clave }]);
}

async function main() {
  const env = process.env;
  const demo = env.PORTAL_DEMO === '1';
  const zonaHoraria = env.PORTAL_ZONA_HORARIA || undefined;
  const puerto = Number(env.PORT || 3000);

  if (demo && env.NODE_ENV === 'production') {
    throw new Error('PORTAL_DEMO=1 no se puede usar en produccion: las claves de demostracion son publicas.');
  }

  let fuente;
  let usuarios;
  if (demo) {
    fuente = crearFuenteDemo({ fechaHoy: () => fechaHoy(zonaHoraria) });
    usuarios = await usuariosDemo();
  } else {
    if (!env.PORTAL_ARCHIVO_CARTERA) {
      throw new Error('Define PORTAL_ARCHIVO_CARTERA (ruta al JSON de cartera) o usa PORTAL_DEMO=1 para probar.');
    }
    fuente = crearFuenteArchivo(path.resolve(env.PORTAL_ARCHIVO_CARTERA));
    usuarios = crearUsuariosDesdeArchivo(path.resolve(env.PORTAL_USUARIOS || path.join(__dirname, 'datos', 'usuarios.json')));
  }

  const app = crearApp({
    fuente,
    usuarios,
    zonaHoraria,
    cookieSegura: env.PORTAL_COOKIE_SEGURA ? env.PORTAL_COOKIE_SEGURA !== '0' : !demo,
    intervaloMs: Number(env.PORTAL_INTERVALO_MS || 5000)
  });

  app.listen(puerto, () => {
    console.log(`[portal-gestores] escuchando en http://localhost:${puerto} (fuente: ${fuente.nombre})`);
    if (demo) console.log(`[portal-gestores] DEMO: usuarios ana, luis, marta y admin; clave ${CLAVE_DEMO}`);
  });
}

main().catch(err => {
  console.error(`[portal-gestores] ${err.message}`);
  process.exit(1);
});
