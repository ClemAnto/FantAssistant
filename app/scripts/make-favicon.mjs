/**
 * make-favicon.mjs - disegna l'icona dell'app e la scrive nei due formati che servono.
 *
 * PERCHÉ UNO SCRIPT E NON UN BINARIO INFILATO NEL REPO. Un `.ico` che nessuno sa rifare è la cosa che
 * questo progetto non tiene: come il database, l'icona deve essere ricostruibile da zero, e la sua
 * sorgente è la GEOMETRIA qui sotto più i colori del tema - non un file che qualcuno ha esportato una
 * volta da un editor. Cambiare il marchio è cambiare `magenta.css` e rilanciare questo.
 *
 * UNA DEFINIZIONE, DUE USCITE. `favicon.svg` (che è quello che un browser moderno usa, nitido a
 * qualunque dimensione) e `favicon.ico` (16/32/48/64, per la barra delle schede e per chi non legge
 * l'SVG) escono dalla STESSA geometria: il vettore lo scrive `svg()`, i pixel li calcola `raster()` sulle
 * stesse formule. Disegnarla due volte - una in SVG a mano e una nel rasterizzatore - vorrebbe dire due
 * icone che prima o poi non sono la stessa.
 *
 * I COLORI VENGONO DAL TEMA e non sono trascritti: `--color-primary` e `--color-on-primary` di
 * `magenta.css`, letti da `theme-tokens.mjs`, che è lo stesso lettore dell'audit del contrasto. Un token
 * che manca fa fallire la corsa invece di prendere un ripiego: un'icona disegnata con un colore
 * inventato è indistinguibile da una disegnata bene.
 *
 * ZERO DIPENDENZE (il `zlib` di Node basta a scrivere un PNG): un arnese che chiede un `npm i` è un
 * arnese che nessuno rilancia.
 *
 * Usage: node scripts/make-favicon.mjs [--theme magenta.css] [--check]
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ratio, themeColors } from './theme-tokens.mjs';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};

/**
 * IL DISEGNO, in un quadrato unitario: un pallone.
 *
 * Perché un pallone e non un monogramma o un grafico. L'icona deve leggersi a SEDICI pixel, dove una
 * lettera è tre tratti e una linea di tendenza è fango; un pallone invece si riconosce dalla sagoma - un
 * cerchio con il pentagono al centro e le cuciture che vanno al bordo - ed è esattamente il mestiere di
 * questa app. Il carattere lo dà il colore, che è quello del tema e di nessun altro.
 *
 * A TUTTO CAMPO E SU FONDO TRASPARENTE, non dentro una piastrella: la piastrella si mangerebbe un terzo
 * del lato proprio alla dimensione in cui serve tutto, e il magenta del marchio si stacca sia da una
 * barra chiara sia da una scura.
 *
 * Le misure sono in frazioni del lato, così la stessa geometria vale per il vettore e per ogni pixel.
 */
const DESIGN = {
  /** Il pallone: centro e raggio. Il 3% che resta è il margine che gli impedisce di toccare il bordo. */
  ball: { cx: 0.5, cy: 0.5, r: 0.47 },
  /** Il pentagono centrale, punta in ALTO: è quello che rende la sagoma un pallone e non un cerchio. */
  pentagon: { r: 0.215, turn: -90 },
  /**
   * Le cinque cuciture, da ogni vertice del pentagono verso il bordo - e SI FERMANO PRIMA.
   *
   * La prima versione le portava fino al bordo (tagliate dal pallone stesso) e il disegno non era un
   * pallone: cinque cuciture larghe che arrivano al bordo TAGLIANO il cerchio in cinque petali, e a 128
   * pixel si legge come un fiore. Guardato invece che dedotto, e corretto lasciando un anello di tinta
   * tutto intorno: la sagoma circolare è la prima cosa che si riconosce, e se si rompe non resta niente.
   *
   * E la seconda versione leggeva come una STELLA, per il motivo opposto: cuciture larghe attaccate ai
   * vertici del pentagono si fondono con lui in un'unica sagoma a cinque punte. Una cucitura è una LINEA,
   * quindi è sottile, e a sedici pixel sbiadisce - resta il pentagono in mezzo al cerchio, che è
   * esattamente quello che fa un'icona di pallone a quella misura.
   */
  seam: { reach: 0.425, width: 0.048 },
};

/** I cinque vertici del pentagono, in frazioni del lato. */
function pentagonPoints() {
  const { pentagon, ball } = DESIGN;
  return [0, 1, 2, 3, 4].map((k) => {
    const angle = ((pentagon.turn + k * 72) * Math.PI) / 180;
    return [ball.cx + pentagon.r * Math.cos(angle), ball.cy + pentagon.r * Math.sin(angle)];
  });
}

/** ...e dove finisce la cucitura che parte da ognuno: fuori dal pallone, per essere tagliata da lui. */
function seamEnds() {
  const { pentagon, seam, ball } = DESIGN;
  return [0, 1, 2, 3, 4].map((k) => {
    const angle = ((pentagon.turn + k * 72) * Math.PI) / 180;
    return [
      [ball.cx + pentagon.r * Math.cos(angle), ball.cy + pentagon.r * Math.sin(angle)],
      [ball.cx + seam.reach * Math.cos(angle), ball.cy + seam.reach * Math.sin(angle)],
    ];
  });
}

// ------------------------------------------------------------------ il vettore

function svg(colors) {
  const S = 64;                                  // la griglia del viewBox: solo numeri leggibili
  const at = (v) => Number((v * S).toFixed(2));
  const { ball, seam } = DESIGN;
  const points = pentagonPoints().map(([x, y]) => `${at(x)},${at(y)}`).join(' ');
  const lines = seamEnds()
    .map(([[x1, y1], [x2, y2]]) => `      <line x1="${at(x1)}" y1="${at(y1)}" x2="${at(x2)}" y2="${at(y2)}" />`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATO da app/scripts/make-favicon.mjs: non modificare a mano, si riscrive.
     La geometria sta in quello script, i colori vengono da src/styles/themes/${value('--theme', 'magenta.css')}. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" role="img" aria-label="FantAssistant">
  <defs>
    <clipPath id="ball">
      <circle cx="${at(ball.cx)}" cy="${at(ball.cy)}" r="${at(ball.r)}" />
    </clipPath>
  </defs>
  <circle cx="${at(ball.cx)}" cy="${at(ball.cy)}" r="${at(ball.r)}" fill="${colors.fill}" />
  <g clip-path="url(#ball)" fill="${colors.ink}">
    <g stroke="${colors.ink}" stroke-width="${at(seam.width)}" stroke-linecap="round">
${lines}
    </g>
    <polygon points="${points}" />
  </g>
</svg>
`;
}

// ------------------------------------------------------------------ i pixel

/** Dentro il pallone? */
function inBall(x, y) {
  const { ball } = DESIGN;
  return (x - ball.cx) ** 2 + (y - ball.cy) ** 2 <= ball.r ** 2;
}

/** Dentro il pentagono? Convesso, quindi basta che i cinque prodotti vettoriali abbiano un segno solo. */
function inPentagon(x, y, points) {
  let sign = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross === 0) continue;
    const here = cross > 0 ? 1 : -1;
    if (sign === 0) sign = here;
    else if (sign !== here) return false;
  }
  return true;
}

/** Su una cucitura? La distanza dal SEGMENTO, non dalla sua retta: una cucitura ha due estremi. */
function onSeam(x, y, seams) {
  const half = DESIGN.seam.width / 2;
  for (const [[x1, y1], [x2, y2]] of seams) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    if ((x - px) ** 2 + (y - py) ** 2 <= half * half) return true;
  }
  return false;
}

/**
 * RGBA di un lato `size`, con l'antialiasing fatto per sovracampionamento.
 *
 * Non c'è un rasterizzatore da chiamare, quindi la copertura si conta: 4×4 campioni per pixel, ognuno
 * dentro o fuori, e la media in colore PREMOLTIPLICATO - mediare RGB e alfa separatamente sporca i bordi
 * di colore, che a sedici pixel è metà dell'immagine.
 */
function raster(size, colors) {
  const points = pentagonPoints();
  const seams = seamEnds();
  const fill = colors.fillRgb;
  const ink = colors.inkRgb;
  const grid = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < grid; sy += 1) {
        for (let sx = 0; sx < grid; sx += 1) {
          const x = (px + (sx + 0.5) / grid) / size;
          const y = (py + (sy + 0.5) / grid) / size;
          if (!inBall(x, y)) continue;
          const dark = inPentagon(x, y, points) || onSeam(x, y, seams);
          const [cr, cg, cb] = dark ? ink : fill;
          r += cr;
          g += cg;
          b += cb;
          a += 1;
        }
      }
      const samples = grid * grid;
      const at = (py * size + px) * 4;
      if (a === 0) continue;
      out[at] = Math.round(r / a);
      out[at + 1] = Math.round(g / a);
      out[at + 2] = Math.round(b / a);
      out[at + 3] = Math.round((a / samples) * 255);
    }
  }
  return out;
}

// ------------------------------------------------------------------ PNG e ICO, a mano

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const tagged = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tagged));
  return Buffer.concat([length, tagged, crc]);
}

/** Un PNG RGBA da un buffer di pixel: IHDR, un IDAT, IEND. Filtro 0 su ogni riga. */
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;                                 // 8 bit per canale
  header[9] = 6;                                 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;                 // nessun filtro: l'icona è piccola
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * L'ICO: la directory più i PNG dentro.
 *
 * PNG e non bitmap, che è il formato Vista+ e quello che ogni browser in circolazione legge; un BMP a 32
 * bit dentro un ICO vuole la maschera AND e la riga capovolta, cioè due modi in più di sbagliare per
 * niente.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);                    // 1 = icona
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  images.forEach(({ size, body }, at) => {
    const entry = at * 16;
    directory[entry] = size >= 256 ? 0 : size;   // 0 vuol dire 256
    directory[entry + 1] = size >= 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);       // piani
    directory.writeUInt16LE(32, entry + 6);      // bit per pixel
    directory.writeUInt32LE(body.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += body.length;
  });
  return Buffer.concat([header, directory, ...images.map((one) => one.body)]);
}

// ------------------------------------------------------------------ la corsa

const theme = value('--theme', 'magenta.css');
const tokens = themeColors(theme);
const need = (name) => {
  const found = tokens.get(name);
  if (!found) throw new Error(`il tema ${theme} non dichiara --color-${name}: niente ripieghi, l'icona non si disegna`);
  return found;
};
const colors = {
  fill: need('primary'),
  ink: need('on-primary'),
};
colors.fillRgb = [1, 3, 5].map((i) => parseInt(colors.fill.slice(i, i + 2), 16));
colors.inkRgb = [1, 3, 5].map((i) => parseInt(colors.ink.slice(i, i + 2), 16));

const SIZES = [16, 32, 48, 64];
const images = SIZES.map((size) => ({ size, body: png(size, raster(size, colors)) }));
const bytes = ico(images);

if (!flag('--check')) {
  writeFileSync(join(PUBLIC, 'favicon.svg'), svg(colors), 'utf8');
  writeFileSync(join(PUBLIC, 'favicon.ico'), bytes);
}

/**
 * QUELLO CHE SI PUÒ MISURARE DI UN'ICONA, invece di guardarla e dire che va bene.
 *
 * Tre cose, e la terza è la sola che dice qualcosa sul DISEGNO: che il file si rilegge come dichiara
 * (una directory che punta al posto sbagliato dà un'icona vuota, non un errore), il contrasto fra le due
 * tinte, e quanti pixel del pentagono e delle cuciture sopravvivono a SEDICI pixel - se sono pochi
 * l'icona è una palla di colore e la sagoma non c'è. Guardarla resta necessario: `--shot` la disegna
 * ingrandita in una pagina, che è dove si vede se il disegno funziona.
 */
const read = { count: bytes.readUInt16LE(4), sizes: [], pngs: 0 };
for (let at = 0; at < read.count; at += 1) {
  const entry = 6 + at * 16;
  const size = bytes[entry] || 256;
  const length = bytes.readUInt32LE(entry + 8);
  const offset = bytes.readUInt32LE(entry + 12);
  const body = bytes.subarray(offset, offset + length);
  const signature = body.subarray(0, 8).toString('hex');
  const declared = [body.readUInt32BE(16), body.readUInt32BE(20)];
  if (signature === '89504e470d0a1a0a' && declared[0] === size && declared[1] === size) read.pngs += 1;
  read.sizes.push(size);
}

const smallest = raster(16, colors);
let inkPixels = 0;
let fillPixels = 0;
for (let at = 0; at < smallest.length; at += 4) {
  if (smallest[at + 3] < 128) continue;
  // Più vicino all'inchiostro che alla tinta: è la domanda «questo pixel disegna la sagoma?».
  const toInk = colors.inkRgb.reduce((sum, c, i) => sum + (smallest[at + i] - c) ** 2, 0);
  const toFill = colors.fillRgb.reduce((sum, c, i) => sum + (smallest[at + i] - c) ** 2, 0);
  if (toInk < toFill) inkPixels += 1;
  else fillPixels += 1;
}

console.log(`favicon ${flag('--check') ? '(solo controllo)' : 'scritto'}: ${colors.fill} su ${colors.ink}, tema ${theme}`);
console.log(`· ico ${bytes.length} byte · ${read.count} immagini ${read.sizes.join('/')} · ${read.pngs} rilette come PNG della misura dichiarata`);
console.log(`· contrasto sagoma/tinta ${ratio(colors.ink, colors.fill).toFixed(2)}:1`);
console.log(`· a 16px: ${fillPixels} pixel di tinta e ${inkPixels} di sagoma su ${fillPixels + inkPixels} opachi`);

const problems = [];
if (read.pngs !== SIZES.length) problems.push(`${SIZES.length - read.pngs} immagini non si rileggono: la directory dell'ico punta male`);
if (ratio(colors.ink, colors.fill) < 3) problems.push('la sagoma non si stacca dalla tinta: sotto 3:1 a 16px non si vede');
// La soglia è quello che serve perché la sagoma esista: il pentagono da solo, a 16px, sono ~12 pixel.
if (inkPixels < 20) problems.push(`solo ${inkPixels} pixel di sagoma a 16px: l'icona è una palla di colore`);
if (fillPixels < 80) problems.push(`solo ${fillPixels} pixel di tinta a 16px: il pallone non riempie l'icona`);
for (const problem of problems) console.log(`  ⚠ ${problem}`);
console.log(problems.length ? `\n${problems.length} PROBLEMI` : '\nnessun problema');
process.exitCode = problems.length ? 1 : 0;

if (flag('--shot')) {
  /*
   * La pagina di prova: l'icona alle misure vere e ingrandita, così si guarda quello che il browser
   * DECODIFICA e non quello che il generatore crede di aver scritto.
   *
   * Scritta FUORI da `public/`, che è la cosa che si impara subito dopo averla scritta dentro: tutto
   * quello che sta là viene copiato nel sito pubblicato, quindi una pagina di debug in `public/` è una
   * pagina di debug su GitHub Pages. Le due icone le riscrive qui accanto, così la pagina sta in piedi
   * da sola.
   */
  const page = `<!doctype html><meta charset="utf-8"><title>favicon</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<body style="margin:0;font:12px system-ui;display:flex;gap:24px;padding:24px">
  <div style="background:#0a0a0f;color:#f2f2f7;padding:16px;display:flex;gap:16px;align-items:flex-end">
    ${[16, 32, 48, 64, 128].map((s) => `<div style="text-align:center"><img src="favicon.ico" width="${s}" height="${s}" style="image-rendering:pixelated"><br>${s} ico</div>`).join('')}
    <div style="text-align:center"><img src="favicon.svg" width="128" height="128"><br>128 svg</div>
  </div>
  <div style="background:#f2f2f7;color:#0a0a0f;padding:16px;display:flex;gap:16px;align-items:flex-end">
    ${[16, 32, 64].map((s) => `<div style="text-align:center"><img src="favicon.ico" width="${s}" height="${s}" style="image-rendering:pixelated"><br>${s} chiaro</div>`).join('')}
  </div>
  <!-- I 16 pixel VERI, ingranditi: dentro un ICO il browser sceglie da sé quale immagine usare, quindi
       chiedergliene una da 256 gli fa disegnare quella da 64 e la misura che conta non si vede mai. Qui
       il PNG da 16 è incollato per intero, quindi è esattamente quello che finisce nella scheda. -->
  <div style="background:#14141c;color:#f2f2f7;padding:16px;text-align:center">
    <img src="data:image/png;base64,${images[0].body.toString('base64')}" width="160" height="160"
         style="image-rendering:pixelated"><br>i 16px veri, ×10
  </div>
</body>`;
  const where = join(tmpdir(), 'fantassistant-favicon');
  mkdirSync(where, { recursive: true });
  writeFileSync(join(where, 'favicon.ico'), bytes);
  writeFileSync(join(where, 'favicon.svg'), svg(colors), 'utf8');
  writeFileSync(join(where, 'favicon-preview.html'), page, 'utf8');
  console.log(`· pagina di prova: ${join(where, 'favicon-preview.html')}`);
}
