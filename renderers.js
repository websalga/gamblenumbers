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
      ctx.fillText((p / 1000).toFixed(0) + 'k', plot.w - plot.pad.r + 4, y + 3);
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
      // histórico contínuo
      ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = (k === 'avg') ? 2 : 1.3; ctx.setLineDash([]);
      hist.forEach((pt, i) => { const x = plot.X(pt.t), y = plot.Y(pt[k]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      // projeção pontilhada, começando no último ponto real
      if (fut && fut.length && hist.length) {
        ctx.beginPath(); ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.85;
        const lastH = hist[hist.length - 1];
        ctx.moveTo(plot.X(lastH.t), plot.Y(lastH[k]));
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
    ctx.fillText('ALVO ' + data.fmtBRL(data.target), plot.pad.l + 4, y - 4);
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
    ctx.fillText('AGORA', nowX, plot.pad.t + 10);
    ctx.fillStyle = plot.color('axisText'); ctx.font = '9px monospace';
    ctx.textAlign = 'left'; ctx.fillText('HISTÓRICO CONFIRMADO', plot.pad.l + 4, plot.pad.t + 10);
    ctx.textAlign = 'right'; ctx.fillText('CENÁRIO PROJETADO', plot.w - plot.pad.r - 4, plot.pad.t + 10);
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

/* Marcadores de lotes (compras) — bolinhas com rótulo. Só desenha
 * os que estão na janela de tempo visível. */
class LotMarkerRenderer {
  draw(plot, data) {
    const ctx = plot.ctx; if (!ctx) return;
    for (const l of (data.lots || [])) {
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

const Renderers = {
  ProjectionBgRenderer, PriceAxisRenderer, TimeAxisRenderer, SeriesRenderer,
  TargetLineRenderer, NowDividerRenderer, CursorRenderer, LotMarkerRenderer, SellMarkerRenderer,
};

if (typeof module !== 'undefined' && module.exports) module.exports = Renderers;
if (typeof window !== 'undefined') Object.assign(window, Renderers);
