'use strict';

const fs = require('fs');
const path = require('path');
const { hashClave, verificarClave } = require('./auth');
const { validarUsuario } = require('./usuarios');
const { CABECERAS_SEGURIDAD, errorHttp, responderJson, leerCuerpo, leerCuerpoJson } = require('./http-util');

const TEMAS = ['azul', 'verde', 'morado', 'grafito'];
const LIMITE_LOGO = 300 * 1024;
const CLAVE_MINIMA = 8;

/** Reconoce PNG, JPEG y WebP por sus primeros bytes; no se aceptan SVG ni otros formatos. */
function tipoDeImagen(bytes) {
  if (bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function crearAdmin({ almacen, fuente, sesiones, hoy, marca = {} }) {
  const ajustes = () => almacen.datos().ajustes || {};
  const usuarios = () => almacen.datos().usuarios || [];
  const rutaLogo = () => (almacen.dir ? path.join(almacen.dir, 'logo') : null);

  function configuracion() {
    const a = ajustes();
    return {
      nombre: a.nombre || marca.nombre || null,
      tema: TEMAS.includes(a.tema) ? a.tema : TEMAS.includes(marca.tema) ? marca.tema : 'azul',
      logo: a.logoTipo ? `/logo?v=${a.logoVersion || 0}` : null
    };
  }

  function rutasOcultas() {
    return [...(marca.ocultas || []), ...(ajustes().ocultas || [])];
  }

  function exigirAdmin(sesion) {
    if (sesion.rol !== 'admin') throw errorHttp(403, 'Solo el administrador puede hacer esto.');
  }

  function validarClave(clave) {
    if (typeof clave !== 'string' || clave.length < CLAVE_MINIMA || clave.length > 128) {
      throw errorHttp(400, `La clave debe tener al menos ${CLAVE_MINIMA} caracteres.`);
    }
  }

  async function verAjustes(res) {
    const cartera = await fuente.obtenerCartera();
    const mes = (cartera.hoy || hoy()).slice(0, 7);
    const ocultas = new Set(rutasOcultas());
    responderJson(res, 200, {
      editable: almacen.editable,
      mes,
      marca: configuracion(),
      temas: TEMAS,
      rutas: (cartera.gestores || []).map(g => {
        const meta = (cartera.metas || []).find(m => m.gestorId === g.id && m.mes === mes);
        return {
          id: g.id,
          nombre: g.ruta || g.nombre,
          oculta: ocultas.has(g.id) || ocultas.has(g.ruta),
          meta: meta ? { monto: meta.monto, definida: meta.origen !== 'programado' } : null
        };
      }),
      usuarios: usuarios().map(u => ({ usuario: u.usuario, nombre: u.nombre, rol: u.rol, gestorId: u.gestorId || null }))
    });
  }

  async function guardarMetas(req, res) {
    const cuerpo = await leerCuerpoJson(req);
    const cartera = await fuente.obtenerCartera();
    const mes = (cartera.hoy || hoy()).slice(0, 7);
    const validas = new Set((cartera.gestores || []).map(g => g.id));
    const nuevas = {};
    for (const [id, valor] of Object.entries(cuerpo.metas || {})) {
      if (!validas.has(id)) throw errorHttp(400, 'Hay una cartera que no existe.');
      if (valor === null || valor === '') continue;
      const monto = Number(valor);
      if (!Number.isFinite(monto) || monto <= 0 || monto > 1e12) throw errorHttp(400, 'Cada meta debe ser un monto mayor que cero.');
      nuevas[id] = Math.round(monto);
    }
    almacen.cambiar(datos => {
      datos.metas = { ...datos.metas, [mes]: nuevas };
    });
    if (fuente.invalidar) fuente.invalidar();
    responderJson(res, 200, { ok: true });
  }

  async function guardarUsuario(req, res, sesion) {
    const cuerpo = await leerCuerpoJson(req);
    const nombreUsuario = String(cuerpo.usuario || '').trim().toLowerCase();
    const existente = usuarios().find(u => u.usuario === nombreUsuario);
    const rol = cuerpo.rol === 'admin' ? 'admin' : 'gestor';
    if (existente && existente.usuario === sesion.usuario && rol !== 'admin') {
      throw errorHttp(400, 'No puedes quitarte a ti mismo el rol de administrador.');
    }
    if (!existente || cuerpo.clave) validarClave(cuerpo.clave);
    const registro = {
      usuario: nombreUsuario,
      nombre: String(cuerpo.nombre || nombreUsuario).trim().slice(0, 60),
      rol,
      clave: cuerpo.clave ? await hashClave(cuerpo.clave) : existente.clave
    };
    if (rol === 'gestor') {
      const cartera = await fuente.obtenerCartera();
      if (!(cartera.gestores || []).some(g => g.id === cuerpo.gestorId)) throw errorHttp(400, 'Elige la cartera del gestor.');
      registro.gestorId = cuerpo.gestorId;
    }
    const problema = validarUsuario(registro);
    if (problema) throw errorHttp(400, `Usuario no válido: ${problema}.`);
    almacen.cambiar(datos => {
      datos.usuarios = [...usuarios().filter(u => u.usuario !== nombreUsuario), registro];
    });
    // Un cambio de clave, rol o cartera cierra las sesiones abiertas de ese usuario.
    if (existente && nombreUsuario !== sesion.usuario) sesiones.eliminarDe(nombreUsuario);
    responderJson(res, 200, { ok: true });
  }

  function borrarUsuario(res, sesion, nombreUsuario) {
    if (nombreUsuario === sesion.usuario) throw errorHttp(400, 'No puedes borrar tu propio usuario.');
    if (!usuarios().some(u => u.usuario === nombreUsuario)) throw errorHttp(404, 'Ese usuario no existe.');
    almacen.cambiar(datos => {
      datos.usuarios = usuarios().filter(u => u.usuario !== nombreUsuario);
    });
    sesiones.eliminarDe(nombreUsuario);
    responderJson(res, 200, { ok: true });
  }

  async function guardarApariencia(req, res) {
    const cuerpo = await leerCuerpoJson(req);
    if (cuerpo.tema !== undefined && !TEMAS.includes(cuerpo.tema)) throw errorHttp(400, 'Ese color no está disponible.');
    const cartera = await fuente.obtenerCartera();
    const validas = new Set((cartera.gestores || []).map(g => g.id));
    const ocultas = Array.isArray(cuerpo.ocultas) ? cuerpo.ocultas.filter(id => validas.has(id)) : undefined;
    almacen.cambiar(datos => {
      const a = { ...datos.ajustes };
      if (cuerpo.nombre !== undefined) a.nombre = String(cuerpo.nombre).trim().slice(0, 40) || null;
      if (cuerpo.tema !== undefined) a.tema = cuerpo.tema;
      if (ocultas !== undefined) a.ocultas = ocultas;
      datos.ajustes = a;
    });
    responderJson(res, 200, { ok: true, marca: configuracion() });
  }

  async function guardarLogo(req, res) {
    if (!almacen.editable) almacen.cambiar(() => {});
    const bytes = await leerCuerpo(req, LIMITE_LOGO);
    const tipo = tipoDeImagen(bytes);
    if (!tipo) throw errorHttp(400, 'El logo debe ser una imagen PNG, JPG o WebP.');
    fs.writeFileSync(rutaLogo(), bytes, { mode: 0o600 });
    almacen.cambiar(datos => {
      datos.ajustes = { ...datos.ajustes, logoTipo: tipo, logoVersion: Date.now() };
    });
    responderJson(res, 200, { ok: true, marca: configuracion() });
  }

  function quitarLogo(res) {
    almacen.cambiar(datos => {
      const a = { ...datos.ajustes };
      delete a.logoTipo;
      delete a.logoVersion;
      datos.ajustes = a;
    });
    fs.rmSync(rutaLogo(), { force: true });
    responderJson(res, 200, { ok: true, marca: configuracion() });
  }

  async function cambiarMiClave(req, res, sesion) {
    const cuerpo = await leerCuerpoJson(req);
    const registro = usuarios().find(u => u.usuario === sesion.usuario);
    if (!registro || !(await verificarClave(String(cuerpo.actual || ''), registro.clave))) {
      throw errorHttp(400, 'La clave actual no es correcta.');
    }
    validarClave(cuerpo.nueva);
    const nueva = await hashClave(cuerpo.nueva);
    almacen.cambiar(datos => {
      datos.usuarios = usuarios().map(u => (u.usuario === sesion.usuario ? { ...u, clave: nueva } : u));
    });
    responderJson(res, 200, { ok: true });
  }

  return {
    configuracion,
    rutasOcultas,
    buscarUsuario: nombre => usuarios().find(u => u.usuario === String(nombre || '').trim().toLowerCase()) || null,

    /** Rutas publicas: nombre, color y logo se necesitan antes de iniciar sesion. */
    publico(req, res, ruta) {
      if (req.method !== 'GET') return false;
      if (ruta === '/api/config') {
        responderJson(res, 200, { ...configuracion(), editable: almacen.editable });
        return true;
      }
      if (ruta === '/logo') {
        const tipo = ajustes().logoTipo;
        if (!tipo || !fs.existsSync(rutaLogo())) {
          responderJson(res, 404, { error: 'No encontrado' });
          return true;
        }
        res.writeHead(200, { ...CABECERAS_SEGURIDAD, 'Content-Type': tipo, 'Cache-Control': 'public, max-age=86400' });
        res.end(fs.readFileSync(rutaLogo()));
        return true;
      }
      return false;
    },

    /** Rutas con sesion iniciada. Devuelve false si la ruta no es de este modulo. */
    async privado(req, res, ruta, sesion, consulta) {
      const m = req.method;
      if (ruta === '/api/clave' && m === 'POST') return cambiarMiClave(req, res, sesion).then(() => true);
      if (!ruta.startsWith('/api/admin/')) return false;
      exigirAdmin(sesion);
      if (ruta === '/api/admin/ajustes' && m === 'GET') await verAjustes(res);
      else if (ruta === '/api/admin/metas' && m === 'PUT') await guardarMetas(req, res);
      else if (ruta === '/api/admin/usuarios' && m === 'POST') await guardarUsuario(req, res, sesion);
      else if (ruta === '/api/admin/usuarios' && m === 'DELETE') borrarUsuario(res, sesion, String(consulta.get('usuario') || ''));
      else if (ruta === '/api/admin/apariencia' && m === 'PUT') await guardarApariencia(req, res);
      else if (ruta === '/api/admin/logo' && m === 'PUT') await guardarLogo(req, res);
      else if (ruta === '/api/admin/logo' && m === 'DELETE') quitarLogo(res);
      else return false;
      return true;
    }
  };
}

module.exports = { crearAdmin, TEMAS };
