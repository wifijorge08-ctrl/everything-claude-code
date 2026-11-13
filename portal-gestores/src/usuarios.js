'use strict';

const fs = require('fs');

const ROLES = ['gestor', 'admin'];

function validarUsuario(u) {
  if (!u || typeof u.usuario !== 'string' || !/^[a-z0-9._-]{3,40}$/.test(u.usuario)) {
    return 'usuario invalido (3-40 caracteres: a-z, 0-9, punto, guion)';
  }
  if (!ROLES.includes(u.rol)) return `rol invalido (${ROLES.join(' | ')})`;
  if (u.rol === 'gestor' && (typeof u.gestorId !== 'string' || !u.gestorId)) {
    return 'un gestor necesita gestorId';
  }
  if (typeof u.clave !== 'string' || !u.clave.startsWith('scrypt$')) return 'clave sin hash';
  return null;
}

function indexar(lista) {
  const mapa = new Map();
  for (const u of Array.isArray(lista) ? lista : []) {
    const error = validarUsuario(u);
    if (error) {
      console.error(`[portal-gestores] usuario omitido (${u && u.usuario}): ${error}`);
      continue;
    }
    mapa.set(u.usuario, u);
  }
  return mapa;
}

function normalizar(nombre) {
  return String(nombre || '').trim().toLowerCase();
}

function crearUsuariosEnMemoria(lista) {
  const mapa = indexar(lista);
  return { buscar: nombre => mapa.get(normalizar(nombre)) || null };
}

/** Lee usuarios.json y lo recarga cuando cambia, sin reiniciar el servidor. */
function crearUsuariosDesdeArchivo(ruta) {
  let mapa = new Map();
  let ultimaModificacion = -1;

  function recargar() {
    let stat;
    try {
      stat = fs.statSync(ruta);
    } catch (_err) {
      mapa = new Map();
      ultimaModificacion = -1;
      return;
    }
    if (stat.mtimeMs === ultimaModificacion) return;
    try {
      mapa = indexar(JSON.parse(fs.readFileSync(ruta, 'utf8')));
      ultimaModificacion = stat.mtimeMs;
    } catch (err) {
      console.error(`[portal-gestores] no se pudo leer ${ruta}: ${err.message}`);
    }
  }

  return {
    buscar(nombre) {
      recargar();
      return mapa.get(normalizar(nombre)) || null;
    }
  };
}

module.exports = { crearUsuariosEnMemoria, crearUsuariosDesdeArchivo, validarUsuario, ROLES };
