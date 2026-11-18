/* Fit — precios estimados para el presupuesto de la lista de compras.
   Fuente: INDEC, "Precios promedio al consumidor de artículos seleccionados", octubre de 2026
   (planilla sh_ipc_precios_promedio.xls, actualizada el 12/11/2026).
   - P: precio promedio de la región Pampeana (incluye Córdoba). INDEC publica solo 14 productos para esta región.
   - G: precio promedio de GBA para el mismo producto (no hay dato para Córdoba; se usa como referencia).
   - R: precio INDEC de un producto parecido, usado como referencia (se indica cuál).
   Los alimentos sin dato oficial quedan sin precio: la persona carga el suyo.
   Todos los valores están convertidos a pesos por kilo (o por litro ≈ kilo). */
'use strict';

const PRICE_INFO = {
  fecha: 'octubre de 2026',
  P: 'INDEC, región Pampeana (incluye Córdoba), octubre de 2026',
  G: 'INDEC, GBA, octubre de 2026 (no hay dato para Córdoba: es una referencia)',
  R: 'Precio INDEC de un producto parecido (referencia)',
  U: 'Tu precio',
};

// id: [pesos por kg, origen, aclaración]
const BASE_PRICES = {
  pan_frances: [3698, 'P', 'Pan francés, kg'],
  harina: [1190, 'P', 'Harina de trigo común, kg'],
  arroz: [2230, 'P', 'Arroz blanco simple, kg'],
  fideos: [3343, 'P', 'Fideos secos guiseros, paquete de 500 g a $ 1.672'],
  huevo: [6764, 'P', 'Huevos, docena a $ 4.058 (≈ 600 g)'],
  clara: [10248, 'R', 'Se calcula comprando huevos enteros (docena a $ 4.058)'],
  papa: [2620, 'P', 'Papa, kg'],
  aceite: [5245, 'P', 'Aceite de girasol, botella de 1,5 L a $ 7.238'],
  leche_desc: [2133, 'R', 'Leche fresca entera en sachet, litro a $ 2.197 (la descremada puede variar)'],
  carne_picada: [11447, 'R', 'Carne picada común, kg (la especial suele ser más cara)'],
  carne_magra: [21832, 'G', 'Nalga, kg'],
  carne_asado: [16958, 'G', 'Asado, kg'],
  merluza: [14838, 'G', 'Filet de merluza fresco, kg'],
  jamon: [21699, 'G', 'Jamón cocido, kg'],
  mozzarella: [14612, 'R', 'Queso cremoso GBA, kg'],
  queso_rallado: [28654, 'R', 'Queso sardo GBA, kg'],
  yogur: [13446, 'G', 'Yogur firme, pote de 195 g a $ 2.622'],
  salsa_tomate: [6702, 'R', 'Tomate entero en conserva GBA, lata de 230 g a $ 1.541'],
  arvejas: [4541, 'R', 'Arvejas en lata GBA, 220 g a $ 999'],
  manzana: [4129, 'G', 'Manzana deliciosa, kg'],
  naranja: [1164, 'G', 'Naranja, kg'],
  banana: [2967, 'G', 'Banana, kg'],
  batata: [3073, 'G', 'Batata, kg'],
  cebolla: [3376, 'G', 'Cebolla, kg'],
  lechuga: [3500, 'G', 'Lechuga, kg'],
  tomate: [3595, 'G', 'Tomate redondo, kg'],
  calabaza: [4455, 'G', 'Zapallo anco, kg'],
};

// Palabras clave para ponerle precio a los ingredientes del menú de la IA (que vienen con nombre libre).
const AI_PRICE_KEYS = [
  ['carne picada', 'carne_picada'], ['picada', 'carne_picada'], ['nalga', 'carne_magra'], ['peceto', 'carne_magra'], ['cuadrada', 'carne_magra'],
  ['bife', 'carne_magra'], ['asado', 'carne_asado'], ['vacio', 'carne_asado'], ['merluza', 'merluza'], ['jamon', 'jamon'],
  ['mozzarella', 'mozzarella'], ['muzzarella', 'mozzarella'], ['queso rallado', 'queso_rallado'], ['yogur', 'yogur'],
  ['clara', 'clara'], ['huevo', 'huevo'], ['leche', 'leche_desc'], ['aceite', 'aceite'], ['pan frances', 'pan_frances'],
  ['harina', 'harina'], ['arroz', 'arroz'], ['fideo', 'fideos'], ['papa', 'papa'], ['batata', 'batata'], ['cebolla', 'cebolla'],
  ['lechuga', 'lechuga'], ['tomate', 'tomate'], ['manzana', 'manzana'], ['naranja', 'naranja'], ['banana', 'banana'],
  ['zapallo', 'calabaza'], ['calabaza', 'calabaza'], ['arveja', 'arvejas'],
];
const normTxt = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Precio por kg de un alimento de Fit: primero el que cargó la persona, si no, el de referencia.
function priceOf(id) {
  const u = S.prices && S.prices[id];
  if (u && u.v > 0) return { v: u.v, src: 'U', note: `cargado el ${u.d ? u.d.split('-').reverse().join('/') : ''}` };
  const b = BASE_PRICES[id];
  return b ? { v: b[0], src: b[1], note: b[2] } : null;
}
// Precio por kg de un ingrediente de la IA (por nombre).
function priceOfAI(key) {
  const u = S.pricesAI && S.pricesAI[key];
  if (u && u.v > 0) return { v: u.v, src: 'U', note: 'tu precio' };
  const n = normTxt(key);
  const hit = AI_PRICE_KEYS.find(([w]) => n.includes(w));
  if (!hit) return null;
  const p = priceOf(hit[1]); if (!p) return null;
  // Un nombre libre puede no ser exactamente el mismo producto: se marca como referencia (salvo precio propio).
  return { v: p.v, src: p.src === 'U' ? 'U' : 'R', note: `según ${FOODS[hit[1]] ? FOODS[hit[1]].n : hit[1]}: ${p.note || ''}` };
}

const ars = (v) => '$ ' + Math.round(v).toLocaleString('es-AR');
const SRC_TAG = { P: 'INDEC Pampeana', G: 'INDEC GBA', R: 'referencia', U: 'tu precio' };
let shopEdit = false;

// Celda de precio de un renglón de la lista (costo del renglón o campo para editar el precio por kg).
function priceCell(p, grams, dataAttr) {
  if (shopEdit) {
    return `<span class="pedit">$<input type="number" inputmode="numeric" ${dataAttr} value="${p ? Math.round(p.v) : ''}" placeholder="sin precio">/kg</span>`;
  }
  if (!p) return '<small class="pr none">sin precio</small>';
  return `<small class="pr" title="${esc(PRICE_INFO[p.src] + (p.note ? ' — ' + p.note : ''))}">${ars((grams / 1000) * p.v)}<i class="src-${p.src}">${SRC_TAG[p.src]}</i></small>`;
}

// Tarjeta de presupuesto: total, cuántos productos no tienen precio y de dónde salen los precios.
function budgetHTML(total, missing, count) {
  return `<section class="card budget">
    <div class="prow"><span><b>Presupuesto estimado</b><small>${shopN()} persona${shopN() > 1 ? 's' : ''} · semana completa</small></span><b class="big2">${ars(total)}</b></div>
    ${missing ? `<p class="hint">No incluye <b>${missing}</b> de ${count} productos que no tienen precio de referencia. Tocá <b>Editar precios</b> y cargá lo que pagás.</p>` : ''}
    <div class="actions"><button class="${shopEdit ? '' : 'ghost'}" data-x="shopedit">${shopEdit ? 'Listo' : 'Editar precios'}</button></div>
    <details><summary>¿De dónde salen los precios?</summary>
      <p class="hint">De INDEC (precios promedio de ${PRICE_INFO.fecha}). Para la región Pampeana, que incluye Córdoba, INDEC publica solo 14 productos: esos se usan tal cual (<i class="src-P">INDEC Pampeana</i>). Para el resto se usa el promedio de GBA (<i class="src-G">INDEC GBA</i>) o el de un producto parecido (<i class="src-R">referencia</i>). Los productos sin ningún dato oficial quedan sin precio.</p>
      <p class="hint">Son promedios: en tu súper o verdulería puede ser más caro o más barato, y con la inflación quedan viejos en pocos meses. Lo más preciso es cargar tus precios (<i class="src-U">tu precio</i>): se guardan y se usan siempre.</p>
    </details>
  </section>`;
}

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset && (t.dataset.price != null || t.dataset.priceai != null)) {
    const v = +t.value;
    const isAI = t.dataset.priceai != null; const key = isAI ? t.dataset.priceai : t.dataset.price;
    const box = isAI ? (S.pricesAI = S.pricesAI || {}) : (S.prices = S.prices || {});
    if (v > 0) box[key] = { v, d: todayISO() }; else delete box[key];
    store.save(); render();
  }
});
