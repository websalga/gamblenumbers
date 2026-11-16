'use strict';
/* GNQR - leitor de QR code proprio do GambleNumbers (sem bibliotecas externas).
 * Versoes 1 a 15 (ate ~400 caracteres), niveis de correcao L/M/Q/H, modos numerico, alfanumerico e byte (UTF-8).
 * Etapas: binarizacao local -> 3 quadrados de canto -> padrao de alinhamento -> homografia -> grade ->
 *         formato/mascara -> blocos -> Reed-Solomon (Euclides + Forney) -> texto.
 * Uso: GNQR.lerImageData(imageData) ou GNQR.decodificar(luminancia Uint8Array, largura, altura) -> texto | null */
(function (raiz) {
  // ===================== GF(256), polinomio 0x11D =====================
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
  const ginv = a => { if (a === 0) throw new Error('rs'); return EXP[255 - LOG[a]]; };

  // polinomios: coeficientes do MAIOR grau para o menor; zero = [0]
  function pn(c) { let i = 0; while (i < c.length - 1 && c[i] === 0) i++; return i ? c.slice(i) : c; }
  const pdeg = p => p.length - 1;
  const pcoef = (p, d) => p[p.length - 1 - d];
  const pzero = p => p[0] === 0;
  function padd(a, b) {
    if (pzero(a)) return b; if (pzero(b)) return a;
    let s = a, l = b; if (s.length > l.length) { s = b; l = a; }
    const r = l.slice(), d = l.length - s.length;
    for (let i = 0; i < s.length; i++) r[i + d] ^= s[i];
    return pn(r);
  }
  function pmul(a, b) {
    if (pzero(a) || pzero(b)) return [0];
    const r = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] ^= gmul(a[i], b[j]);
    return pn(r);
  }
  const pscale = (a, s) => s === 0 ? [0] : pn(a.map(x => gmul(x, s)));
  function pmono(deg, c) { if (c === 0) return [0]; const r = new Array(deg + 1).fill(0); r[0] = c; return r; }
  function pmulmono(a, deg, c) { if (c === 0 || pzero(a)) return [0]; const r = a.map(x => gmul(x, c)); for (let k = 0; k < deg; k++) r.push(0); return pn(r); }
  function peval(p, x) { if (x === 0) return pcoef(p, 0); let r = p[0]; for (let i = 1; i < p.length; i++) r = gmul(r, x) ^ p[i]; return r; }

  /* Reed-Solomon (raizes alfa^0..alfa^(nec-1)). Devolve o bloco corrigido ou lanca erro se nao der para corrigir. */
  function rsCorrigir(bloco, nec) {
    const rec = Array.from(bloco);
    const rp = pn(rec.slice());
    const sind = new Array(nec); let limpo = true;
    for (let i = 0; i < nec; i++) { const v = peval(rp, EXP[i]); sind[nec - 1 - i] = v; if (v) limpo = false; }
    if (limpo) return rec;
    let a = pmono(nec, 1), b = pn(sind);
    if (pdeg(a) < pdeg(b)) { const t = a; a = b; b = t; }
    let rLast = a, r = b, tLast = [0], t = [1];
    while (pdeg(r) >= (nec >> 1)) {
      const rLL = rLast, tLL = tLast; rLast = r; tLast = t;
      if (pzero(rLast)) throw new Error('rs');
      r = rLL; let q = [0];
      const inv = ginv(pcoef(rLast, pdeg(rLast)));
      while (pdeg(r) >= pdeg(rLast) && !pzero(r)) {
        const dd = pdeg(r) - pdeg(rLast), sc = gmul(pcoef(r, pdeg(r)), inv);
        q = padd(q, pmono(dd, sc)); r = padd(r, pmulmono(rLast, dd, sc));
      }
      t = padd(pmul(q, tLast), tLL);
      if (pdeg(r) >= pdeg(rLast)) throw new Error('rs');
    }
    const s0 = pcoef(t, 0); if (s0 === 0) throw new Error('rs');
    const iv = ginv(s0), sigma = pscale(t, iv), omega = pscale(r, iv);
    const ne = pdeg(sigma); let locs;
    if (ne === 1) locs = [pcoef(sigma, 1)];
    else { locs = []; for (let i = 1; i < 256 && locs.length < ne; i++) if (peval(sigma, i) === 0) locs.push(ginv(i)); if (locs.length !== ne) throw new Error('rs'); }
    if (2 * ne > nec) throw new Error('rs');
    for (let i = 0; i < locs.length; i++) {
      const xi = ginv(locs[i]); let den = 1;
      for (let j = 0; j < locs.length; j++) if (i !== j) { const tm = gmul(locs[j], xi); den = gmul(den, (tm & 1) === 0 ? tm | 1 : tm & ~1); }
      const mag = gmul(peval(omega, xi), ginv(den));
      const pos = rec.length - 1 - LOG[locs[i]];
      if (pos < 0) throw new Error('rs');
      rec[pos] ^= mag;
    }
    const rp2 = pn(rec.slice());
    for (let i = 0; i < nec; i++) if (peval(rp2, EXP[i]) !== 0) throw new Error('rs');
    return rec;
  }

  // ===================== estrutura do simbolo =====================
  // [codewords de correcao por bloco, blocos grupo 1, dados por bloco g1, blocos g2, dados g2]
  const TAB = [null,
    { L: [7, 1, 19], M: [10, 1, 16], Q: [13, 1, 13], H: [17, 1, 9] },
    { L: [10, 1, 34], M: [16, 1, 28], Q: [22, 1, 22], H: [28, 1, 16] },
    { L: [15, 1, 55], M: [26, 1, 44], Q: [18, 2, 17], H: [22, 2, 13] },
    { L: [20, 1, 80], M: [18, 2, 32], Q: [26, 2, 24], H: [16, 4, 9] },
    { L: [26, 1, 108], M: [24, 2, 43], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
    { L: [18, 2, 68], M: [16, 4, 27], Q: [24, 4, 19], H: [28, 4, 15] },
    { L: [20, 2, 78], M: [18, 4, 31], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
    { L: [24, 2, 97], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
    { L: [30, 2, 116], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
    { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] },
    { L: [20, 4, 81], M: [30, 1, 50, 4, 51], Q: [28, 4, 22, 4, 23], H: [24, 3, 12, 8, 13] },
    { L: [24, 2, 92, 2, 93], M: [22, 6, 36, 2, 37], Q: [26, 4, 20, 6, 21], H: [28, 7, 14, 4, 15] },
    { L: [26, 4, 107], M: [22, 8, 37, 1, 38], Q: [24, 8, 20, 4, 21], H: [22, 12, 11, 4, 12] },
    { L: [30, 3, 115, 1, 116], M: [24, 4, 40, 5, 41], Q: [20, 11, 16, 5, 17], H: [24, 11, 12, 5, 13] },
    { L: [22, 5, 87, 1, 88], M: [24, 5, 41, 5, 42], Q: [30, 5, 24, 7, 25], H: [24, 11, 12, 7, 13] }];
  const VMAX = 15;
  const NIVEL_BITS = { M: 0, L: 1, H: 2, Q: 3 };
  const NIVEL_DE_BITS = ['M', 'L', 'H', 'Q'];

  function alinhamentos(v) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2, tam = v * 4 + 17;
    const passo = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    const r = [6]; for (let p = tam - 7; r.length < n; p -= passo) r.splice(1, 0, p);
    return r;
  }
  /* 1 = modulo de funcao (finder, separador, timing, alinhamento, formato, versao, modulo escuro) */
  function mascaraFuncao(v) {
    const n = v * 4 + 17, f = new Uint8Array(n * n);
    const set = (x, y) => { if (x >= 0 && y >= 0 && x < n && y < n) f[y * n + x] = 1; };
    for (let i = 0; i < n; i++) { set(6, i); set(i, 6); }
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) set(cx + dx, cy + dy);
    const al = alinhamentos(v), na = al.length;
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy);
    }
    for (let i = 0; i <= 8; i++) { set(8, i); set(i, 8); }
    for (let i = 0; i < 8; i++) { set(n - 1 - i, 8); set(8, n - 1 - i); }
    if (v >= 7) for (let i = 0; i < 18; i++) { const a = n - 11 + i % 3, b = Math.floor(i / 3); set(a, b); set(b, a); }
    return f;
  }
  /* posicoes [x,y] do bit i do formato: copia 1 (em volta do canto superior esquerdo) e copia 2 */
  function posFormato(n) {
    const a = [], b = [];
    for (let i = 0; i <= 5; i++) a.push([8, i]);
    a.push([8, 7], [8, 8], [7, 8]);
    for (let i = 9; i < 15; i++) a.push([14 - i, 8]);
    for (let i = 0; i < 8; i++) b.push([n - 1 - i, 8]);
    for (let i = 8; i < 15; i++) b.push([8, n - 15 + i]);
    return [a, b];
  }
  function codFormato(ecBits, mascara) {
    const d = (ecBits << 3) | mascara; let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    return ((d << 10) | r) ^ 0x5412;
  }
  function codVersao(v) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25); return (v << 12) | r; }
  const MASCARAS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  /* ordem de leitura dos modulos de dados (zigue-zague de 2 colunas, da direita para a esquerda) */
  function ordemDados(n, f) {
    const ord = [];
    for (let dir = n - 1; dir >= 1; dir -= 2) {
      if (dir === 6) dir = 5;
      const sobe = ((dir + 1) & 2) === 0;
      for (let k = 0; k < n; k++) for (let j = 0; j < 2; j++) {
        const x = dir - j, y = sobe ? n - 1 - k : k;
        if (!f[y * n + x]) ord.push(y * n + x);
      }
    }
    return ord;
  }
  const popc = x => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };
  function blocosDe(v, nivel) {
    const [nec, n1, d1, n2 = 0, d2 = 0] = TAB[v][nivel];
    const bl = []; for (let i = 0; i < n1; i++) bl.push(d1); for (let i = 0; i < n2; i++) bl.push(d2);
    return { nec, bl, total: n1 * (d1 + nec) + n2 * (d2 + nec) };
  }

  // ===================== matriz -> texto =====================
  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  function utf8(b) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
    catch (e) { let s = ''; for (const x of b) s += String.fromCharCode(x); return s; }
  }
  function lerTexto(by, v) {
    const nb = by.length * 8; let pos = 0;
    const rd = k => { if (pos + k > nb) throw new Error('fim'); let x = 0; for (let i = 0; i < k; i++, pos++) x = (x << 1) | ((by[pos >> 3] >> (7 - (pos & 7))) & 1); return x; };
    let txt = '';
    while (nb - pos >= 4) {
      const modo = rd(4);
      if (modo === 0) break;
      if (modo === 1) {
        let c = rd(v < 10 ? 10 : 12);
        while (c >= 3) { const x = rd(10); if (x > 999) throw new Error('num'); txt += String(x).padStart(3, '0'); c -= 3; }
        if (c === 2) { const x = rd(7); if (x > 99) throw new Error('num'); txt += String(x).padStart(2, '0'); }
        else if (c === 1) { const x = rd(4); if (x > 9) throw new Error('num'); txt += String(x); }
      } else if (modo === 2) {
        let c = rd(v < 10 ? 9 : 11);
        while (c >= 2) { const x = rd(11); if (x >= 2025) throw new Error('an'); txt += ALNUM[(x / 45) | 0] + ALNUM[x % 45]; c -= 2; }
        if (c === 1) { const x = rd(6); if (x >= 45) throw new Error('an'); txt += ALNUM[x]; }
      } else if (modo === 4) {
        const c = rd(v < 10 ? 8 : 16); const b = new Uint8Array(c);
        for (let i = 0; i < c; i++) b[i] = rd(8);
        txt += utf8(b);
      } else if (modo === 7) {            // ECI: so pula o designador (o texto e lido como UTF-8)
        const d = rd(8); if ((d & 0x80) === 0) { } else if ((d & 0xC0) === 0x80) rd(8); else rd(16);
      } else if (modo === 3) rd(16);       // structured append
      else if (modo === 5) { }             // FNC1 (1a posicao)
      else if (modo === 9) rd(8);          // FNC1 (2a posicao)
      else throw new Error('modo');        // Kanji e outros: nao usados em pagamentos
    }
    return txt;
  }
  /* m: Uint8Array n*n (1 = escuro) */
  function decodificarMatriz(m, n) {
    if (n < 21 || (n - 17) % 4) throw new Error('tam');
    const v = (n - 17) / 4;
    if (v > VMAX) throw new Error('versao');
    if (v >= 7) {
      let a = 0, b = 0;
      for (let i = 0; i < 18; i++) { const x = n - 11 + i % 3, y = Math.floor(i / 3); a |= m[y * n + x] << i; b |= m[x * n + y] << i; }
      let melhor = 0, md = 99;
      for (let k = 7; k <= 40; k++) { const c = codVersao(k), d = Math.min(popc(c ^ a), popc(c ^ b)); if (d < md) { md = d; melhor = k; } }
      if (md > 3 || melhor !== v) throw new Error('versao');
    }
    const [pa, pb] = posFormato(n);
    const ler = ps => ps.reduce((acc, [x, y], i) => acc | (m[y * n + x] << i), 0);
    const fa = ler(pa), fb = ler(pb);
    let ecb = -1, mk = -1, bd = 99;
    for (let e = 0; e < 4; e++) for (let k = 0; k < 8; k++) { const c = codFormato(e, k), d = Math.min(popc(c ^ fa), popc(c ^ fb)); if (d < bd) { bd = d; ecb = e; mk = k; } }
    if (bd > 3) throw new Error('formato');
    const nivel = NIVEL_DE_BITS[ecb];
    const f = mascaraFuncao(v), ord = ordemDados(n, f);
    const { nec, bl, total } = blocosDe(v, nivel);
    if (ord.length < total * 8) throw new Error('tam');
    const bytes = new Uint8Array(total), msk = MASCARAS[mk];
    for (let i = 0; i < total * 8; i++) {
      const p = ord[i], x = p % n, y = (p / n) | 0;
      if (m[p] ^ (msk(x, y) ? 1 : 0)) bytes[i >> 3] |= 0x80 >> (i & 7);
    }
    const blocos = bl.map(d => ({ d, b: [] }));
    let k = 0; const maxd = Math.max(...bl);
    for (let i = 0; i < maxd; i++) for (const b of blocos) if (i < b.d) b.b.push(bytes[k++]);
    for (let i = 0; i < nec; i++) for (const b of blocos) b.b.push(bytes[k++]);
    const dados = [];
    for (const b of blocos) { const c = rsCorrigir(b.b, nec); for (let i = 0; i < b.d; i++) dados.push(c[i]); }
    return lerTexto(dados, v);
  }

  // ===================== imagem -> bits =====================
  /* binarizacao local (blocos 8x8, limiar pela media de 5x5 blocos vizinhos) */
  function binarizar(lum, w, h) {
    if (w < 40 || h < 40) return binarizarGlobal(lum, w, h);
    const B = 8, sw = Math.ceil(w / B), sh = Math.ceil(h / B), bp = new Float32Array(sw * sh), out = new Uint8Array(w * h);
    for (let by = 0; by < sh; by++) {
      const y0 = Math.min(by * B, h - B);
      for (let bx = 0; bx < sw; bx++) {
        const x0 = Math.min(bx * B, w - B);
        let s = 0, mn = 255, mx = 0;
        for (let yy = 0; yy < B; yy++) { const o = (y0 + yy) * w + x0; for (let xx = 0; xx < B; xx++) { const q = lum[o + xx]; s += q; if (q < mn) mn = q; if (q > mx) mx = q; } }
        let av = s / 64;
        if (mx - mn <= 24) {
          av = mn / 2;
          if (by > 0 && bx > 0) { const nb = (bp[(by - 1) * sw + bx] + 2 * bp[by * sw + bx - 1] + bp[(by - 1) * sw + bx - 1]) / 4; if (mn < nb) av = nb; }
        }
        bp[by * sw + bx] = av;
      }
    }
    for (let by = 0; by < sh; by++) {
      const y0 = Math.min(by * B, h - B), t = Math.min(Math.max(by, 2), sh - 3);
      for (let bx = 0; bx < sw; bx++) {
        const x0 = Math.min(bx * B, w - B), l = Math.min(Math.max(bx, 2), sw - 3);
        let s = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += bp[(t + dy) * sw + l + dx];
        const lim = s / 25;
        for (let yy = 0; yy < B; yy++) { const o = (y0 + yy) * w + x0; for (let xx = 0; xx < B; xx++) out[o + xx] = lum[o + xx] <= lim ? 1 : 0; }
      }
    }
    return out;
  }
  /* limiar unico (Otsu) - segunda tentativa */
  function binarizarGlobal(lum, w, h) {
    const hist = new Uint32Array(256); for (let i = 0; i < lum.length; i++) hist[lum[i]]++;
    let tot = 0; for (let i = 0; i < 256; i++) tot += i * hist[i];
    let sB = 0, wB = 0, melhor = 0, lim = 127; const N = lum.length;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = N - wB; if (!wF) break;
      sB += t * hist[t]; const mB = sB / wB, mF = (tot - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > melhor) { melhor = v; lim = t; }
    }
    const out = new Uint8Array(w * h); for (let i = 0; i < out.length; i++) out[i] = lum[i] <= lim ? 1 : 0;
    return out;
  }

  // ===================== quadrados de canto (finder patterns) =====================
  function acharFinders(bm, w, h) {
    const C = [];
    const pr = (x, y) => bm[y * w + x] === 1;
    const cruz = sc => {
      const tot = sc[0] + sc[1] + sc[2] + sc[3] + sc[4]; if (tot < 7) return false;
      for (let i = 0; i < 5; i++) if (!sc[i]) return false;
      const ms = tot / 7, mv = ms / 2;
      return Math.abs(ms - sc[0]) < mv && Math.abs(ms - sc[1]) < mv && Math.abs(3 * ms - sc[2]) < 3 * mv && Math.abs(ms - sc[3]) < mv && Math.abs(ms - sc[4]) < mv;
    };
    const centro = (sc, fim) => fim - sc[4] - sc[3] - sc[2] / 2;
    function cc(fixo, ini, max, tot0, vertical) {
      const lim = vertical ? h : w, P = vertical ? (k => pr(fixo, k)) : (k => pr(k, fixo));
      const sc = [0, 0, 0, 0, 0]; let i = ini;
      while (i >= 0 && P(i)) { sc[2]++; i--; } if (i < 0) return NaN;
      while (i >= 0 && !P(i) && sc[1] <= max) { sc[1]++; i--; } if (i < 0 || sc[1] > max) return NaN;
      while (i >= 0 && P(i) && sc[0] <= max) { sc[0]++; i--; } if (sc[0] > max) return NaN;
      i = ini + 1;
      while (i < lim && P(i)) { sc[2]++; i++; } if (i === lim) return NaN;
      while (i < lim && !P(i) && sc[3] < max) { sc[3]++; i++; } if (i === lim || sc[3] >= max) return NaN;
      while (i < lim && P(i) && sc[4] < max) { sc[4]++; i++; } if (sc[4] >= max) return NaN;
      const tot = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
      if (5 * Math.abs(tot - tot0) >= 2 * tot0) return NaN;
      return cruz(sc) ? centro(sc, i) : NaN;
    }
    function possivel(sc, i, j) {
      const tot = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
      let cj = centro(sc, j);
      const ci = cc(Math.floor(cj), i, sc[2], tot, true); if (isNaN(ci)) return false;
      cj = cc(Math.floor(ci), Math.floor(cj), sc[2], tot, false); if (isNaN(cj)) return false;
      const ms = tot / 7;
      for (const c of C) if (Math.abs(ci - c.y) <= ms && Math.abs(cj - c.x) <= ms) {
        const d = Math.abs(ms - c.ms);
        if (d <= 1 || d <= c.ms) { c.x = (c.x * c.n + cj) / (c.n + 1); c.y = (c.y * c.n + ci) / (c.n + 1); c.ms = (c.ms * c.n + ms) / (c.n + 1); c.n++; return true; }
      }
      C.push({ x: cj, y: ci, ms, n: 1 });
      return true;
    }
    const passo = h > 700 ? 2 : 1;
    for (let i = 0; i < h; i += passo) {
      const sc = [0, 0, 0, 0, 0]; let st = 0;
      for (let j = 0; j < w; j++) {
        if (pr(j, i)) { if (st & 1) st++; sc[st]++; }
        else if ((st & 1) === 0) {
          if (st === 4) {
            if (cruz(sc) && possivel(sc, i, j)) { sc.fill(0); st = 0; }
            else { sc[0] = sc[2]; sc[1] = sc[3]; sc[2] = sc[4]; sc[3] = 1; sc[4] = 0; st = 3; }
          } else { st++; sc[st]++; }
        } else sc[st]++;
      }
      if (st === 4 && cruz(sc)) possivel(sc, i, w);
    }
    return C;
  }
  const d2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
  /* trios de candidatos com cara de QR (triangulo retangulo isosceles, modulos parecidos), melhores primeiro */
  function trios(C) {
    let cs = C.filter(c => c.n >= 2); if (cs.length < 3) cs = C.slice(); if (cs.length < 3) return [];
    cs.sort((a, b) => b.n - a.n); cs = cs.slice(0, 12);
    const r = [];
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) for (let k = j + 1; k < cs.length; k++) {
      const p = [cs[i], cs[j], cs[k]];
      const mmax = Math.max(p[0].ms, p[1].ms, p[2].ms), mmin = Math.min(p[0].ms, p[1].ms, p[2].ms);
      if (mmax > mmin * 1.8) continue;
      const lados = [d2(p[1], p[2]), d2(p[0], p[2]), d2(p[0], p[1])].sort((a, b) => a - b);
      const [s1, s2, L] = lados;
      const ms = (p[0].ms + p[1].ms + p[2].ms) / 3, curto = Math.sqrt(s1) / ms;
      if (curto < 9 || curto > 4 * VMAX + 17) continue;
      const ang = Math.abs(L - (s1 + s2)) / L, iso = (Math.sqrt(s2) - Math.sqrt(s1)) / Math.sqrt(s2);
      if (ang > 0.5 || iso > 0.5) continue;
      r.push({ nota: ang + iso + (mmax - mmin) / mmin, p });
    }
    r.sort((a, b) => a.nota - b.nota);
    return r.slice(0, 4).map(x => x.p);
  }
  /* [inferior esquerdo, superior esquerdo, superior direito] */
  function ordenar(p) {
    const a01 = d2(p[0], p[1]), a12 = d2(p[1], p[2]), a02 = d2(p[0], p[2]);
    let A, B, Cc;
    if (a12 >= a01 && a12 >= a02) { B = p[0]; A = p[1]; Cc = p[2]; }
    else if (a02 >= a12 && a02 >= a01) { B = p[1]; A = p[0]; Cc = p[2]; }
    else { B = p[2]; A = p[0]; Cc = p[1]; }
    if ((Cc.x - B.x) * (A.y - B.y) - (Cc.y - B.y) * (A.x - B.x) < 0) { const t = A; A = Cc; Cc = t; }
    return [A, B, Cc];
  }
  /* padrao de alinhamento perto de (ex, ey): centro escuro, anel claro, anel escuro */
  function acharAlinhamento(bm, w, h, ex, ey, ms, raio) {
    const ok = (x, y, esp) => { const xx = Math.round(x), yy = Math.round(y); return xx >= 0 && yy >= 0 && xx < w && yy < h && bm[yy * w + xx] === esp; };
    const x0 = Math.max(0, Math.floor(ex - raio)), x1 = Math.min(w - 1, Math.ceil(ex + raio));
    const y0 = Math.max(0, Math.floor(ey - raio)), y1 = Math.min(h - 1, Math.ceil(ey + raio));
    const achados = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (bm[y * w + x] !== 1) continue;
      if (!(ok(x + ms, y, 0) && ok(x - ms, y, 0) && ok(x, y + ms, 0) && ok(x, y - ms, 0) &&
            ok(x + ms, y + ms, 0) && ok(x - ms, y - ms, 0) && ok(x + ms, y - ms, 0) && ok(x - ms, y + ms, 0) &&
            ok(x + 2 * ms, y, 1) && ok(x - 2 * ms, y, 1) && ok(x, y + 2 * ms, 1) && ok(x, y - 2 * ms, 1))) continue;
      let a = x, b = x, c = y, e = y;
      while (a > 0 && bm[y * w + a - 1] === 1) a--; while (b < w - 1 && bm[y * w + b + 1] === 1) b++;
      while (c > 0 && bm[(c - 1) * w + x] === 1) c--; while (e < h - 1 && bm[(e + 1) * w + x] === 1) e++;
      if (b - a + 1 > 2 * ms + 1 || e - c + 1 > 2 * ms + 1) continue;
      const p = { x: (a + b + 1) / 2, y: (c + e + 1) / 2 }, d = (p.x - ex) * (p.x - ex) + (p.y - ey) * (p.y - ey);
      if (!achados.some(q => Math.abs(q.x - p.x) < ms && Math.abs(q.y - p.y) < ms)) achados.push(Object.assign(p, { d }));
    }
    achados.sort((p, q) => p.d - q.d);
    return achados.slice(0, 4);
  }
  /* homografia (modulo -> pixel) por 4 pares de pontos */
  function homografia(src, dst) {
    const A = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = src[i], x = dst[i].x, y = dst[i].y;
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
    }
    for (let c = 0; c < 8; c++) {
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null;
      const t = A[c]; A[c] = A[p]; A[p] = t;
      for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
    }
    const H = A.map((r, i) => r[8] / r[i]);
    return (u, v) => { const d = H[6] * u + H[7] * v + 1; return [(H[0] * u + H[1] * v + H[2]) / d, (H[3] * u + H[4] * v + H[5]) / d]; };
  }
  function amostrar(bm, w, h, T, n) {
    const m = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const [px, py] = T(x + 0.5, y + 0.5);
      if (!(px > -2 && py > -2 && px < w + 2 && py < h + 2)) return null;
      const ix = Math.min(w - 1, Math.max(0, Math.floor(px))), iy = Math.min(h - 1, Math.max(0, Math.floor(py)));
      m[y * n + x] = bm[iy * w + ix];
    }
    return m;
  }
  /* largura (em px) do trecho escuro-claro-escuro a partir do centro de um quadrado de canto, na direcao de (tx,ty) (Bresenham) */
  function corridaPEP(bm, w, h, fx, fy, tx, ty) {
    const ingreme = Math.abs(ty - fy) > Math.abs(tx - fx);
    if (ingreme) { [fx, fy] = [fy, fx]; [tx, ty] = [ty, tx]; }
    const dx = Math.abs(tx - fx), dy = Math.abs(ty - fy), sx = fx < tx ? 1 : -1, sy = fy < ty ? 1 : -1;
    let err = -dx / 2, estado = 0;
    for (let x = fx, y = fy; x !== tx + sx; x += sx) {
      const rx = ingreme ? y : x, ry = ingreme ? x : y;
      const preto = rx >= 0 && ry >= 0 && rx < w && ry < h && bm[ry * w + rx] === 1;
      if ((estado === 1) === preto) { if (estado === 2) return Math.hypot(x - fx, y - fy); estado++; }
      err += dy; if (err > 0) { if (y === ty) break; y += sy; err -= dx; }
    }
    return estado === 2 ? Math.hypot(tx + sx - fx, ty - fy) : NaN;
  }
  function corridaDosDoisLados(bm, w, h, fx, fy, tx, ty) {
    let r = corridaPEP(bm, w, h, fx, fy, tx, ty);
    let esc = 1, ox = fx - (tx - fx);
    if (ox < 0) { esc = fx / (fx - ox); ox = 0; } else if (ox >= w) { esc = (w - 1 - fx) / (ox - fx); ox = w - 1; }
    let oy = Math.floor(fy - (ty - fy) * esc); esc = 1;
    if (oy < 0) { esc = fy / (fy - oy); oy = 0; } else if (oy >= h) { esc = (h - 1 - fy) / (oy - fy); oy = h - 1; }
    ox = Math.floor(fx + (ox - fx) * esc);
    r += corridaPEP(bm, w, h, fx, fy, ox, oy);
    return r - 1;
  }
  /* tamanho do modulo medido ao longo da linha entre dois quadrados de canto (correto mesmo com o QR girado) */
  function moduloEntre(bm, w, h, a, b) {
    const ax = Math.floor(a.x), ay = Math.floor(a.y), bx = Math.floor(b.x), by = Math.floor(b.y);
    const m1 = corridaDosDoisLados(bm, w, h, ax, ay, bx, by), m2 = corridaDosDoisLados(bm, w, h, bx, by, ax, ay);
    if (isNaN(m1)) return m2 / 7; if (isNaN(m2)) return m1 / 7;
    return (m1 + m2) / 14;
  }
  /* Com perspectiva, o 4o canto (paralelogramo) erra alguns modulos. Procura, em volta dele, as posicoes em que o padrao
     de alinhamento 5x5 (canto inferior direito) amostrado pela homografia fica perfeito. Grosso (1 modulo) e depois fino (1/4). */
  function buscarQuarto(bm, w, h, tl, tr, bl, br, ms, n) {
    const c = n - 7, src = [[3.5, 3.5], [n - 3.5, 3.5], [n - 3.5, n - 3.5], [3.5, n - 3.5]];
    const nota = q => {
      const T = homografia(src, [tl, tr, q, bl]); if (!T) return -1;
      let s = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const [px, py] = T(c + dx + 0.5, c + dy + 0.5), ix = Math.floor(px), iy = Math.floor(py);
        if (ix < 0 || iy < 0 || ix >= w || iy >= h) return -1;
        if (bm[iy * w + ix] === (Math.max(Math.abs(dx), Math.abs(dy)) === 1 ? 0 : 1)) s++;
      }
      return s;
    };
    const grossos = [];
    for (let oy = -5; oy <= 5; oy++) for (let ox = -5; ox <= 5; ox++) {
      const q = { x: br.x + ox * ms, y: br.y + oy * ms }, s = nota(q);
      if (s >= 21) grossos.push({ q, s });
    }
    grossos.sort((a, b) => b.s - a.s);
    const finos = [];
    for (const g of grossos.slice(0, 4)) {
      let melhor = g;
      for (let oy = -4; oy <= 4; oy++) for (let ox = -4; ox <= 4; ox++) {
        const q = { x: g.q.x + ox * ms / 4, y: g.q.y + oy * ms / 4 }, s = nota(q);
        if (s > melhor.s) melhor = { q, s };
      }
      if (!finos.some(f => Math.abs(f.q.x - melhor.q.x) < ms / 2 && Math.abs(f.q.y - melhor.q.y) < ms / 2)) finos.push(melhor);
    }
    return finos.filter(f => f.s >= 23).map(f => f.q);
  }
  /* Checagem barata antes de montar a grade: as duas copias do formato tem que bater com o mesmo codigo valido.
     A 1a fica junto do canto superior esquerdo; a 2a, junto dos cantos superior direito e inferior esquerdo.
     Cada trecho e amostrado pelo canto mais proximo (homografia local), entao a perspectiva nao atrapalha. */
  const FORMATOS = []; for (let e = 0; e < 4; e++) for (let k = 0; k < 8; k++) FORMATOS.push(codFormato(e, k));
  function previa(bm, w, h, tl, tr, bl, br, n) {
    const T = homografia([[3.5, 3.5], [n - 3.5, 3.5], [n - 3.5, n - 3.5], [3.5, n - 3.5]], [tl, tr, br, bl]); if (!T) return false;
    // deslocamento local: cada bit e medido a partir do quadrado de canto mais proximo (erro do 4o canto nao entra)
    const ancora = (x, y) => (x > n / 2 ? [tr, n - 3.5, 3.5] : y > n / 2 ? [bl, 3.5, n - 3.5] : [tl, 3.5, 3.5]);
    const bit = (x, y) => {
      const [p, ux, uy] = ancora(x, y), [ax, ay] = T(ux, uy), [px, py] = T(x + 0.5, y + 0.5);
      const ix = Math.floor(px - ax + p.x), iy = Math.floor(py - ay + p.y);
      return (ix < 0 || iy < 0 || ix >= w || iy >= h) ? -1 : bm[iy * w + ix];
    };
    const [pa, pb] = posFormato(n); let f1 = 0, f2 = 0;
    for (let i = 0; i < 15; i++) {
      const a = bit(pa[i][0], pa[i][1]), b = bit(pb[i][0], pb[i][1]); if (a < 0 || b < 0) return false;
      f1 |= a << i; f2 |= b << i;
    }
    for (const c of FORMATOS) { const d1 = popc(c ^ f1), d2 = popc(c ^ f2); if ((d1 <= 3 && d2 <= 3) || d1 === 0 || d2 === 0) return true; }
    return false;
  }
  function tentar(bm, w, h, rapido) {
    const C = acharFinders(bm, w, h);
    for (const t of trios(C)) {
      const [bl, tl, tr] = ordenar(t);
      let ms = (moduloEntre(bm, w, h, tl, tr) + moduloEntre(bm, w, h, tl, bl)) / 2;
      if (!(ms > 0.5)) ms = (bl.ms + tl.ms + tr.ms) / 3;
      const dim = ((Math.round(Math.sqrt(d2(tl, tr)) / ms) + Math.round(Math.sqrt(d2(tl, bl)) / ms)) >> 1) + 7;
      const v0 = (dim - 17) / 4, vs = [];
      for (const v of [Math.round(v0), Math.floor(v0), Math.ceil(v0), Math.round(v0) + 1, Math.round(v0) - 1, Math.round(v0) + 2, Math.round(v0) - 2]) if (v >= 1 && v <= VMAX && !vs.includes(v)) vs.push(v);
      const br = { x: tr.x - tl.x + bl.x, y: tr.y - tl.y + bl.y };
      for (const v of vs) {
        const n = 17 + 4 * v, ancoras = [];
        if (rapido && !previa(bm, w, h, tl, tr, bl, br, n)) continue;   // modo rapido: formato nao bate, pula esta hipotese
        if (v >= 2) {
          const corr = 1 - 3 / (n - 7), ex = tl.x + corr * (br.x - tl.x), ey = tl.y + corr * (br.y - tl.y);
          // escala local no canto inferior direito (com perspectiva ela difere da media): extrapola pelos 3 cantos
          const local = Math.max(0.6, tr.ms + bl.ms - tl.ms) * (ms / ((tl.ms + tr.ms + bl.ms) / 3));
          const escalas = [ms, local, ms * 0.8, ms * 1.25, local * 0.8, local * 1.25, ms * 0.65, ms * 1.5];
          busca: for (const f of [4, 8, 16]) for (const e of escalas) {
            const as = acharAlinhamento(bm, w, h, ex, ey, e, f * ms);
            if (as.length) { for (const a of as) ancoras.push([n - 6.5, a]); break busca; }
          }
        }
        if (v >= 2) for (const q of buscarQuarto(bm, w, h, tl, tr, bl, br, ms, n)) ancoras.push([n - 3.5, q]);
        ancoras.push([n - 3.5, br]);
        // 1a tentativa: o 4o ponto como estimado; depois pequenos ajustes (a perspectiva desloca o canto)
        const ajustes = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]];
        for (const [pos, p] of ancoras) for (const [ax, ay] of ajustes) {
          try {
            const q = { x: p.x + ax * ms * 0.6, y: p.y + ay * ms * 0.6 };
            const T = homografia([[3.5, 3.5], [n - 3.5, 3.5], [pos, pos], [3.5, n - 3.5]], [tl, tr, q, bl]); if (!T) continue;
            const m = amostrar(bm, w, h, T, n); if (!m) continue;
            const txt = decodificarMatriz(m, n);
            if (txt) return txt;
          } catch (e) { /* tenta a proxima hipotese */ }
        }
      }
    }
    return null;
  }
  /* luminancia (0 = preto) -> texto do QR, ou null.
     op.rapido = true: so binarizacao local e checagem previa (quadros da camera); sem op: tudo (foto, ou 1 a cada N quadros) */
  function decodificar(lum, w, h, op) {
    const rapido = !!(op && op.rapido);
    for (const bin of rapido ? [binarizar] : [binarizar, binarizarGlobal]) {
      const bm = bin(lum, w, h);
      let r = tentar(bm, w, h, rapido); if (r !== null) return r;
      if (rapido) continue;
      const inv = new Uint8Array(bm.length); for (let i = 0; i < bm.length; i++) inv[i] = 1 - bm[i];   // QR claro sobre fundo escuro
      r = tentar(inv, w, h, false); if (r !== null) return r;
    }
    return null;
  }
  function lerImageData(img, op) {
    const { data, width: w, height: h } = img, lum = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    return decodificar(lum, w, h, op);
  }

  const api = { decodificar, lerImageData, decodificarMatriz, rsCorrigir,
    _int: { TAB, VMAX, NIVEL_BITS, alinhamentos, mascaraFuncao, posFormato, codFormato, codVersao, MASCARAS, ordemDados, blocosDe, EXP, LOG, gmul } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.GNQR = api;
  // Carregado como Web Worker (new Worker('qr_leitor.js')): decodifica fora da tela, sem travar a interface
  if (typeof importScripts === 'function' && typeof document === 'undefined' && typeof module === 'undefined') {
    raiz.onmessage = e => {
      const { id, w, h, buf, rapido } = e.data || {}; let txt = null;
      try { txt = lerImageData({ data: new Uint8ClampedArray(buf), width: w, height: h }, { rapido }); } catch (x) { txt = null; }
      raiz.postMessage({ id, txt });
    };
  }
})(typeof self !== 'undefined' ? self : this);
