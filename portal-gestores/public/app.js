/* global document, window, EventSource */
'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const RITMOS = {
    cumplida: ['Meta cumplida', 'bien'],
    'al-dia': ['Vas al ritmo', 'bien'],
    atrasado: ['Por debajo del ritmo', 'alerta']
  };
  const formatoMonto = new Intl.NumberFormat('es', { maximumFractionDigits: 0, useGrouping: 'always' });
  const formatoPct = new Intl.NumberFormat('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  let eventos = null;

  const SIMBOLOS = { NIO: 'C$', USD: 'US$', MXN: '$', COP: '$' };
  let simbolo = '$';
  const dinero = n => `${simbolo}${formatoMonto.format(n || 0)}`;
  const pct = n => (n === null || n === undefined ? 'Sin datos' : `${formatoPct.format(n)} %`);

  // Todo el contenido se inserta como texto (nunca como HTML).
  function el(etiqueta, clase, ...hijos) {
    const nodo = document.createElement(etiqueta);
    if (clase) nodo.className = clase;
    for (const hijo of hijos) {
      if (hijo !== null && hijo !== undefined) nodo.append(hijo);
    }
    return nodo;
  }

  function barra(valor, tono, marca) {
    const relleno = el('div', `progreso__relleno progreso__relleno--${tono}`);
    relleno.style.width = `${Math.max(0, Math.min(valor || 0, 100))}%`;
    const pista = el('div', 'progreso', relleno);
    if (marca !== null && marca !== undefined) {
      const senal = el('div', 'progreso__marca');
      senal.style.left = `${Math.max(0, Math.min(marca, 100))}%`;
      senal.title = 'Avance esperado a hoy';
      pista.append(senal);
    }
    return pista;
  }

  function dato(etiqueta, valor) {
    return el('div', 'dato', el('span', 'tenue', etiqueta), el('strong', null, valor));
  }

  function tonoMora(indice) {
    if (indice === null) return 'neutro';
    if (indice < 5) return 'bien';
    return indice < 10 ? 'alerta' : 'mal';
  }

  function tarjetaMeta(r) {
    const m = r.meta;
    if (!m) {
      return el('section', 'tarjeta tarjeta--meta',
        el('h2', null, 'Meta del mes'),
        el('p', 'tenue', 'Todavía no hay una meta definida para este mes.'));
    }
    const [texto, tono] = RITMOS[m.ritmo];
    const detalle = m.ritmo === 'cumplida'
      ? `Superaste la meta por ${dinero(m.recaudado - m.monto)}.`
      : `Te faltan ${dinero(m.faltante)}: ${dinero(m.necesarioPorDia)} por día en los ${m.diasRestantes} días que quedan.`;
    return el('section', 'tarjeta tarjeta--meta',
      el('div', 'tarjeta__cabecera', el('h2', null, 'Meta del mes'), el('span', `chapa chapa--${tono}`, texto)),
      el('p', 'cifra', pct(m.cumplimiento)),
      el('p', 'tenue', `${dinero(m.recaudado)} de ${dinero(m.monto)}`),
      barra(m.cumplimiento, tono, m.avanceEsperado),
      el('p', 'nota', detalle),
      el('p', 'tenue nota', `La línea marca el avance esperado al día ${r.dia} de ${r.diasDelMes} (${dinero(m.esperadoAHoy)}).`),
      m.origen === 'programado'
        ? el('p', 'tenue nota', 'Meta provisional: es el cobro programado del mes, porque aún no se ha definido una meta.')
        : null);
  }

  function tarjetaRecuperacion(r) {
    const rec = r.recuperacion;
    return el('section', 'tarjeta',
      el('h2', null, 'Recuperación'),
      el('p', 'cifra', pct(rec.porcentaje)),
      barra(rec.porcentaje, 'bien'),
      el('div', 'datos',
        dato(rec.aLaFecha ? 'Cobrado de lo programado' : 'Recaudado', dinero(rec.recaudado)),
        dato(rec.aLaFecha ? 'Programado a la fecha' : 'Por cobrar este mes', dinero(rec.porCobrar)),
        rec.pagos === null ? null : dato('Pagos recibidos', String(rec.pagos))),
      rec.aLaFecha
        ? el('p', 'tenue nota', 'Cuotas del mes que ya vencieron y cuánto de ellas se ha cobrado.')
        : null);
  }

  function tarjetaMora(r) {
    const mora = r.mora;
    const tono = tonoMora(mora.indice);
    const tramos = el('div', 'tramos');
    for (const t of mora.tramos) {
      tramos.append(el('div', 'tramo',
        el('span', 'tenue', `${t.etiqueta} días`),
        el('strong', null, dinero(t.monto)),
        el('span', 'tenue', `${t.clientes} cliente${t.clientes === 1 ? '' : 's'}`)));
    }
    return el('section', 'tarjeta',
      el('h2', null, 'Mora'),
      el('p', `cifra cifra--${tono}`, pct(mora.indice)),
      el('p', 'tenue', `${dinero(mora.saldoVencido)} vencidos de ${dinero(mora.saldoTotal)} en cartera`),
      el('div', 'datos',
        dato('Clientes en mora', `${mora.clientesEnMora} de ${mora.clientesTotal}`)),
      tramos);
  }

  function tablaMorosos(r) {
    const clientes = r.mora.clientes || [];
    if (clientes.length === 0) return null;
    const cuerpo = el('tbody');
    for (const c of clientes) {
      cuerpo.append(el('tr', null,
        el('td', null, c.cliente),
        el('td', 'num', `${c.diasMora} d`),
        el('td', 'num', dinero(c.saldoVencido))));
    }
    return el('section', 'tarjeta tarjeta--ancha',
      el('h2', null, 'Clientes con más días de mora'),
      el('table', null,
        el('thead', null, el('tr', null,
          el('th', null, 'Cliente'), el('th', 'num', 'Días'), el('th', 'num', 'Vencido'))),
        cuerpo));
  }

  function vistaGestor(r) {
    return [tarjetaMeta(r), tarjetaRecuperacion(r), tarjetaMora(r), tablaMorosos(r)];
  }

  function vistaAdmin(equipo) {
    const cuerpo = el('tbody');
    for (const g of equipo) {
      const ritmo = g.meta ? RITMOS[g.meta.ritmo] : ['Sin meta', 'neutro'];
      cuerpo.append(el('tr', null,
        el('td', null, g.nombre),
        el('td', 'num', pct(g.recuperacion.porcentaje)),
        el('td', 'num', pct(g.mora.indice)),
        el('td', 'num', g.meta ? pct(g.meta.cumplimiento) : 'Sin meta'),
        el('td', 'num', g.meta ? `${dinero(g.meta.recaudado)} / ${dinero(g.meta.monto)}` : dinero(g.recuperacion.recaudado)),
        el('td', null, el('span', `chapa chapa--${ritmo[1]}`, ritmo[0]))));
    }
    return [el('section', 'tarjeta tarjeta--ancha',
      el('h2', null, 'Equipo de gestores'),
      el('div', 'tabla-scroll', el('table', null,
        el('thead', null, el('tr', null,
          el('th', null, 'Gestor'), el('th', 'num', 'Recuperación'), el('th', 'num', 'Mora'),
          el('th', 'num', 'Meta'), el('th', 'num', 'Recaudado / meta'), el('th', null, 'Ritmo'))),
        cuerpo)))];
  }

  function pintar(vista) {
    simbolo = SIMBOLOS[vista.moneda] || '$';
    const referencia = vista.tipo === 'admin' ? vista.equipo[0] : vista.resumen;
    if (referencia) {
      const [anio, mes] = referencia.mes.split('-');
      $('periodo').textContent = `${MESES[Number(mes) - 1]} de ${anio} · día ${referencia.dia} de ${referencia.diasDelMes}`;
    }
    const nodos = vista.tipo === 'admin' ? vistaAdmin(vista.equipo) : vistaGestor(vista.resumen);
    $('contenido').replaceChildren(...nodos.filter(Boolean));
    estado('En vivo', 'bien', new Date());
  }

  function estado(texto, tono, hora) {
    const sello = hora ? ` · ${hora.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '';
    $('estado').textContent = `${texto}${sello}`;
    $('estado').className = `estado estado--${tono}`;
  }

  function mostrarLogin() {
    if (eventos) eventos.close();
    eventos = null;
    $('vista-panel').hidden = true;
    $('vista-login').hidden = false;
    $('clave').value = '';
  }

  function conectar() {
    if (eventos) eventos.close();
    eventos = new EventSource('/api/eventos');
    eventos.addEventListener('vista', e => pintar(JSON.parse(e.data)));
    eventos.addEventListener('aviso', () => estado('Datos no disponibles, reintentando', 'alerta'));
    eventos.addEventListener('sesion', mostrarLogin);
    eventos.onerror = () => {
      estado('Reconectando', 'alerta');
      // Si la sesion vencio, EventSource no lo distingue: se comprueba aparte.
      fetch('/api/yo').then(r => { if (r.status === 401) mostrarLogin(); }).catch(() => {});
    };
  }

  async function iniciar() {
    let respuesta;
    try {
      respuesta = await fetch('/api/yo');
    } catch (_err) {
      mostrarLogin();
      return;
    }
    if (!respuesta.ok) {
      mostrarLogin();
      return;
    }
    const yo = await respuesta.json();
    $('saludo').textContent = yo.rol === 'admin' ? 'Panel del equipo' : `Hola, ${yo.nombre.split(' ')[0]}`;
    $('vista-login').hidden = true;
    $('vista-panel').hidden = false;
    estado('Conectando', 'neutro');
    conectar();
  }

  $('form-login').addEventListener('submit', async evento => {
    evento.preventDefault();
    const error = $('error-login');
    error.hidden = true;
    try {
      const respuesta = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: $('usuario').value, clave: $('clave').value })
      });
      if (respuesta.ok) {
        await iniciar();
        return;
      }
      const cuerpo = await respuesta.json().catch(() => ({}));
      error.textContent = cuerpo.error || 'No se pudo iniciar sesión.';
    } catch (_err) {
      error.textContent = 'Sin conexión con el servidor.';
    }
    error.hidden = false;
  });

  $('salir').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    mostrarLogin();
  });

  window.addEventListener('pageshow', iniciar);
})();
