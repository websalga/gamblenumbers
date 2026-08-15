'use strict';
/* ============================================================
 * Renderers — os "robôs" que desenham no canvas.
 *
 * Cada classe faz UMA coisa no gráfico e nada mais. Todas seguem
 * o mesmo contrato:
 *     draw(plot, data)
 * onde `plot` é o PlotArea (dono do ctx e das escalas) e `data` é
 * só o que aquele robô precisa. Nenhum robô conhece os outros;
 * nenhum guarda estado do desenho. A ordem de pintura é decidida
 * por quem orquestra (o gráfico), não pelos robôs.
 *
 * Isto é o modelo Unix aplicado ao canvas: ferramentas pequenas,
 * cada uma boa em exatamente uma tarefa, combináveis.
 * ============================================================ */

/* Desenha o fundo da região de projeção (à direita do "agora"). */
class ProjectionBgRenderer {
  draw(plot, data) {
    const ctx = plot.ctx; if (!ctx) return;
    const nowX = plot.X(data.nowT);
    const r = plot.plotRect;
    ctx.fillStyle = plot.color('projBg');
    ctx.fillRect(nowX, r.y, (plot.w - plot.pad.r) - nowX, r.h);
  }
}

/* Grid horizontal + rótulos de preço no eixo direito. */
/* Formata valor do eixo de preco conforme a ordem de grandeza - ativos
 * como BTC ficam na casa das centenas de milhares (formato 'Xk' faz
 * sentido), mas BCH/outras moedas em GBP/EUR podem ficar na casa das
 * dezenas/centenas, onde dividir por 1000 e arredondar sempre dava "0k". */
function fmtEixoPreco(p) {
  const ap = Math.abs(p);
  if (ap >= 1000) return (p / 1000).toFixed(ap >= 100000 ? 0 : 1) + 'k';
  if (ap >= 1) return p.toFixed(ap >= 100 ? 0 : 2);
  return p.toFixed(4);
}

class PriceAxisRenderer {
  constructor(opts = {}) { this._lines = opts.lines || 4; }
  draw(plot, _data) {
    const ctx = plot.ctx; if (!ctx) return;
    ctx.strokeStyle = plot.color('grid');
    ctx.fillStyle = plot.color('axisText');
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i <= this._lines; i++) {
      const p = plot.pMin + (plot.pMax - plot.pMin) * i / this._lines;
      const y = plot.Y(p);
      ctx.beginPath(); ctx.moveTo(plot.pad.l, y); ctx.lineTo(plot.w - plot.pad.r, y); ctx.stroke();
      ctx.fillText(fmtEixoPreco(p), plot.w - plot.pad.r + 4, y + 3);
    }
  }
}

/* Rótulos de tempo no eixo inferior. Recebe a série completa e um
 * formatador de rótulo (injeta-se a função timeLabel do período). */
class TimeAxisRenderer {
  constructor(opts = {}) { this._ticks = opts.ticks || 6; }
  draw(plot, data) {
    const ctx = plot.ctx; if (!ctx) return;
    const all = data.points; if (!all || !all.length) return;
    ctx.fillStyle = plot.color('axisText');
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.floor(all.length / this._ticks));
    for (let i = 0; i < all.length; i += step) {
      const x = plot.X(all[i].t);
      ctx.fillText(data.labelFor(all[i].t), x, plot.h - 6);
    }
  }
}

/* Linhas das exchanges: histórico contínuo + projeção pontilhada.
 * Recebe hist, fut e a paleta por chave. */
class SeriesRenderer {
  constructor(opts = {}) {
    this._keys = opts.keys || ['coinbase', 'kraken', 'binance', 'avg'];
  }
  draw(plot, data) {
    const ctx = plot.ctx; if (!ctx) return;
    const { hist, fut } = data;
    for (const k of this._keys) {
      const col = plot.color(k);
      // histórico: linha quebrada em lacunas (pontos sem dado real = null),
      // para não desenhar segmento reto atravessando períodos sem cobertura.
      ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = (k === 'avg') ? 2 : 1.3; ctx.setLineDash([]);
      let penDown = false;
      let lastValid = null;
      for (const pt of hist) {
        const v = pt[k];
        if (v == null || !Number.isFinite(+v)) { penDown = false; continue; }
        const x = plot.X(pt.t), y = plot.Y(v);
        if (penDown) ctx.lineTo(x, y); else { ctx.moveTo(x, y); penDown = true; }
        lastValid = pt;
      }
      ctx.stroke();
      // projeção pontilhada, ancorada no ÚLTIMO ponto real válido do histórico.
      if (fut && fut.length && lastValid) {
        ctx.beginPath(); ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.85;
        ctx.moveTo(plot.X(lastValid.t), plot.Y(lastValid[k]));
        fut.forEach(pt => ctx.lineTo(plot.X(pt.t), plot.Y(pt[k])));
        ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
      }
    }
  }
}

/* Linha de alvo horizontal + rótulo. */
class TargetLineRenderer {
  draw(plot, data) {
    const ctx = plot.ctx; if (!ctx || data.target == null) return;
    const y = plot.Y(data.target);
    ctx.strokeStyle = plot.color('target'); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(plot.pad.l, y); ctx.lineTo(plot.w - plot.pad.r, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = plot.color('target'); ctx.textAlign = 'left'; ctx.font = '10px monospace';
    ctx.fillText((window.I18N ? I18N.t('chart_alvo') : 'ALVO') + ' ' + data.fmtBRL(data.target), plot.pad.l + 4, y - 4);
  }
}

/* Divisor vertical "AGORA" + rótulos das duas áreas. */
class NowDividerRenderer {
  draw(plot, data) {
    const ctx = plot.ctx; if (!ctx) return;
    const nowX = plot.X(data.nowT);
    ctx.strokeStyle = plot.color('now'); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(nowX, plot.pad.t); ctx.lineTo(nowX, plot.h - plot.pad.b); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = plot.color('nowText'); ctx.textAlign = 'center'; ctx.font = 'bold 10px monospace';
    ctx.fillText(window.I18N ? I18N.t('chart_agora') : 'AGORA', nowX, plot.pad.t + 10);
    ctx.fillStyle = plot.color('axisText'); ctx.font = '9px monospace';
    ctx.textAlign = 'left'; ctx.fillText(window.I18N ? I18N.t('chart_historico') : 'HISTÓRICO CONFIRMADO', plot.pad.l + 4, plot.pad.t + 10);
    ctx.textAlign = 'right'; ctx.fillText(window.I18N ? I18N.t('chart_projetado') : 'CENÁRIO PROJETADO', plot.w - plot.pad.r - 4, plot.pad.t + 10);
  }
}

/* Cursor em cruz (linhas guia) na posição do mouse. */
class CursorRenderer {
  draw(plot, data) {
    const ctx = plot.ctx; if (!ctx || !data.mouse || !data.mouse.inside) return;
    const { x, y } = data.mouse;
    ctx.strokeStyle = 'rgba(125,138,163,0.4)'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, plot.pad.t); ctx.lineTo(x, plot.h - plot.pad.b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(plot.pad.l, y); ctx.lineTo(plot.w - plot.pad.r, y); ctx.stroke();
    ctx.setLineDash([]);
  }
}

/* RASTRO da projeção vencida: o que a forecast previu para o trecho que
 * já virou passado, desenhado bem fino e pontilhado por cima do real.
 * Permite ver a olho nu o quanto a previsão acertou ou desviou. */
class TrailRenderer {
  draw(plot, data) {
    const ctx = plot.ctx; if (!ctx) return;
    const trail = data.trail;
    if (!trail || trail.length < 2) return;
    ctx.save();
    ctx.strokeStyle = plot.color('trail') || 'rgba(232,237,247,0.45)';
    ctx.lineWidth = 0.7;                 // bem fina, para não competir com o real
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    let pen = false;
    for (const p of trail) {
      const v = p.avg;
      if (v == null || !Number.isFinite(+v) || !plot.inViewT(p.t)) { pen = false; continue; }
      const x = plot.X(p.t), y = plot.Y(v);
      if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

/* Marcadores de lotes (compras) — bolinhas com rótulo. Só desenha
 * os que estão na janela de tempo visível. */
class LotMarkerRenderer {
  draw(plot, data) {
    const ctx = plot.ctx; if (!ctx) return;
    for (const l of (data.lots || [])) {
      if (l.hidden) continue;                       // ocultada pelo usuário (olhinho)
      if (!plot.inViewT(l.time)) continue;
      const x = plot.X(l.time), y = plot.Y(l.price);
      let color = plot.color('binance'), suffix = '';
      if (l.realized > 1e-6) { color = '#22c55e'; suffix = ' • L'; }
      else if (l.realized < -1e-6) { color = '#ef4444'; suffix = ' • P'; }
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
      ctx.fillStyle = color; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
      ctx.fillText(l.id + suffix, x, y - 8);
    }
  }
}

/* Marcadores de vendas — X com rótulo, por status. */
class SellMarkerRenderer {
  draw(plot, data) {
    const ctx = plot.ctx; if (!ctx) return;
    for (const v of (data.sells || [])) {
      if (v.hidden) continue;                       // ocultada pelo usuário (olhinho)
      const t = v.status === 'executed' ? v.execTime : v.markTime;
      const p = v.status === 'executed' ? v.execPrice : v.markPrice;
      if (t == null || !plot.inViewT(t)) continue;
      const x = plot.X(t), y = plot.Y(p);
      let color = plot.color('binance'), label = v.id;
      if (v.status === 'executed') {
        const profit = v._profit != null ? v._profit >= 0 : true;
        color = profit ? '#22c55e' : '#ef4444';
        label = (profit ? 'L' : 'P') + v.seq;
      } else if (v.status === 'pending') { color = plot.color('binance'); label = 'V' + v.seq; }
      else continue;
      ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath();
      ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
      ctx.fillStyle = color; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
      ctx.fillText(label, x, y - 9);
    }
  }
}


/* Faixa de spread entre exchanges: região achurada que cobre o intervalo
 * entre o menor e o maior preço real das exchanges no momento atual.
 * Sinaliza ao usuário a "janela de liquidez" — se comprar/vender dentro
 * desta faixa, a operação está dentro do range onde o mercado realmente
 * está negociando agora. Desenhada antes das séries para ficar por baixo. */
class SpreadBandRenderer {
  draw(plot, data) {
    const ctx = plot.ctx; if (!ctx) return;
    const lo = data.spreadLow, hi = data.spreadHigh;
    if (lo == null || hi == null || hi <= lo) return;

    const yHi = plot.Y(hi);   // y menor (preço alto = pixel alto)
    const yLo = plot.Y(lo);   // y maior
    const r   = plot.plotRect;
    const bh  = yLo - yHi;   // altura da faixa em px
    if (bh < 1) return;

    ctx.save();

    /* ── preenchimento semitransparente ── */
    ctx.fillStyle = 'rgba(34,211,238,0.06)';   // ciano suave
    ctx.fillRect(r.x, yHi, r.w, bh);

    /* ── hachura diagonal (clip para não vazar) ── */
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, yHi, r.w, bh);
    ctx.clip();
    ctx.strokeStyle = 'rgba(34,211,238,0.13)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([]);
    const step = 12;
    for (let x = r.x - bh; x < r.x + r.w + bh; x += step) {
      ctx.beginPath();
      ctx.moveTo(x,      yHi);
      ctx.lineTo(x + bh, yLo);
      ctx.stroke();
    }
    ctx.restore();

    /* ── bordas tracejadas ── */
    ctx.strokeStyle = 'rgba(34,211,238,0.40)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([5, 4]);

    ctx.beginPath();
    ctx.moveTo(r.x, yHi); ctx.lineTo(r.x + r.w, yHi);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(r.x, yLo); ctx.lineTo(r.x + r.w, yLo);
    ctx.stroke();

    ctx.setLineDash([]);

    /* ── rótulo no canto direito ── */
    ctx.font      = '9px monospace';
    ctx.fillStyle = 'rgba(34,211,238,0.60)';
    ctx.textAlign = 'right';
    const lbl = window.I18N ? I18N.t('spread_zona') : 'zona de negociação';
    ctx.fillText(lbl, r.x + r.w - 4, yHi - 3);

    ctx.restore();
  }
}

const Renderers = {
  ProjectionBgRenderer, PriceAxisRenderer, TimeAxisRenderer, SeriesRenderer,
  TargetLineRenderer, NowDividerRenderer, CursorRenderer, LotMarkerRenderer, SellMarkerRenderer,
  TrailRenderer, SpreadBandRenderer,
};

if (typeof module !== 'undefined' && module.exports) module.exports = Renderers;
if (typeof window !== 'undefined') Object.assign(window, Renderers);
