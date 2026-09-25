const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scheduler.js');

const person = (id, rules = {}, remoteDays = 2) => ({ id, name: id, remoteDays, rules });
const FRI = 4;

test('esquema fijo respeta días remotos y cobertura mínima', () => {
  const team = [person('Jhon'), person('Carlos'), person('Chris')];
  const { weeks } = S.generateFixed(team, 1);
  const masks = weeks[0];
  for (const p of team) assert.equal(S.popcount(masks[p.id]), 2);
  const ev = S.evaluateWeek(team, masks, 1);
  assert.ok(ev.coverage.every((c) => c >= 1), `cobertura: ${ev.coverage}`);
});

test('reglas obligatorias se cumplen y preferencias se priorizan', () => {
  const team = [
    person('A', { 0: S.RULE.REMOTE_REQ, 4: S.RULE.OFFICE_REQ }),
    person('B', { 2: S.RULE.REMOTE_PREF }),
    person('C', { 4: S.RULE.REMOTE_PREF }),
  ];
  const masks = S.generateFixed(team, 1).weeks[0];
  assert.ok(S.isRemote(masks.A, 0));
  assert.ok(!S.isRemote(masks.A, 4));
  assert.ok(S.isRemote(masks.B, 2));
  assert.ok(S.isRemote(masks.C, 4));
  const ev = S.evaluateWeek(team, masks, 1);
  assert.ok(Object.values(ev.people).every((p) => p.cells.every((c) => c === null)));
});

test('cobertura imposible se reporta como alerta', () => {
  const team = [person('A', {}, 5), person('B', {}, 5)];
  const masks = S.generateFixed(team, 1).weeks[0];
  const ev = S.evaluateWeek(team, masks, 1);
  assert.ok(ev.alerts.every(Boolean));
});

test('conflicto de reglas genera aviso', () => {
  const rules = { 0: S.RULE.REMOTE_REQ, 1: S.RULE.REMOTE_REQ, 2: S.RULE.REMOTE_REQ };
  const res = S.generateFixed([person('A', rules, 2)], 0);
  assert.equal(res.warnings.length, 1);
  assert.equal(S.popcount(res.weeks[0].A), 3);
});

test('rotación reparte los viernes remotos de forma equitativa', () => {
  for (const n of [3, 4, 5, 6]) {
    const team = Array.from({ length: n }, (_, i) => person(`P${i}`));
    const { weeks } = S.generateRotation(team, 1, [FRI], n);
    assert.equal(weeks.length, n);
    const fridays = team.map((p) => weeks.filter((w) => S.isRemote(w[p.id], FRI)).length);
    assert.ok(Math.max(...fridays) - Math.min(...fridays) <= 1, `n=${n}: ${fridays}`);
    for (const w of weeks) {
      assert.ok(S.evaluateWeek(team, w, 1).coverage.every((c) => c >= 1));
    }
  }
});

test('equipo de 10 personas resuelve en tiempo razonable', () => {
  const team = Array.from({ length: 10 }, (_, i) => person(`P${i}`));
  const t = Date.now();
  S.generateRotation(team, 3, [FRI], 10);
  assert.ok(Date.now() - t < 5000);
});
