/* global document, window, ResizeObserver */
'use strict';

/**
 * Tendencia del mes: cobrado acumulado contra programado acumulado.
 * Un solo eje, dos series con leyenda, cruz con detalle al pasar el dedo o el
 * cursor, y la misma informacion en una tabla desplegable.
 */
(function () {
  const { el, dinero } = window.Portal;
  const SVG = 'http://www.w3.org/2000/svg';
  const compacto = new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 });
  const ALTO = 200;
  const MARGEN = { arriba: 12, derecha: 14, abajo: 24, izquierda: 54 };

  function nodo(etiqueta, atributos, texto) {
    const n = document.createElementNS(SVG, etiqueta);
    for (const [clave, valor] of Object.entries(atributos)) n.setAttribute(clave, valor);
    if (texto !== undefined) n.textContent = texto;
    return n;
  }

  function acumular(serie) {
    let cobrado = 0;
    let programado = 0;
    const hayProgramado = serie.some(p => p.programado !== null);
    return serie.map(p => {
      if (p.cobrado !== null) cobrado += p.cobrado;
      if (hayProgramado) programado += p.programado || 0;
      return {
        dia: p.dia,
        delDia: p.cobrado,
        cobrado: p.cobrado === null ? null : cobrado,
        programado: hayProgramado ? programado : null
      };
    });
  }

  function topeRedondo(valor) {
    if (!(valor > 0)) return 1;
    const paso = Math.pow(10, Math.floor(Math.log10(valor)));
    return Math.ceil(valor / (paso / 2)) * (paso / 2);
  }

  function dibujar(lienzo, puntos, detalle) {
    const ancho = Math.max(lienzo.clientWidth, 260);
    const interior = { ancho: ancho - MARGEN.izquierda - MARGEN.derecha, alto: ALTO - MARGEN.arriba - MARGEN.abajo };
    const tope = topeRedondo(Math.max(...puntos.map(p => Math.max(p.cobrado || 0, p.programado || 0))));
    const x = dia => MARGEN.izquierda + ((dia - 1) / Math.max(puntos.length - 1, 1)) * interior.ancho;
    const y = valor => MARGEN.arriba + interior.alto - (valor / tope) * interior.alto;
    const trazo = campo => puntos.filter(p => p[campo] !== null).map((p, i) => `${i ? 'L' : 'M'}${x(p.dia).toFixed(1)} ${y(p[campo]).toFixed(1)}`).join(' ');

    const svg = nodo('svg', { width: ancho, height: ALTO, viewBox: `0 0 ${ancho} ${ALTO}`, class: 'grafico__svg', 'aria-hidden': 'true' });
    for (const fraccion of [0, 0.5, 1]) {
      const valor = tope * fraccion;
      svg.append(
        nodo('line', { x1: MARGEN.izquierda, x2: ancho - MARGEN.derecha, y1: y(valor), y2: y(valor), class: fraccion ? 'grafico__rejilla' : 'grafico__base' }),
        nodo('text', { x: MARGEN.izquierda - 8, y: y(valor) + 4, class: 'grafico__eje grafico__eje--y' }, compacto.format(valor)));
    }
    const ultimo = puntos.length;
    for (const dia of [...new Set([1, 5, 10, 15, 20, 25, ultimo])].filter(d => d <= ultimo && (d === ultimo || ultimo - d > 2))) {
      svg.append(nodo('text', { x: x(dia), y: ALTO - 6, class: 'grafico__eje grafico__eje--x' }, String(dia)));
    }
    if (puntos.some(p => p.programado !== null)) svg.append(nodo('path', { d: trazo('programado'), class: 'grafico__linea grafico__linea--programado' }));
    svg.append(nodo('path', { d: trazo('cobrado'), class: 'grafico__linea grafico__linea--cobrado' }));
    const actual = puntos.filter(p => p.cobrado !== null).pop();
    if (actual) svg.append(nodo('circle', { cx: x(actual.dia), cy: y(actual.cobrado), r: 4.5, class: 'grafico__punto' }));

    const cruz = nodo('line', { y1: MARGEN.arriba, y2: MARGEN.arriba + interior.alto, class: 'grafico__cruz', visibility: 'hidden' });
    svg.append(cruz);
    const mostrar = evento => {
      const caja = svg.getBoundingClientRect();
      const posicion = (evento.clientX - caja.left - MARGEN.izquierda) / interior.ancho;
      const p = puntos[Math.max(0, Math.min(puntos.length - 1, Math.round(posicion * (puntos.length - 1))))];
      cruz.setAttribute('x1', x(p.dia));
      cruz.setAttribute('x2', x(p.dia));
      cruz.setAttribute('visibility', 'visible');
      const partes = [`Día ${p.dia}`];
      if (p.cobrado !== null) partes.push(`cobrado ${dinero(p.cobrado)}`);
      if (p.programado !== null) partes.push(`programado ${dinero(p.programado)}`);
      detalle.textContent = partes.join(' · ');
    };
    svg.addEventListener('pointermove', mostrar);
    svg.addEventListener('pointerdown', mostrar);
    svg.addEventListener('pointerleave', () => {
      cruz.setAttribute('visibility', 'hidden');
      detalle.textContent = detalle.dataset.reposo;
    });
    lienzo.replaceChildren(svg);
  }

  function tabla(puntos) {
    const cuerpo = el('tbody');
    for (const p of puntos) {
      if (p.cobrado === null && p.programado === null) continue;
      cuerpo.append(el('tr', null,
        el('td', null, `Día ${p.dia}`),
        el('td', 'num', p.delDia === null ? '' : dinero(p.delDia)),
        el('td', 'num', p.cobrado === null ? '' : dinero(p.cobrado)),
        el('td', 'num', p.programado === null ? '' : dinero(p.programado))));
    }
    return el('details', 'grafico__tabla',
      el('summary', null, 'Ver los datos en tabla'),
      el('div', 'tabla-scroll', el('table', null,
        el('thead', null, el('tr', null,
          el('th', null, 'Día'), el('th', 'num', 'Cobrado ese día'), el('th', 'num', 'Cobrado acumulado'), el('th', 'num', 'Programado acumulado'))),
        cuerpo)));
  }

  window.Portal.grafico = function (serie) {
    const puntos = acumular(serie);
    const hayProgramado = puntos.some(p => p.programado !== null);
    const actual = puntos.filter(p => p.cobrado !== null).pop();
    const reposo = actual
      ? `Al día ${actual.dia}: cobrado ${dinero(actual.cobrado)}${hayProgramado ? ` · programado ${dinero(actual.programado)}` : ''}`
      : '';
    const detalle = el('p', 'grafico__detalle', reposo);
    detalle.dataset.reposo = reposo;
    const lienzo = el('div', 'grafico__lienzo');
    lienzo.setAttribute('role', 'img');
    lienzo.setAttribute('aria-label', `Cobrado acumulado del mes por día. ${reposo}`);
    const leyenda = el('div', 'grafico__leyenda',
      el('span', 'grafico__clave grafico__clave--cobrado', 'Cobrado acumulado'),
      hayProgramado ? el('span', 'grafico__clave grafico__clave--programado', 'Programado acumulado') : null);
    // El ancho real solo se conoce cuando el grafico ya esta en la pagina.
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => dibujar(lienzo, puntos, detalle)).observe(lienzo);
    else window.requestAnimationFrame(() => dibujar(lienzo, puntos, detalle));
    return el('div', 'grafico', leyenda, lienzo, detalle, tabla(puntos));
  };
})();
