(function () {
  'use strict';

  const S = window.Scheduler;
  const { DAYS, SHORT, RULE } = S;
  const STORAGE_KEY = 'hybrid-schedule-v1';

  const RULE_META = {
    [RULE.NONE]: { label: 'Libre', chip: '', select: 'border-slate-300' },
    [RULE.REMOTE_REQ]: { label: 'Remoto obligatorio', chip: 'bg-sky-600 text-white', select: 'border-sky-500 bg-sky-50' },
    [RULE.REMOTE_PREF]: { label: 'Remoto preferido', chip: 'bg-sky-100 text-sky-800', select: 'border-sky-300 bg-sky-50/50' },
    [RULE.OFFICE_REQ]: { label: 'Presencial obligatorio', chip: 'bg-slate-700 text-white', select: 'border-slate-600 bg-slate-100' },
  };

  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => document.querySelector(sel);

  function defaultState() {
    return {
      team: ['Jhon', 'Carlos', 'Chris'].map((name) => ({ id: uid(), name, remoteDays: 2, rules: {} })),
      config: { minOffice: 1, mode: 'fixed', hdDays: [4], weeksAuto: true, weeks: 3 },
      schedule: null,
      activeWeek: 0,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.team) && s.config) return { ...defaultState(), ...s };
      }
    } catch (_) { /* almacenamiento no disponible */ }
    return defaultState();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* ignorar */ }
  }

  let state = load();

  const cycleWeeks = () =>
    state.config.weeksAuto ? Math.max(1, state.team.length) : Math.max(1, Math.min(52, state.config.weeks | 0));

  function generate() {
    const { team, config } = state;
    state.schedule = config.mode === 'rotation'
      ? S.generateRotation(team, config.minOffice, config.hdDays, cycleWeeks())
      : S.generateFixed(team, config.minOffice);
    state.activeWeek = 0;
  }

  function commit({ regenerate = true } = {}) {
    if (regenerate || !state.schedule) generate();
    save();
    render();
  }

  // ---------- Render ----------

  function render() {
    renderTeam();
    renderConfig();
    renderStats();
    renderMatrix();
    renderSchedule();
    renderEquity();
    renderWarnings();
  }

  function renderTeam() {
    const list = $('#team-list');
    if (!state.team.length) {
      list.innerHTML = '<li class="px-4 py-6 text-sm text-slate-500 text-center">Sin integrantes. Añade el primero.</li>';
      return;
    }
    list.innerHTML = state.team.map((p) => {
      const chips = [0, 1, 2, 3, 4]
        .filter((d) => p.rules[d] && p.rules[d] !== RULE.NONE)
        .map((d) => `<span class="px-1.5 py-0.5 rounded text-[11px] ${RULE_META[p.rules[d]].chip}" title="${DAYS[d]}: ${RULE_META[p.rules[d]].label}">${SHORT[d]} · ${RULE_META[p.rules[d]].label.split(' ')[0]}${p.rules[d] === RULE.REMOTE_PREF ? ' pref.' : ''}</span>`)
        .join('');
      return `
        <li class="px-4 py-3 flex items-start gap-3">
          <div class="w-8 h-8 shrink-0 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center text-sm font-semibold">${esc(p.name.charAt(0).toUpperCase())}</div>
          <div class="min-w-0 flex-1">
            <div class="font-medium truncate">${esc(p.name)}</div>
            <div class="text-xs text-slate-500">${p.remoteDays} día(s) remoto(s) / semana</div>
            ${chips ? `<div class="mt-1 flex flex-wrap gap-1">${chips}</div>` : ''}
          </div>
          <div class="flex gap-1">
            <button data-edit="${p.id}" class="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-100">Editar</button>
            <button data-del="${p.id}" class="px-2 py-1 text-xs rounded border border-rose-200 text-rose-600 hover:bg-rose-50">Eliminar</button>
          </div>
        </li>`;
    }).join('');
  }

  function renderConfig() {
    const c = state.config;
    $('#min-office').value = c.minOffice;
    document.querySelectorAll('#mode-toggle button').forEach((b) => {
      const on = b.dataset.mode === c.mode;
      b.className = `py-1.5 ${on ? 'bg-indigo-600 text-white font-medium' : 'bg-white hover:bg-slate-50'}`;
    });
    $('#rotation-opts').classList.toggle('hidden', c.mode !== 'rotation');
    $('#hd-days').innerHTML = SHORT.map((s, d) => {
      const on = c.hdDays.includes(d);
      return `<button data-hd="${d}" title="${DAYS[d]}" class="w-9 h-9 rounded-lg text-sm font-medium border ${on ? 'bg-amber-400 border-amber-400 text-amber-950' : 'bg-white border-slate-300 hover:bg-slate-50'}">${s}</button>`;
    }).join('');
    $('#weeks-auto').checked = c.weeksAuto;
    $('#weeks').disabled = c.weeksAuto;
    $('#weeks').value = cycleWeeks();
  }

  function weekEvals() {
    const sch = state.schedule;
    if (!sch) return [];
    return sch.weeks.map((w) => S.evaluateWeek(state.team, w, state.config.minOffice));
  }

  function renderStats() {
    const evals = weekEvals();
    const alertDays = evals.reduce((a, e) => a + e.alerts.filter(Boolean).length, 0);
    const ruleBreaks = evals.reduce((a, e) =>
      a + Object.values(e.people).reduce((b, p) => b + p.cells.filter(Boolean).length + (p.overLimit ? 1 : 0), 0), 0);
    const totalDays = evals.length * 5 || 1;
    const avgOffice = evals.length
      ? (evals.reduce((a, e) => a + e.coverage.reduce((x, y) => x + y, 0), 0) / totalDays).toFixed(1)
      : '0';
    const ok = alertDays === 0 && ruleBreaks === 0;
    const card = (label, value, tone = 'slate', sub = '') => `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div class="text-xs text-slate-500">${label}</div>
        <div class="mt-1 text-2xl font-semibold text-${tone}-700">${value}</div>
        ${sub ? `<div class="text-xs text-slate-500 mt-0.5">${sub}</div>` : ''}
      </div>`;
    $('#stats').innerHTML = [
      card('Integrantes', state.team.length),
      card('Media en oficina / día', avgOffice, 'slate', `mínimo ${state.config.minOffice}`),
      card('Días en alerta', alertDays, alertDays ? 'rose' : 'emerald', state.config.mode === 'rotation' ? `en ${evals.length} semanas` : 'en la semana'),
      card('Estado', ok ? 'OK' : 'Revisar', ok ? 'emerald' : 'rose', ok ? 'Todas las reglas se cumplen' : `${ruleBreaks} incumplimiento(s) de reglas`),
    ].join('');
  }

  function remoteLetters(mask) {
    const hd = state.config.hdDays;
    return SHORT.map((s, d) => S.isRemote(mask, d)
      ? `<span class="${hd.includes(d) ? 'text-amber-600 font-bold' : ''}">${s}</span>`
      : '').filter(Boolean).join(' ') || '<span class="text-slate-400">—</span>';
  }

  function renderMatrix() {
    const isRot = state.config.mode === 'rotation' && state.schedule && state.team.length;
    $('#rotation-matrix-card').classList.toggle('hidden', !isRot);
    if (!isRot) return;
    const weeks = state.schedule.weeks;
    const evals = weekEvals();
    const head = weeks.map((_, w) => {
      const alert = evals[w].alerts.some(Boolean);
      const active = w === state.activeWeek;
      return `<th class="px-2 py-2 font-medium">
        <button data-week="${w}" class="w-full px-2 py-1 rounded-md text-xs ${active ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100'}">
          S${w + 1} <span class="inline-block w-2 h-2 rounded-full align-middle ${alert ? 'bg-rose-500' : 'bg-emerald-500'}"></span>
        </button></th>`;
    }).join('');
    const rows = state.team.map((p) => `
      <tr class="border-t border-slate-100">
        <td class="px-3 py-2 font-medium whitespace-nowrap sticky left-0 bg-white">${esc(p.name)}</td>
        ${weeks.map((w, i) => `<td class="px-2 py-2 text-center text-xs whitespace-nowrap ${i === state.activeWeek ? 'bg-indigo-50' : ''}">${remoteLetters(w[p.id] ?? 0)}</td>`).join('')}
      </tr>`).join('');
    $('#rotation-matrix').innerHTML = `
      <table class="min-w-full text-sm">
        <thead><tr class="text-slate-500"><th class="px-3 py-2 text-left font-medium sticky left-0 bg-white">Integrante</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderSchedule() {
    const sch = state.schedule;
    const isRot = state.config.mode === 'rotation';
    const w = Math.min(state.activeWeek, (sch?.weeks.length || 1) - 1);
    $('#schedule-title').textContent = isRot ? `Detalle · Semana ${w + 1} de ${sch?.weeks.length || 0}` : 'Horario semanal fijo';
    $('#week-tabs').innerHTML = isRot && sch
      ? sch.weeks.map((_, i) => `<button data-week="${i}" class="px-2.5 py-1 rounded-md text-xs border ${i === w ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 hover:bg-slate-50'}">S${i + 1}</button>`).join('')
      : '';

    if (!sch || !state.team.length) {
      $('#schedule').innerHTML = '<p class="p-6 text-sm text-slate-500 text-center">Añade integrantes para generar el horario.</p>';
      return;
    }
    const masks = sch.weeks[w];
    const ev = S.evaluateWeek(state.team, masks, state.config.minOffice);
    const hd = state.config.hdDays;

    const head = DAYS.map((d, i) => `<th class="px-2 py-2 font-medium text-center ${isRot && hd.includes(i) ? 'text-amber-600' : ''}">${d}</th>`).join('');
    const rows = state.team.map((p) => {
      const m = masks[p.id] ?? 0;
      const pe = ev.people[p.id];
      const cells = DAYS.map((_, d) => {
        const remote = S.isRemote(m, d);
        const issue = pe.cells[d];
        const cls = remote ? 'bg-sky-100 text-sky-800 border-sky-200' : 'bg-white text-slate-700 border-slate-300';
        return `<td class="px-1.5 py-1.5">
          <button data-cell="${w}|${p.id}|${d}" title="${issue ? esc(issue) : 'Clic para alternar'}"
            class="cell-btn w-full min-w-[84px] px-2 py-2 rounded-lg border text-xs font-medium ${cls} ${issue ? 'ring-2 ring-amber-400' : ''}">
            ${remote ? '🏠 Remoto' : '🏢 Oficina'}
          </button></td>`;
      }).join('');
      const countCls = pe.remote === pe.expected ? 'text-slate-500' : 'text-amber-600 font-semibold';
      return `<tr class="border-t border-slate-100">
        <td class="px-3 py-2 font-medium whitespace-nowrap sticky left-0 bg-white">${esc(p.name)}</td>
        ${cells}
        <td class="px-3 py-2 text-center text-xs ${countCls}" title="Días remotos asignados / permitidos">${pe.remote}/${pe.expected}</td>
      </tr>`;
    }).join('');

    const coverage = ev.coverage.map((c, d) => {
      const min = state.config.minOffice;
      const ok = c >= min;
      const text = ok ? `✓ ${c} en oficina` : c === 0 ? '⚠ Oficina vacía' : `⚠ ${c}/${min} mínimo`;
      return `<td class="px-1.5 py-2"><div class="rounded-lg px-2 py-2 text-center text-xs font-semibold ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">${text}</div></td>`;
    }).join('');

    $('#schedule').innerHTML = `
      <table class="min-w-full text-sm">
        <thead><tr class="text-slate-500"><th class="px-3 py-2 text-left font-medium sticky left-0 bg-white">Integrante</th>${head}<th class="px-3 py-2 font-medium">Remotos</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="border-t-2 border-slate-200"><td class="px-3 py-2 text-xs font-semibold text-slate-600 sticky left-0 bg-white">Cobertura</td>${coverage}<td></td></tr></tfoot>
      </table>`;
  }

  function renderEquity() {
    const sch = state.schedule;
    const show = state.config.mode === 'rotation' && sch && state.team.length && state.config.hdDays.length;
    $('#equity-card').classList.toggle('hidden', !show);
    if (!show) return;
    const hd = [...state.config.hdDays].sort();
    const N = sch.weeks.length;
    const head = hd.map((d) => `<th class="px-3 py-2 font-medium text-center text-amber-600">${DAYS[d]} remoto</th>`).join('');
    const rows = state.team.map((p) => {
      const cols = hd.map((d) => {
        const n = sch.weeks.filter((w) => S.isRemote(w[p.id] ?? 0, d)).length;
        const pct = Math.round((n / N) * 100);
        return `<td class="px-3 py-2">
          <div class="flex items-center gap-2">
            <div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div class="h-full bg-amber-400" style="width:${pct}%"></div></div>
            <span class="text-xs tabular-nums w-10 text-right">${n}/${N}</span>
          </div></td>`;
      }).join('');
      const remote = sch.weeks.reduce((a, w) => a + S.popcount(w[p.id] ?? 0), 0);
      return `<tr class="border-t border-slate-100">
        <td class="px-3 py-2 font-medium whitespace-nowrap">${esc(p.name)}</td>${cols}
        <td class="px-3 py-2 text-center text-xs">${remote}</td>
        <td class="px-3 py-2 text-center text-xs">${N * 5 - remote}</td></tr>`;
    }).join('');
    $('#equity').innerHTML = `
      <table class="min-w-full text-sm">
        <thead><tr class="text-slate-500"><th class="px-3 py-2 text-left font-medium">Integrante</th>${head}<th class="px-3 py-2 font-medium">Días remotos</th><th class="px-3 py-2 font-medium">Días oficina</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderWarnings() {
    const box = $('#warnings');
    const msgs = [...(state.schedule?.warnings || [])];
    if (state.config.minOffice > state.team.length && state.team.length) {
      msgs.push(`El mínimo presencial (${state.config.minOffice}) supera el tamaño del equipo (${state.team.length}).`);
    }
    const capacity = state.team.reduce((a, p) => a + 5 - S.analyzePerson(p).k, 0);
    if (state.team.length && capacity < state.config.minOffice * 5) {
      msgs.push(`Con los días remotos actuales solo hay ${capacity} jornadas presenciales por semana; cubrir el mínimo requiere ${state.config.minOffice * 5}.`);
    }
    if (state.schedule && state.schedule.optimal === false) {
      msgs.push('Equipo grande: se muestra la mejor solución encontrada en el tiempo de búsqueda.');
    }
    box.classList.toggle('hidden', !msgs.length);
    box.innerHTML = `<h3 class="font-semibold mb-1">Avisos</h3><ul class="list-disc pl-5 space-y-1">${msgs.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`;
  }

  // ---------- Modal ----------

  let editingId = null;

  function openModal(person) {
    editingId = person?.id || null;
    $('#modal-title').textContent = person ? `Editar a ${person.name}` : 'Añadir integrante';
    $('#f-name').value = person?.name || '';
    $('#f-remote').value = person?.remoteDays ?? 2;
    $('#f-error').classList.add('hidden');
    const rules = person?.rules || {};
    $('#f-rules').innerHTML = DAYS.map((day, d) => {
      const r = rules[d] || RULE.NONE;
      return `<label class="block text-center">
        <span class="text-xs font-medium text-slate-600">${day}</span>
        <select data-rule="${d}" class="mt-1 w-full rounded-lg border-2 px-1 py-1.5 text-xs ${RULE_META[r].select}">
          ${Object.entries(RULE_META).map(([k, v]) => `<option value="${k}" ${k === r ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select></label>`;
    }).join('');
    $('#modal').classList.remove('hidden');
    $('#f-name').focus();
  }

  const closeModal = () => $('#modal').classList.add('hidden');

  function submitModal(e) {
    e.preventDefault();
    const name = $('#f-name').value.trim();
    const remoteDays = Math.max(0, Math.min(5, parseInt($('#f-remote').value, 10) || 0));
    const err = $('#f-error');
    if (!name) return;
    if (state.team.some((p) => p.id !== editingId && p.name.toLowerCase() === name.toLowerCase())) {
      err.textContent = 'Ya existe un integrante con ese nombre.';
      err.classList.remove('hidden');
      return;
    }
    const rules = {};
    document.querySelectorAll('#f-rules select').forEach((s) => {
      if (s.value !== RULE.NONE) rules[s.dataset.rule] = s.value;
    });
    const nReq = Object.values(rules).filter((r) => r === RULE.REMOTE_REQ).length;
    if (nReq > remoteDays) {
      err.textContent = `Hay ${nReq} días remotos obligatorios pero solo ${remoteDays} días remotos permitidos.`;
      err.classList.remove('hidden');
      return;
    }
    if (editingId) {
      Object.assign(state.team.find((p) => p.id === editingId), { name, remoteDays, rules });
    } else {
      state.team.push({ id: uid(), name, remoteDays, rules });
    }
    closeModal();
    commit();
  }

  // ---------- Export ----------

  function exportCsv() {
    const sch = state.schedule;
    if (!sch) return;
    const lines = [['Semana', 'Integrante', ...DAYS].join(',')];
    sch.weeks.forEach((w, i) => {
      state.team.forEach((p) => {
        const cells = DAYS.map((_, d) => (S.isRemote(w[p.id] ?? 0, d) ? 'Remoto' : 'Oficina'));
        lines.push([i + 1, `"${p.name.replace(/"/g, '""')}"`, ...cells].join(','));
      });
      const cov = S.officeCounts(state.team, w);
      lines.push([i + 1, 'En oficina', ...cov].join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `horario-hibrido-${state.config.mode === 'rotation' ? 'rotatorio' : 'fijo'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- Eventos ----------

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'btn-add') return openModal(null);
    if (t.id === 'btn-generate') return commit();
    if (t.id === 'btn-export') return exportCsv();
    if (t.id === 'btn-reset') {
      if (confirm('¿Restablecer el equipo y las reglas por defecto?')) { state = defaultState(); commit(); }
      return;
    }
    if (t.hasAttribute('data-close')) return closeModal();
    if (t.dataset.edit) return openModal(state.team.find((p) => p.id === t.dataset.edit));
    if (t.dataset.del) {
      const p = state.team.find((x) => x.id === t.dataset.del);
      if (p && confirm(`¿Eliminar a ${p.name} del equipo?`)) {
        state.team = state.team.filter((x) => x.id !== p.id);
        commit();
      }
      return;
    }
    if (t.dataset.mode) { state.config.mode = t.dataset.mode; return commit(); }
    if (t.dataset.hd !== undefined) {
      const d = +t.dataset.hd;
      const hd = state.config.hdDays;
      state.config.hdDays = hd.includes(d) ? hd.filter((x) => x !== d) : [...hd, d].sort();
      return commit();
    }
    if (t.dataset.week !== undefined) {
      state.activeWeek = +t.dataset.week;
      return commit({ regenerate: false });
    }
    if (t.dataset.cell) {
      const [w, id, d] = t.dataset.cell.split('|');
      state.schedule.weeks[+w][id] ^= 1 << +d;
      return commit({ regenerate: false });
    }
  });

  $('#min-office').addEventListener('change', (e) => {
    state.config.minOffice = Math.max(0, parseInt(e.target.value, 10) || 0);
    commit();
  });
  $('#weeks').addEventListener('change', (e) => {
    state.config.weeks = Math.max(1, Math.min(52, parseInt(e.target.value, 10) || 1));
    commit();
  });
  $('#weeks-auto').addEventListener('change', (e) => {
    state.config.weeksAuto = e.target.checked;
    if (!e.target.checked) state.config.weeks = Math.max(1, state.team.length);
    commit();
  });
  $('#person-form').addEventListener('submit', submitModal);
  $('#f-rules').addEventListener('change', (e) => {
    const s = e.target.closest('select');
    if (s) s.className = `mt-1 w-full rounded-lg border-2 px-1 py-1.5 text-xs ${RULE_META[s.value].select}`;
  });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  if (!state.schedule) generate();
  render();
})();
