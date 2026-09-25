/*
 * Motor de generación de horarios híbridos.
 *
 * Cada asignación semanal de una persona se representa como una máscara de 5 bits
 * (bit d = 1 → remoto el día d, con d = 0 Lunes … 4 Viernes).
 *
 * Funciona en el navegador (window.Scheduler) y en Node (module.exports) para tests.
 */
(function (root) {
  'use strict';

  const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
  const SHORT = ['L', 'M', 'X', 'J', 'V'];
  const RULE = {
    NONE: 'none',
    REMOTE_REQ: 'remote_req',
    REMOTE_PREF: 'remote_pref',
    OFFICE_REQ: 'office_req',
  };

  // Pesos de la función de coste. Un día sin cobertura domina cualquier otra consideración.
  const W = {
    DEFICIT: 1000, // por cada persona que falte para cubrir el mínimo presencial de un día
    PREF: 10,      // por cada día remoto preferido que no se concede
    BALANCE: 2,    // varianza de ocupación de la oficina entre días
    HD_BASE: 6,    // estar presencial un día de alta demanda (todos lo quieren remoto)
    HD_DEBT: 25,   // por cada turno de retraso respecto a quien más veces lo ha tenido
  };

  const NODE_LIMIT = 250000;

  const popcount = (m) => {
    let c = 0;
    while (m) { c += m & 1; m >>= 1; }
    return c;
  };
  const isRemote = (mask, d) => ((mask >> d) & 1) === 1;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Normaliza las reglas de una persona y enumera sus combinaciones válidas de días remotos. */
  function analyzePerson(person) {
    const rules = person.rules || {};
    let req = 0, forb = 0, pref = 0;
    for (let d = 0; d < 5; d++) {
      const r = rules[d];
      if (r === RULE.REMOTE_REQ) req |= 1 << d;
      else if (r === RULE.OFFICE_REQ) forb |= 1 << d;
      else if (r === RULE.REMOTE_PREF) pref |= 1 << d;
    }

    const warnings = [];
    const allowed = clamp(Math.round(Number(person.remoteDays ?? 2)) || 0, 0, 5);
    let k = allowed;
    const nReq = popcount(req);
    const nForb = popcount(forb);
    if (nReq > k) {
      warnings.push(`${person.name}: ${nReq} días remotos obligatorios superan los ${allowed} permitidos; se asignan ${nReq}.`);
      k = nReq;
    }
    if (k > 5 - nForb) {
      warnings.push(`${person.name}: ${nForb} días presenciales obligatorios solo dejan ${5 - nForb} días remotos posibles.`);
      k = 5 - nForb;
    }

    const options = [];
    for (let m = 0; m < 32; m++) {
      if (popcount(m) === k && (m & req) === req && (m & forb) === 0) options.push(m);
    }
    return { k, allowed, req, forb, pref, options, warnings };
  }

  const prefCost = (info, mask) => popcount(info.pref & ~mask) * W.PREF;

  function officeCounts(team, masks) {
    const counts = [0, 0, 0, 0, 0];
    for (const p of team) {
      const m = masks[p.id] ?? 0;
      for (let d = 0; d < 5; d++) if (!isRemote(m, d)) counts[d]++;
    }
    return counts;
  }

  /**
   * Busca la semana de menor coste mediante ramificación y poda.
   * opts.extraCost(i, mask) añade un coste por persona (usado por la rotación).
   */
  function solveWeek(team, minOffice, opts = {}) {
    const n = team.length;
    const infos = team.map(analyzePerson);
    const warnings = infos.flatMap((i) => i.warnings);
    if (n === 0) return { masks: {}, coverage: [0, 0, 0, 0, 0], warnings, optimal: true, cost: 0 };

    const extra = opts.extraCost || (() => 0);
    const cand = infos.map((info, i) =>
      info.options
        .map((mask) => ({ mask, cost: prefCost(info, mask) + extra(i, mask) }))
        .sort((a, b) => a.cost - b.cost || a.mask - b.mask)
    );
    // Personas con menos alternativas primero: poda antes.
    const order = [...Array(n).keys()].sort((a, b) => cand[a].length - cand[b].length || a - b);

    // suffix[j][d] = cuántas de las personas order[j..] podrían estar presenciales el día d.
    const suffix = Array.from({ length: n + 1 }, () => [0, 0, 0, 0, 0]);
    for (let j = n - 1; j >= 0; j--) {
      const opts_ = cand[order[j]];
      for (let d = 0; d < 5; d++) {
        suffix[j][d] = suffix[j + 1][d] + (opts_.some((c) => !isRemote(c.mask, d)) ? 1 : 0);
      }
    }

    const office = [0, 0, 0, 0, 0];
    const chosen = new Array(n);
    let best = null;
    let bestCost = Infinity;
    let nodes = 0;
    const limit = opts.nodeLimit || NODE_LIMIT;

    function dfs(j, partial) {
      if (++nodes > limit) return;
      if (j === n) {
        let def = 0, bal = 0;
        const mean = office.reduce((a, b) => a + b, 0) / 5;
        for (let d = 0; d < 5; d++) {
          def += Math.max(0, minOffice - office[d]);
          bal += (office[d] - mean) ** 2;
        }
        const total = partial + def * W.DEFICIT + bal * W.BALANCE;
        if (total < bestCost - 1e-9) {
          bestCost = total;
          best = chosen.slice();
        }
        return;
      }
      let def = 0;
      for (let d = 0; d < 5; d++) def += Math.max(0, minOffice - office[d] - suffix[j][d]);
      if (partial + def * W.DEFICIT >= bestCost) return;

      const p = order[j];
      for (const c of cand[p]) {
        for (let d = 0; d < 5; d++) if (!isRemote(c.mask, d)) office[d]++;
        chosen[p] = c.mask;
        dfs(j + 1, partial + c.cost);
        for (let d = 0; d < 5; d++) if (!isRemote(c.mask, d)) office[d]--;
        if (nodes > limit) break;
      }
    }
    dfs(0, 0);

    const masks = {};
    team.forEach((p, i) => { masks[p.id] = best[i]; });
    return {
      masks,
      coverage: officeCounts(team, masks),
      warnings,
      optimal: nodes <= limit,
      cost: bestCost,
    };
  }

  /** Esquema fijo: una única semana que se repite. */
  function generateFixed(team, minOffice) {
    const week = solveWeek(team, minOffice);
    return { mode: 'fixed', weeks: [week.masks], warnings: week.warnings, optimal: week.optimal };
  }

  /**
   * Esquema rotatorio de N semanas: reparte equitativamente los días de alta demanda
   * (p. ej. el viernes remoto). Cada semana penaliza estar presencial ese día en función
   * de cuántos turnos lleva la persona por detrás del máximo, con desempate por turno cíclico.
   */
  function generateRotation(team, minOffice, hdDays, weeks) {
    const n = team.length;
    const N = Math.max(1, Math.round(weeks) || n || 1);
    const counts = team.map(() => [0, 0, 0, 0, 0]);
    const out = [];
    let warnings = [];
    let optimal = true;

    for (let w = 0; w < N; w++) {
      const maxBy = [0, 1, 2, 3, 4].map((d) => Math.max(0, ...counts.map((c) => c[d])));
      const extraCost = (i, mask) => {
        let c = 0;
        for (const d of hdDays) {
          if (isRemote(mask, d)) continue;
          const turn = (i - w % n + n) % n; // 0 → le toca esta semana
          c += W.HD_BASE + W.HD_DEBT * (maxBy[d] - counts[i][d]) + (n - turn) / n;
        }
        return c;
      };
      const week = solveWeek(team, minOffice, { extraCost });
      if (w === 0) warnings = week.warnings;
      optimal = optimal && week.optimal;
      team.forEach((p, i) => {
        for (let d = 0; d < 5; d++) if (isRemote(week.masks[p.id], d)) counts[i][d]++;
      });
      out.push(week.masks);
    }
    return { mode: 'rotation', weeks: out, warnings, optimal };
  }

  /** Evalúa una semana (posiblemente editada a mano) contra las reglas. */
  function evaluateWeek(team, masks, minOffice) {
    const coverage = officeCounts(team, masks);
    const alerts = coverage.map((c) => c < minOffice);
    const people = {};
    for (const p of team) {
      const info = analyzePerson(p);
      const m = masks[p.id] ?? 0;
      const cells = [0, 1, 2, 3, 4].map((d) => {
        if ((info.req >> d) & 1 && !isRemote(m, d)) return 'Debería ser remoto (obligatorio)';
        if ((info.forb >> d) & 1 && isRemote(m, d)) return 'Debería ser presencial (obligatorio)';
        return null;
      });
      const remote = popcount(m);
      people[p.id] = {
        cells,
        remote,
        overLimit: remote > info.k,
        expected: info.k,
      };
    }
    return { coverage, alerts, people };
  }

  const api = {
    DAYS, SHORT, RULE, W,
    popcount, isRemote,
    analyzePerson, solveWeek, generateFixed, generateRotation, evaluateWeek, officeCounts,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scheduler = api;
})(typeof window !== 'undefined' ? window : globalThis);
