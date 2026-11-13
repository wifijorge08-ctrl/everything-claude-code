#!/usr/bin/env node
'use strict';

const path = require('path');
const { crearApp } = require('./src/app');
const { fechaHoy } = require('./src/metricas');
const { hashClave } = require('./src/auth');
const { crearUsuariosEnMemoria, crearUsuariosDesdeArchivo } = require('./src/usuarios');
const { crearFuenteArchivo } = require('./src/fuentes/archivo-json');
const { crearFuenteControlaPlus } = require('./src/fuentes/controla-plus');
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

function jsonDeEntorno(nombre) {
  const texto = process.env[nombre];
  if (!texto) return undefined;
  try {
    return JSON.parse(texto);
  } catch (_err) {
    throw new Error(`${nombre} no es JSON valido.`);
  }
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
    if (env.CONTROLA_USUARIO) {
      // Las credenciales llegan solo por variables de entorno; nunca se guardan en el repositorio.
      fuente = crearFuenteControlaPlus({
        usuario: env.CONTROLA_USUARIO,
        clave: env.CONTROLA_CLAVE,
        sucursal: env.CONTROLA_SUCURSAL,
        archivoMetas: path.resolve(env.PORTAL_METAS || path.join(__dirname, 'datos', 'metas.json')),
        metas: jsonDeEntorno('PORTAL_METAS_JSON'),
        metaPorcentaje: Number(env.PORTAL_META_PORCENTAJE || 100),
        cacheMs: Number(env.PORTAL_CACHE_MS || 60000)
      });
    } else if (env.PORTAL_ARCHIVO_CARTERA) {
      fuente = crearFuenteArchivo(path.resolve(env.PORTAL_ARCHIVO_CARTERA));
    } else {
      throw new Error('Define CONTROLA_USUARIO y CONTROLA_CLAVE (Controla+), PORTAL_ARCHIVO_CARTERA (JSON) o PORTAL_DEMO=1.');
    }
    // En un hosting sin disco persistente, usuarios y metas se pasan como variables de entorno.
    const usuariosDeEntorno = jsonDeEntorno('PORTAL_USUARIOS_JSON');
    usuarios = usuariosDeEntorno
      ? crearUsuariosEnMemoria(usuariosDeEntorno)
      : crearUsuariosDesdeArchivo(path.resolve(env.PORTAL_USUARIOS || path.join(__dirname, 'datos', 'usuarios.json')));
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
