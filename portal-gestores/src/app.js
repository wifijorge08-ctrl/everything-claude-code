'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { calcularResumen, calcularEquipo, fechaHoy } = require('./metricas');
const { Sesiones, Limitador, hashClave, verificarClave } = require('./auth');
const { crearAlmacen } = require('./almacen');
const { crearAdmin } = require('./admin');
const { CABECERAS_SEGURIDAD, leerCookie, responderJson, leerCuerpoJson } = require('./http-util');

const PUBLICO = path.join(__dirname, '..', 'public');
const ESTATICOS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/grafico.js': ['grafico.js', 'text/javascript; charset=utf-8'],
  '/ajustes.js': ['ajustes.js', 'text/javascript; charset=utf-8'],
  '/estilos.css': ['estilos.css', 'text/css; charset=utf-8'],
  '/icono.svg': ['icono.svg', 'image/svg+xml'],
  '/icono-180.png': ['icono-180.png', 'image/png'],
  '/icono-512.png': ['icono-512.png', 'image/png'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']
};
const COOKIE = 'sid';

/**
 * @param {object} opciones
 * @param {{obtenerCartera: () => Promise<object>}} opciones.fuente
 * @param {{buscar: (usuario: string) => object|null}} [opciones.usuarios] usuarios de solo lectura
 * @param {object} [opciones.almacen] donde se guardan los cambios hechos desde el portal
 * @param {{nombre?: string, tema?: string, ocultas?: string[]}} [opciones.marca] valores por defecto
 */
function crearApp(opciones) {
  const { fuente, usuarios, zonaHoraria, cookieSegura = true, intervaloMs = 5000, marca } = opciones;
  const almacenSesiones = opciones.sesiones || new Sesiones();
  const intentos = opciones.limitador || new Limitador();
  const almacen = opciones.almacen || crearAlmacen(null);
  const hashSenuelo = hashClave('clave-inexistente');
  const hoy = () => fechaHoy(zonaHoraria);
  const admin = crearAdmin({ almacen, fuente, sesiones: almacenSesiones, hoy, marca });
  const buscarUsuario = nombre => admin.buscarUsuario(nombre) || (usuarios ? usuarios.buscar(nombre) : null);

  function cookieDeSesion(token, maxAge) {
    const partes = [`${COOKIE}=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${maxAge}`];
    if (cookieSegura) partes.push('Secure');
    return partes.join('; ');
  }

  // La cartera visible depende SOLO de la sesion; nunca de un parametro del cliente.
  async function vistaPara(sesion) {
    const cartera = await fuente.obtenerCartera();
    // La fuente puede fijar la fecha de negocio (en su propia zona horaria).
    const dia = cartera.hoy || hoy();
    const comun = { empresa: cartera.empresa || null, moneda: cartera.moneda || null };
    if (sesion.rol === 'admin') {
      const ocultas = new Set(admin.rutasOcultas());
      const idsOcultos = new Set((cartera.gestores || [])
        .filter(g => ocultas.has(g.id) || ocultas.has(g.ruta))
        .map(g => g.id));
      return {
        tipo: 'admin',
        ...comun,
        actualizado: cartera.actualizado || null,
        equipo: calcularEquipo(cartera, dia).filter(g => !idsOcultos.has(g.gestorId))
      };
    }
    const gestor = (cartera.gestores || []).find(g => g && g.id === sesion.gestorId);
    return {
      tipo: 'gestor',
      ...comun,
      cartera: gestor ? gestor.ruta || gestor.nombre : null,
      resumen: calcularResumen(cartera, sesion.gestorId, dia)
    };
  }

  async function iniciarSesion(req, res) {
    const cuerpo = await leerCuerpoJson(req);
    const usuario = String(cuerpo.usuario || '').trim().toLowerCase().slice(0, 64);
    const clave = String(cuerpo.clave || '').slice(0, 256);
    const llave = `${req.socket.remoteAddress}|${usuario}`;
    if (intentos.bloqueado(llave)) {
      responderJson(res, 429, { error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' });
      return;
    }
    const registro = buscarUsuario(usuario);
    // Se verifica siempre un hash para no revelar por tiempo si el usuario existe.
    const valida = await verificarClave(clave, registro ? registro.clave : await hashSenuelo);
    if (!registro || !valida) {
      intentos.fallo(llave);
      responderJson(res, 401, { error: 'Usuario o clave incorrectos.' });
      return;
    }
    intentos.limpiar(llave);
    const token = almacenSesiones.crear({
      usuario: registro.usuario,
      nombre: registro.nombre || registro.usuario,
      rol: registro.rol,
      gestorId: registro.rol === 'gestor' ? registro.gestorId : null
    });
    responderJson(res, 200, { ok: true }, {
      'Set-Cookie': cookieDeSesion(token, Math.floor(almacenSesiones.duracionMs / 1000))
    });
  }

  function transmitir(req, res, token) {
    res.writeHead(200, {
      ...CABECERAS_SEGURIDAD,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no'
    });
    let ultimo = '';
    let ocupado = false;
    const enviar = async () => {
      if (ocupado) return;
      const sesion = almacenSesiones.obtener(token);
      if (!sesion) {
        res.write('event: sesion\ndata: "vencida"\n\n');
        res.end();
        return;
      }
      ocupado = true;
      try {
        const json = JSON.stringify(await vistaPara(sesion));
        if (json !== ultimo) {
          ultimo = json;
          res.write(`event: vista\ndata: ${json}\n\n`);
        } else {
          res.write(': sin cambios\n\n');
        }
      } catch (err) {
        console.error(`[portal-gestores] fuente de datos: ${err.message}`);
        res.write('event: aviso\ndata: "fuente-no-disponible"\n\n');
      } finally {
        ocupado = false;
      }
    };
    const temporizador = setInterval(enviar, intervaloMs);
    res.on('close', () => clearInterval(temporizador));
    enviar();
  }

  function servirEstatico(res, ruta) {
    const [archivo, tipo] = ESTATICOS[ruta];
    fs.readFile(path.join(PUBLICO, archivo), (err, contenido) => {
      if (err) {
        responderJson(res, 500, { error: 'No disponible' });
        return;
      }
      res.writeHead(200, { ...CABECERAS_SEGURIDAD, 'Content-Type': tipo, 'Cache-Control': 'no-cache' });
      res.end(contenido);
    });
  }

  async function atender(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const ruta = url.pathname;

    if (req.method === 'GET' && ESTATICOS[ruta]) return servirEstatico(res, ruta);
    if (admin.publico(req, res, ruta)) return undefined;
    if (ruta === '/api/login' && req.method === 'POST') return iniciarSesion(req, res);

    const token = leerCookie(req, COOKIE);
    const sesion = almacenSesiones.obtener(token);

    if (ruta === '/api/logout' && req.method === 'POST') {
      if (token) almacenSesiones.eliminar(token);
      return responderJson(res, 200, { ok: true }, { 'Set-Cookie': cookieDeSesion('', 0) });
    }
    if (!ruta.startsWith('/api/')) return responderJson(res, 404, { error: 'No encontrado' });
    if (!sesion) return responderJson(res, 401, { error: 'Inicia sesión para continuar.' });

    if (req.method === 'GET' && ruta === '/api/yo') {
      return responderJson(res, 200, {
        usuario: sesion.usuario,
        nombre: sesion.nombre,
        rol: sesion.rol,
        // Solo el administrador cambia claves, y solo si hay donde guardarlas.
        puedeCambiarClave: sesion.rol === 'admin' && almacen.editable && Boolean(admin.buscarUsuario(sesion.usuario))
      });
    }
    if (req.method === 'GET' && ruta === '/api/vista') {
      return responderJson(res, 200, await vistaPara(sesion));
    }
    if (req.method === 'GET' && ruta === '/api/eventos') return transmitir(req, res, token);
    if (await admin.privado(req, res, ruta, sesion, url.searchParams)) return undefined;
    return responderJson(res, 404, { error: 'No encontrado' });
  }

  return http.createServer((req, res) => {
    atender(req, res).catch(err => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err.estado) {
        responderJson(res, err.estado, { error: err.message });
        return;
      }
      console.error(`[portal-gestores] ${err.stack || err.message}`);
      responderJson(res, 503, { error: 'Los datos no están disponibles en este momento.' });
    });
  });
}

module.exports = { crearApp };
