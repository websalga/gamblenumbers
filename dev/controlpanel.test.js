'use strict';
const { EventBus } = require('./eventbus.js');
const { ControlPanel } = require('./controlpanel.js');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ FALHOU:', m); } }

/* ---------- mocks de DOM ---------- */
function mockEl(initial = '') {
  return {
    value: initial, textContent: '',
    _handlers: {},
    addEventListener(evt, cb) { (this._handlers[evt] = this._handlers[evt] || []).push(cb); },
    fire(evt) { (this._handlers[evt] || []).forEach(cb => cb({ target: this })); },
  };
}
function mockDoc(map) { return { getElementById: id => map[id] || null }; }

function run() {
  /* ===== EventBus ===== */
  {
    const bus = new EventBus();
    let a = 0, b = 0;
    const off = bus.on('x', d => { a += d; });
    bus.on('x', d => { b += d; });
    bus.emit('x', 5);
    ok(a === 5 && b === 5, 'emit chama todos os assinantes');
    ok(bus.count('x') === 2, 'count reflete nº de assinantes');
    off();
    bus.emit('x', 3);
    ok(a === 5 && b === 8, 'off cancela só o assinante certo');

    // erro em um assinante não derruba os outros
    let reached = false;
    bus.on('y', () => { throw new Error('boom'); });
    bus.on('y', () => { reached = true; });
    bus.emit('y', null);
    ok(reached, 'erro num assinante não impede os demais');

    bus.clear();
    ok(bus.count('x') === 0 && bus.count('y') === 0, 'clear remove tudo');
  }

  /* ===== ControlPanel ===== */
  {
    const bus = new EventBus();
    const els = {
      opValue: mockEl(), stop: mockEl(), ret: mockEl(), retVal: mockEl(),
    };
    const doc = mockDoc(els);
    const cp = new ControlPanel({ doc, bus, defaults: { opValue: 55000, stop: 0, ret: 5 } });

    // eventos capturados
    const got = {};
    bus.on('control:opValue', d => got.op = d.value);
    bus.on('control:stop', d => got.stop = d.value);
    bus.on('control:ret', d => got.ret = d.value);

    cp.mount();

    // valores iniciais escritos no DOM
    ok(/55\.000,00/.test(els.opValue.value), 'valor inicial formatado no input');
    ok(els.retVal.textContent === '5.0', 'retorno inicial exibido');

    // usuário digita novo valor de compra e dispara change
    els.opValue.value = 'R$ 80.000,00';
    els.opValue.fire('change');
    ok(got.op === 80000, 'change de opValue emite valor parseado (80000)');
    ok(/80\.000,00/.test(els.opValue.value), 'input é reformatado após change');

    // usuário mexe no slider de retorno (input)
    els.ret.value = '6.1';
    els.ret.fire('input');
    ok(Math.abs(got.ret - 6.1) < 1e-9, 'input de ret emite 6.1');
    ok(els.retVal.textContent === '6.1', 'retVal atualiza no input');
    ok(Math.abs(cp.ret - 6.1) < 1e-9, 'getter ret reflete o estado');

    // stop
    els.stop.value = 'R$ 1.500,00';
    els.stop.fire('change');
    ok(got.stop === 1500, 'change de stop emite 1500');

    // alimentação programática também emite
    let progRet = null;
    bus.on('control:ret', d => progRet = d.value);
    cp.setRet(9);
    ok(progRet === 9 && cp.ret === 9, 'setRet altera estado e emite evento');

    // snapshot devolve cópia do estado
    const snap = cp.snapshot(); snap.ret = -1;
    ok(cp.ret === 9, 'snapshot é cópia; mexer nele não altera o painel');
  }

  /* ===== validações de construtor ===== */
  {
    let t1 = false, t2 = false;
    try { new ControlPanel({ bus: new EventBus() }); } catch (_) { t1 = true; }
    try { new ControlPanel({ doc: mockDoc({}) }); } catch (_) { t2 = true; }
    ok(t1, 'ControlPanel sem doc lança');
    ok(t2, 'ControlPanel sem bus lança');
  }

  console.log(`\n${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
}

run();
