#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { crearApp } = require('./src/app');
const { crearAlmacen } = require('./src/almacen');
const { fechaHoy } = require('./src/metricas');
const { hashClave } = require('./src/auth');
const { crearUsuariosEnMemoria, crearUsuariosDesdeArchivo, validarUsuario } = require('./src/usuarios');
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

function fuenteReal(env, metas) {
  if (env.CONTROLA_USUARIO) {
    // Las credenciales llegan solo por variables de entorno; nunca se guardan en el repositorio.
    return crearFuenteControlaPlus({
      usuario: env.CONTROLA_USUARIO,
      clave: env.CONTROLA_CLAVE,
      sucursal: env.CONTROLA_SUCURSAL,
      archivoMetas: path.resolve(env.PORTAL_METAS || path.join(__dirname, 'datos', 'metas.json')),
      metas,
      metaPorcentaje: Number(env.PORTAL_META_PORCENTAJE || 100),
      cacheMs: Number(env.PORTAL_CACHE_MS || 60000)
    });
  }
  if (env.PORTAL_ARCHIVO_CARTERA) return crearFuenteArchivo(path.resolve(env.PORTAL_ARCHIVO_CARTERA));
  throw new Error('Define CONTROLA_USUARIO y CONTROLA_CLAVE (Controla+), PORTAL_ARCHIVO_CARTERA (JSON) o PORTAL_DEMO=1.');
}

async function main() {
  const env = process.env;
  const demo = env.PORTAL_DEMO === '1';
  const zonaHoraria = env.PORTAL_ZONA_HORARIA || undefined;
  const puerto = Number(env.PORT || 3000);

  if (demo && env.NODE_ENV === 'production') {
    throw new Error('PORTAL_DEMO=1 no se puede usar en produccion: las claves de demostracion son publicas.');
  }

  // Con PORTAL_DIR_DATOS (una carpeta en disco persistente) el administrador puede
  // cambiar usuarios, metas y apariencia desde el portal.
  const almacen = crearAlmacen(env.PORTAL_DIR_DATOS ? path.resolve(env.PORTAL_DIR_DATOS) : null);
  const metasDeEntorno = jsonDeEntorno('PORTAL_METAS_JSON');
  const hayMetas = metasDeEntorno || almacen.editable;
  // Lo guardado desde el portal tiene prioridad sobre las variables de entorno.
  const metas = () => {
    const meses = { ...(metasDeEntorno || {}) };
    for (const [mes, valores] of Object.entries(almacen.datos().metas || {})) meses[mes] = { ...meses[mes], ...valores };
    return meses;
  };

  let fuente;
  let usuarios;
  if (demo) {
    fuente = crearFuenteDemo({ fechaHoy: () => fechaHoy(zonaHoraria) });
    usuarios = await usuariosDemo();
  } else {
    fuente = fuenteReal(env, hayMetas ? metas : undefined);
    // En un hosting sin disco persistente, usuarios y metas se pasan como variables de entorno.
    const archivoUsuarios = path.resolve(env.PORTAL_USUARIOS || path.join(__dirname, 'datos', 'usuarios.json'));
    let iniciales = jsonDeEntorno('PORTAL_USUARIOS_JSON');
    if (!iniciales && almacen.editable && fs.existsSync(archivoUsuarios)) {
      iniciales = JSON.parse(fs.readFileSync(archivoUsuarios, 'utf8'));
    }
    if (Array.isArray(iniciales)) {
      // Punto de partida; en cuanto el administrador cambie algo, manda lo guardado en el almacen.
      almacen.sembrar({ usuarios: iniciales.filter(u => !validarUsuario(u)) });
    } else {
      usuarios = crearUsuariosDesdeArchivo(archivoUsuarios);
    }
  }

  const app = crearApp({
    fuente,
    usuarios,
    almacen,
    marca: {
      nombre: env.PORTAL_NOMBRE,
      tema: env.PORTAL_TEMA,
      ocultas: String(env.PORTAL_RUTAS_OCULTAS || '').split(',').map(t => t.trim()).filter(Boolean)
    },
    zonaHoraria,
    cookieSegura: env.PORTAL_COOKIE_SEGURA ? env.PORTAL_COOKIE_SEGURA !== '0' : !demo,
    intervaloMs: Number(env.PORTAL_INTERVALO_MS || 5000)
  });

  app.listen(puerto, () => {
    console.log(`[portal-gestores] escuchando en http://localhost:${puerto} (fuente: ${fuente.nombre})`);
    console.log(almacen.editable
      ? `[portal-gestores] cambios desde el portal guardados en ${almacen.dir}`
      : '[portal-gestores] sin PORTAL_DIR_DATOS: usuarios, metas y apariencia son de solo lectura');
    if (demo) console.log(`[portal-gestores] DEMO: usuarios ana, luis, marta y admin; clave ${CLAVE_DEMO}`);
  });
}

main().catch(err => {
  console.error(`[portal-gestores] ${err.message}`);
  process.exit(1);
});
