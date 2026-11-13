'use strict';

/**
 * Datos de demostracion generados para el mes en curso. No son datos reales:
 * sirven para probar el portal antes de conectar el sistema de cartera.
 */

const GESTORES = [
  { id: 'G01', nombre: 'Ana Torres', disciplina: 0.82 },
  { id: 'G02', nombre: 'Luis Mendoza', disciplina: 0.64 },
  { id: 'G03', nombre: 'Marta Rios', disciplina: 0.45 }
];

const NOMBRES = ['Carlos', 'Diana', 'Elena', 'Fabian', 'Gloria', 'Hugo', 'Irene', 'Jorge', 'Karen', 'Mario'];
const APELLIDOS = ['Vargas', 'Castro', 'Pineda', 'Salazar', 'Moreno', 'Ortega', 'Navarro', 'Campos'];

function generador(semilla) {
  let estado = semilla >>> 0;
  return () => {
    estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
    return estado / 4294967296;
  };
}

function dosDigitos(n) {
  return String(n).padStart(2, '0');
}

function generarCartera(hoy) {
  const mes = hoy.slice(0, 7);
  const dia = Number(hoy.slice(8, 10));
  const azar = generador(Number(mes.replace('-', '')));
  const creditos = [];
  const pagos = [];
  const metas = [];

  GESTORES.forEach((gestor, indice) => {
    let porCobrar = 0;
    for (let i = 1; i <= 24; i++) {
      const id = `${gestor.id}-${dosDigitos(i)}`;
      const saldo = Math.round(800 + azar() * 4200);
      const cuota = Math.round(saldo * (0.08 + azar() * 0.06));
      const moroso = azar() > gestor.disciplina;
      const diasMora = moroso ? 1 + Math.floor(azar() * 120) : 0;
      const saldoVencido = moroso ? Math.round(cuota * (1 + diasMora / 30)) : 0;
      const cuotaMes = cuota + saldoVencido;
      porCobrar += cuotaMes;
      creditos.push({
        id,
        cliente: `${NOMBRES[(i + indice * 3) % NOMBRES.length]} ${APELLIDOS[(i * 7 + indice) % APELLIDOS.length]}`,
        gestorId: gestor.id,
        saldo,
        saldoVencido: Math.min(saldoVencido, saldo),
        diasMora,
        cuotaMes
      });
      const diaPago = 1 + Math.floor(azar() * 28);
      if (!moroso && diaPago <= dia) {
        pagos.push({ creditoId: id, gestorId: gestor.id, fecha: `${mes}-${dosDigitos(diaPago)}`, monto: cuota });
      } else if (moroso && diaPago <= dia && azar() < 0.4) {
        pagos.push({ creditoId: id, gestorId: gestor.id, fecha: `${mes}-${dosDigitos(diaPago)}`, monto: Math.round(cuota / 2) });
      }
    }
    metas.push({ gestorId: gestor.id, mes, monto: Math.round((porCobrar * 0.75) / 100) * 100 });
  });

  return {
    gestores: GESTORES.map(({ id, nombre }) => ({ id, nombre })),
    creditos,
    pagos,
    metas
  };
}

function crearFuenteDemo({ fechaHoy }) {
  return {
    nombre: 'demo',
    async obtenerCartera() {
      return { ...generarCartera(fechaHoy()), actualizado: new Date().toISOString().slice(0, 16) + ':00Z' };
    }
  };
}

module.exports = { crearFuenteDemo, generarCartera, GESTORES };
