export type Currency = 'EUR' | 'USD' | 'GBP' | 'CHF' | 'CAD';
export type Member = { id: string; name: string };
export type Expense = {
  id: string;
  kind: 'expense';
  label: string;
  date: string;
  amount: number;
  payerId: string;
  shares: Record<string, number>;
  category: 'repas' | 'courses' | 'transport' | 'logement' | 'loisirs' | 'autre';
};
export type Payment = {
  id: string;
  kind: 'payment';
  date: string;
  amount: number;
  fromId: string;
  toId: string;
};
export type Entry = Expense | Payment;
export type Group = { name: string; currency: Currency; members: Member[]; entries: Entry[]; version: number };
export type CreateGroup = { name: string; currency: Currency; names: string[] };
export type Action =
  | { type: 'member.add'; name: string }
  | { type: 'entry.add' | 'entry.edit'; entry: Entry }
  | { type: 'entry.remove'; id: string };

const MAX_AMOUNT = 99_999_999;
const MAX_MEMBERS = 24;
const ENTRY_LIMIT = { expense: 500, payment: 1500 };
const CONTROL = /\p{Cc}/u;
const CURRENCIES: ReadonlySet<unknown> = new Set<Currency>(['EUR', 'USD', 'GBP', 'CHF', 'CAD']);
const CATEGORIES: ReadonlySet<unknown> = new Set<Expense['category']>([
  'repas', 'courses', 'transport', 'logement', 'loisirs', 'autre',
]);

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id);
}

export function splitEvenly(amount: number, memberIds: string[]): Record<string, number> {
  if (!isAmount(amount)) throw new ValidationError('Montant invalide.');
  if (memberIds.length === 0 || !Array.from(memberIds).every(isValidId) ||
      new Set(memberIds).size !== memberIds.length) {
    throw new ValidationError('Sélectionnez des membres distincts et valides.');
  }
  const base = Math.floor(amount / memberIds.length);
  const remainder = amount % memberIds.length;
  return Object.fromEntries(memberIds.map((id, index) => [id, base + (index < remainder ? 1 : 0)]));
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_AMOUNT;
}

export function parseAmount(input: string): number | null {
  if (CONTROL.test(input)) return null;
  const match = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return isAmount(cents) ? cents : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanText(value: unknown, limit: number, message: string): string {
  if (typeof value !== 'string' || !value.isWellFormed() || CONTROL.test(value)) throw new ValidationError(message);
  const text = value.trim().normalize('NFC');
  if (!text || text.length > limit) throw new ValidationError(message);
  return text;
}

function cleanMemberName(value: unknown): string {
  return cleanText(value, 60, 'Le nom du membre doit contenir de 1 à 60 caractères, sans caractère de contrôle.');
}

function newMember(name: string): Member {
  return { id: globalThis.crypto.randomUUID(), name };
}

export function createGroup(input: unknown): Group {
  if (!isRecord(input)) throw new ValidationError('Groupe invalide.');
  const name = cleanText(input.name, 80, 'Le nom du groupe doit contenir de 1 à 80 caractères, sans caractère de contrôle.');
  if (!CURRENCIES.has(input.currency)) throw new ValidationError('Devise invalide.');
  if (!Array.isArray(input.names) || input.names.length === 0 || input.names.length > MAX_MEMBERS) {
    throw new ValidationError('Le groupe doit compter de 1 à 24 membres.');
  }
  const names = Array.from(input.names, cleanMemberName);
  if (new Set(names.map((memberName) => memberName.toLowerCase())).size !== names.length) {
    throw new ValidationError('Les noms des membres doivent être distincts.');
  }
  return { name, currency: input.currency as Currency, members: names.map(newMember), entries: [], version: 0 };
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readShares(input: unknown, members: Set<string>, amount: number): Record<string, number> {
  if (!isRecord(input)) throw new ValidationError('Répartition invalide.');
  const shares: [string, number][] = [];
  let total = 0;
  let min = amount;
  let max = 0;
  for (const [id, share] of Object.entries(input)) {
    if (!members.has(id) || typeof share !== 'number' || !Number.isInteger(share) || share < 0 || share > amount) {
      throw new ValidationError('Chaque part doit être un montant en centimes attribué à un membre du groupe.');
    }
    total += share;
    min = Math.min(min, share);
    max = Math.max(max, share);
    shares.push([id, share]);
  }
  if (total !== amount) throw new ValidationError('Le total des parts doit correspondre au montant.');
  // A zero share is only valid for an equal split of fewer cents than people.
  if (min === 0 && max > 1) throw new ValidationError('Seul un partage égal peut contenir une part nulle.');
  return Object.fromEntries(shares);
}

function readEntry(input: unknown, group: Group): Entry {
  if (!isRecord(input)) throw new ValidationError('Écriture invalide.');
  const { id, date, amount, kind } = input;
  if (!isValidId(id)) throw new ValidationError('Identifiant d’écriture invalide.');
  if (!isDate(date)) throw new ValidationError('Date invalide (format AAAA-MM-JJ).');
  if (!isAmount(amount)) throw new ValidationError('Montant invalide.');
  const members = new Set(group.members.map((member) => member.id));
  if (kind === 'expense') {
    const { payerId, category } = input;
    if (!isValidId(payerId) || !members.has(payerId)) throw new ValidationError('Le payeur doit être membre du groupe.');
    if (!CATEGORIES.has(category)) throw new ValidationError('Catégorie de dépense invalide.');
    const label = cleanText(input.label, 120, 'Le libellé doit contenir de 1 à 120 caractères, sans caractère de contrôle.');
    return { id, kind, date, amount, payerId, label, category: category as Expense['category'],
      shares: readShares(input.shares, members, amount) };
  }
  if (kind === 'payment') {
    const { fromId, toId } = input;
    if (!isValidId(fromId) || !isValidId(toId) || !members.has(fromId) || !members.has(toId) || fromId === toId) {
      throw new ValidationError('Le remboursement doit relier deux membres distincts du groupe.');
    }
    return { id, kind, date, amount, fromId, toId };
  }
  throw new ValidationError('Type d’écriture inconnu.');
}

export function applyAction(group: Group, input: unknown): Group {
  if (!isRecord(input)) throw new ValidationError('Action invalide.');
  const version = group.version + 1;
  switch (input.type) {
    case 'member.add': {
      if (group.members.length >= MAX_MEMBERS) throw new ValidationError('Le groupe est limité à 24 membres.');
      const name = cleanMemberName(input.name);
      if (group.members.some((member) => member.name.toLowerCase() === name.toLowerCase())) {
        throw new ValidationError('Un membre porte déjà ce nom.');
      }
      return { ...group, members: [...group.members, newMember(name)], version };
    }
    case 'entry.add':
    case 'entry.edit': {
      const entry = readEntry(input.entry, group);
      const index = group.entries.findIndex((existing) => existing.id === entry.id);
      if (input.type === 'entry.add') {
        if (index !== -1) throw new ValidationError('Cette opération est déjà enregistrée.');
        if (group.entries.filter(item => item.kind === entry.kind).length >= ENTRY_LIMIT[entry.kind]) {
          throw new ValidationError(entry.kind === 'expense' ? 'Le groupe est limité à 500 dépenses.' : 'Le groupe est limité à 1 500 remboursements.');
        }
        return { ...group, entries: [...group.entries, entry], version };
      }
      if (index === -1) throw new ValidationError('Écriture introuvable.');
      if (group.entries[index].kind !== entry.kind) throw new ValidationError('Le type d’une écriture ne peut pas être modifié.');
      const entries = group.entries.slice();
      entries[index] = entry;
      return { ...group, entries, version };
    }
    case 'entry.remove': {
      if (!isValidId(input.id)) throw new ValidationError('Identifiant d’écriture invalide.');
      const entries = group.entries.filter((entry) => entry.id !== input.id);
      if (entries.length === group.entries.length) throw new ValidationError('Écriture introuvable.');
      return { ...group, entries, version };
    }
    default:
      throw new ValidationError('Action inconnue.');
  }
}

/** Positive balances are owed money; negative balances owe money. */
export function balances(group: Group): Record<string, number> {
  const net = Object.fromEntries(group.members.map(({ id }) => [id, 0] as const)) as Record<string, number>;
  for (const entry of group.entries) {
    if (entry.kind === 'expense') {
      net[entry.payerId] += entry.amount;
      for (const [id, share] of Object.entries(entry.shares)) net[id] -= share;
    } else {
      net[entry.fromId] += entry.amount;
      net[entry.toId] -= entry.amount;
    }
  }
  return net;
}

export function settlements(group: Group): { fromId: string; toId: string; amount: number }[] {
  const net = balances(group);
  const debtors = group.members.filter(({ id }) => net[id] < 0)
    .map(({ id }) => ({ id, remaining: -net[id] })).sort((a, b) => b.remaining - a.remaining);
  const creditors = group.members.filter(({ id }) => net[id] > 0)
    .map(({ id }) => ({ id, remaining: net[id] })).sort((a, b) => b.remaining - a.remaining);
  const transfers: { fromId: string; toId: string; amount: number }[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d];
    const creditor = creditors[c];
    const amount = Math.min(debtor.remaining, creditor.remaining, MAX_AMOUNT);
    transfers.push({ fromId: debtor.id, toId: creditor.id, amount });
    debtor.remaining -= amount;
    creditor.remaining -= amount;
    if (debtor.remaining === 0) d++;
    if (creditor.remaining === 0) c++;
  }
  return transfers;
}
