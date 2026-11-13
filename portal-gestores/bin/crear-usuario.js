#!/usr/bin/env node
'use strict';

/**
 * Crea o actualiza un usuario del portal.
 *
 *   node bin/crear-usuario.js --usuario ana --nombre "Ana Torres" --gestor G01
 *   node bin/crear-usuario.js --usuario jefe --nombre "Jefe de cobranza" --rol admin
 *
 * La clave se pide por teclado (o se toma de PORTAL_CLAVE) y solo se guarda su hash.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { hashClave } = require('../src/auth');
const { validarUsuario } = require('../src/usuarios');

function leerArgumentos(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`Argumento invalido: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function pedirClave() {
  if (process.env.PORTAL_CLAVE) return Promise.resolve(process.env.PORTAL_CLAVE);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question('Clave (minimo 8 caracteres): ', respuesta => {
    rl.close();
    resolve(respuesta);
  }));
}

async function main() {
  const args = leerArgumentos(process.argv.slice(2));
  const ruta = path.resolve(args.archivo || process.env.PORTAL_USUARIOS || path.join(__dirname, '..', 'datos', 'usuarios.json'));
  const clave = await pedirClave();
  if (clave.length < 8) throw new Error('La clave debe tener al menos 8 caracteres.');

  const usuario = {
    usuario: String(args.usuario || '').toLowerCase(),
    nombre: args.nombre || args.usuario,
    rol: args.rol || 'gestor',
    clave: await hashClave(clave)
  };
  if (usuario.rol === 'gestor') usuario.gestorId = args.gestor;
  const error = validarUsuario(usuario);
  if (error) throw new Error(error);

  const lista = fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : [];
  const resto = lista.filter(u => u.usuario !== usuario.usuario);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify([...resto, usuario], null, 2) + '\n', { mode: 0o600 });
  console.log(`Usuario "${usuario.usuario}" (${usuario.rol}) guardado en ${ruta}`);
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
