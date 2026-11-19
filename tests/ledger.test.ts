import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as ledger from '../src/lib/ledger.ts';

test('parses decimal amounts as integer cents', () => {
  for (const [input, cents] of [
    ['0,01', 1], [' 2,5 ', 250], ['01.23', 123], ['42', 4200],
    ['999999,99', 99_999_999],
  ] as const) {
    assert.equal(ledger.parseAmount(input), cents, input);
  }
});

test('rejects amounts outside the supported decimal syntax and range', () => {
  for (const input of [
    '', '0', '0.00', '-2', '+2', '1e2', '1.005', '1,', '1,2.3',
    '1 000,50', '1\n', '1000000', '9999999999999999999999999999',
  ]) {
    assert.equal(ledger.parseAmount(input), null, JSON.stringify(input));
  }
});

test('splits cents in member order, even when a share is zero', () => {
  assert.deepEqual(ledger.splitEvenly(100, ['bob', 'alice', 'cam']), { bob: 34, alice: 33, cam: 33 });
  assert.deepEqual(ledger.splitEvenly(1, ['cam', 'alice']), { cam: 1, alice: 0 });
  assert.deepEqual(ledger.splitEvenly(25, ['constructor']), { constructor: 25 });
});

test('rejects invalid amounts and empty, duplicate, or invalid split IDs', () => {
  for (const amount of [0, -1, 1.5, 100_000_000, NaN, Infinity]) {
    assert.throws(() => ledger.splitEvenly(amount, ['alice']), ledger.ValidationError);
  }
  for (const ids of [[], ['alice', 'alice'], ['alice', 'bad/id']]) {
    assert.throws(() => ledger.splitEvenly(10, ids), ledger.ValidationError);
  }
});

test('accepts bounded safe IDs including UUIDs and demo IDs', () => {
  for (const id of ['demo-alice_1', '331ec4fd-4d56-4d50-92a0-47dd5b5dee2d', 'a'.repeat(64)]) {
    assert.equal(ledger.isValidId(id), true, id);
  }
  for (const id of [undefined, null, 1, '', 'a'.repeat(65), ' alice', 'alice\n', '../alice', '__proto__']) {
    assert.equal(ledger.isValidId(id), false, String(id));
  }
});

test('creates a version-zero ledger with clean names and unique member UUIDs', () => {
  const group = ledger.createGroup({ name: ' Vacances ', currency: 'EUR', names: [' Alice ', 'Béa'] });
  assert.equal(group.name, 'Vacances');
  assert.equal(group.currency, 'EUR');
  assert.deepEqual(group.entries, []);
  assert.equal(group.version, 0);
  assert.deepEqual(group.members.map(({ name }) => name), ['Alice', 'Béa']);
  const ids = group.members.map(({ id }) => id);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) assert.match(id, /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/);
});

test('validates group fields, member names, and the 24-member cap', () => {
  const input = { name: 'Groupe', currency: 'CAD', names: ['Alice'] };
  const names = Array.from({ length: 24 }, (_, i) => `Membre ${i + 1}`);
  assert.equal(ledger.createGroup({ ...input, names }).members.length, 24);
  for (const invalid of [
    null, [], {}, { ...input, name: ' ' }, { ...input, name: 'N'.repeat(81) },
    { ...input, name: 'Groupe\n' }, { ...input, currency: 'JPY' },
    { ...input, names: [] }, { ...input, names: 'Alice' }, { ...input, names: [null] },
    { ...input, names: ['Alice', '\tBob'] }, { ...input, names: ['x'.repeat(61)] },
    { ...input, names: ['Élodie', ' e\u0301LODIE '] }, { ...input, names: [...names, 'Autre'] },
  ]) {
    assert.throws(() => ledger.createGroup(invalid), ledger.ValidationError);
  }
});

function demoGroup(): ledger.Group {
  return {
    name: 'Sortie', currency: 'CHF', version: 3, entries: [],
    members: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }, { id: 'cam', name: 'Cam' }],
  };
}

test('adds a member with a fresh ID without mutating the old group', () => {
  const original = demoGroup();
  Object.freeze(original.members);
  Object.freeze(original);
  const updated = ledger.applyAction(original, { type: 'member.add', name: ' Dina ' });
  assert.equal(updated.version, 4);
  assert.deepEqual(updated.members.slice(0, 3), original.members);
  assert.equal(original.members.length, 3);
  const member = updated.members[3];
  assert.equal(member.name, 'Dina');
  assert.match(member.id, /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/);
});

test('rejects unknown actions and invalid, duplicate, or over-limit members', () => {
  const group = demoGroup();
  for (const input of [null, [], {}, { type: 'member.remove', id: 'bob' }, { type: 'member.add' },
    { type: 'member.add', name: ' bOB ' }, { type: 'member.add', name: 'Jean\u0085Paul' },
  ]) {
    assert.throws(() => ledger.applyAction(group, input), ledger.ValidationError);
  }
  const full = { ...group, members: Array.from({ length: 24 }, (_, i) => ({ id: `m${i}`, name: `Membre ${i}` })) };
  assert.throws(() => ledger.applyAction(full, { type: 'member.add', name: 'Dina' }), {
    name: 'ValidationError', message: /24 membres/,
  });
});

function expense(overrides: Partial<ledger.Expense> = {}): ledger.Expense {
  return {
    id: 'expense-1', kind: 'expense', label: ' Dîner ', date: '2024-02-29', amount: 100,
    payerId: 'alice', shares: { bob: 60, cam: 40 }, category: 'repas', ...overrides,
  };
}

function save(group: ledger.Group, entry: unknown): ledger.Group {
  const exists = entry && typeof entry === 'object' && 'id' in entry && group.entries.some(item => item.id === entry.id);
  return ledger.applyAction(group, { type: exists ? 'entry.edit' : 'entry.add', entry });
}

test('refuses to edit a deleted operation or add over an existing operation', () => {
  const group = save(demoGroup(), expense());
  assert.throws(() => ledger.applyAction(group, { type: 'entry.add', entry: expense() }), /déjà/);
  const deleted = ledger.applyAction(group, { type: 'entry.remove', id: 'expense-1' });
  assert.throws(() => ledger.applyAction(deleted, { type: 'entry.edit', entry: expense() }), /introuvable/);
});

test('large debts produce recordable transfers, even with 500 expenses', () => {
  let group = { ...demoGroup(), entries: Array.from({ length: 500 }, (_, i) => expense({
    id: `e${i}`, amount: 60_000_000, shares: { bob: 60_000_000 },
  })) } as ledger.Group;
  const proposals = ledger.settlements(group);
  assert.equal(proposals.reduce((total, item) => total + item.amount, 0), 30_000_000_000);
  assert.ok(proposals.every(t => t.amount <= 99_999_999));
  for (const [i, transfer] of proposals.entries()) group = ledger.applyAction(group, {
    type: 'entry.add', entry: payment({ ...transfer, id: `p${i}` }),
  });
  assert.deepEqual(ledger.settlements(group), []);
});

test('creates and edits an expense in place by ID without mutating inputs', () => {
  const group = demoGroup();
  Object.freeze(group.entries);
  const input = expense();
  const saved = save(group, input);
  assert.equal(saved.version, 4);
  assert.deepEqual(group.entries, []);
  assert.deepEqual(saved.entries, [{ ...input, label: 'Dîner' }]);
  assert.equal(input.label, ' Dîner ');
  assert.equal(saved.entries[0].kind, 'expense');
  assert.notEqual(saved.entries[0].shares, input.shares);

  const withTwo = save(saved, expense({ id: 'expense-2', label: 'Taxi', category: 'transport' }));
  Object.freeze(withTwo.entries);
  const edited = save(withTwo, expense({ label: ' Souper ', amount: 1, shares: ledger.splitEvenly(1, ['bob', 'cam']) }));
  assert.equal(edited.version, 6);
  assert.deepEqual(edited.entries.map(({ id, amount }) => [id, amount]), [['expense-1', 1], ['expense-2', 100]]);
  assert.equal(withTwo.entries[0].amount, 100);
});

test('rejects expenses with invalid IDs, amounts, dates, text, categories, payer, or shares', () => {
  const group = demoGroup();
  const invalid = [
    null, {}, { ...expense(), kind: 'refund' }, { ...expense(), category: 'hotel' },
    expense({ id: 'bad/id' }), expense({ label: ' ' }), expense({ label: 'x'.repeat(121) }),
    expense({ label: 'Dî\u0000ner' }), expense({ date: '2023-02-29' }), expense({ date: '2024-04-31' }),
    expense({ date: '0000-01-01' }), expense({ date: '2024-2-9' }), expense({ date: '2024-02-29T00:00:00Z' }),
    expense({ amount: 0 }), expense({ amount: 100.1 }), expense({ amount: 100_000_000 }),
    { ...expense(), amount: '100' }, expense({ payerId: 'nobody' }), expense({ payerId: 'constructor' }),
    expense({ shares: {} }), { ...expense(), shares: [100] },
    { ...expense(), shares: Object.create({ bob: 100 }) }, expense({ shares: { bob: 99 } }),
    expense({ shares: { bob: 100, nobody: 0 } }), expense({ shares: { bob: 100, cam: 0 } }),
    expense({ shares: { bob: 101, cam: -1 } }), expense({ shares: { bob: 99.5, cam: 0.5 } }),
  ];
  for (const input of invalid) assert.throws(() => save(group, input), ledger.ValidationError, JSON.stringify(input));
});

test('limits additions to 500 expenses but permits editing at capacity', () => {
  const group = { ...demoGroup(), entries: Array.from({ length: 500 }, (_, i) => expense({ id: `e${i}` })) };
  assert.throws(() => save(group, expense()), { name: 'ValidationError', message: /500 dépenses/ });
  const updated = save(group, expense({ id: 'e0', label: 'Café' }));
  assert.equal(updated.entries.length, 500);
  assert.deepEqual(updated.entries[0], expense({ id: 'e0', label: 'Café' }));
});

test('removes an existing entry and rejects invalid or missing IDs', () => {
  const group = save(demoGroup(), expense());
  Object.freeze(group.entries);
  const updated = ledger.applyAction(group, { type: 'entry.remove', id: 'expense-1' });
  assert.equal(updated.version, 5);
  assert.deepEqual(updated.entries, []);
  assert.equal(group.entries.length, 1);
  for (const id of [null, '../expense-1', 'absent']) {
    assert.throws(() => ledger.applyAction(group, { type: 'entry.remove', id }), ledger.ValidationError);
  }
});

function payment(overrides: Partial<ledger.Payment> = {}): ledger.Payment {
  return {
    id: 'payment-1', kind: 'payment', date: '2024-03-01', amount: 25,
    fromId: 'bob', toId: 'alice', ...overrides,
  };
}

test('saves and edits a payment between distinct members', () => {
  const group = save(demoGroup(), payment());
  assert.deepEqual(group.entries, [payment()]);
  const edited = save(group, payment({ amount: 99_999_999, toId: 'cam' }));
  assert.equal(edited.version, group.version + 1);
  assert.deepEqual(edited.entries, [payment({ amount: 99_999_999, toId: 'cam' })]);
  assert.deepEqual(group.entries, [payment()]);
});

test('rejects self-payments and payments involving unknown members', () => {
  const group = demoGroup();
  for (const input of [payment({ fromId: 'alice' }), payment({ fromId: 'unknown' }), payment({ toId: 'unknown' })]) {
    assert.throws(() => save(group, input), ledger.ValidationError);
  }
});

test('prevents an edit from changing the entry kind in either direction', () => {
  const group = save(save(demoGroup(), payment()), expense());
  assert.throws(() => save(group, expense({ id: 'payment-1' })), { name: 'ValidationError', message: /type/ });
  assert.throws(() => save(group, payment({ id: 'expense-1' })), { name: 'ValidationError', message: /type/ });
});

test('computes expense balances net of recorded payments, including idle members', () => {
  const original = demoGroup();
  original.members.push({ id: 'constructor', name: 'Dina' });
  const group = save(save(save(original, expense()), expense({
    id: 'expense-2', amount: 23, payerId: 'cam', shares: { alice: 10, cam: 13 },
  })), payment());
  Object.freeze(group.entries);
  Object.freeze(group.members);
  assert.deepEqual(ledger.balances(original), { alice: 0, bob: 0, cam: 0, constructor: 0 });
  assert.deepEqual(ledger.balances(group), { alice: 65, bob: -35, cam: -30, constructor: 0 });
});

test('suggests deterministic transfers that clear the current balances', () => {
  const group = demoGroup();
  group.members.push({ id: 'dina', name: 'Dina' });
  const outstanding = save(save(group, expense({ shares: { bob: 80, cam: 20 } })), expense({
    id: 'expense-2', amount: 60, payerId: 'dina', shares: { cam: 60 },
  }));
  const transfers = ledger.settlements(outstanding);
  assert.deepEqual(transfers, [
    { fromId: 'bob', toId: 'alice', amount: 80 },
    { fromId: 'cam', toId: 'alice', amount: 20 },
    { fromId: 'cam', toId: 'dina', amount: 60 },
  ]);
  const settled = transfers.reduce((current, transfer, i) => save(current, payment({
    id: `settlement-${i}`, ...transfer,
  })), outstanding);
  assert.deepEqual(ledger.balances(settled), { alice: 0, bob: 0, cam: 0, dina: 0 });
  assert.deepEqual(ledger.settlements(settled), []);
});
