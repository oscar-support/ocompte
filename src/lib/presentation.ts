import type { Currency, Entry, Group } from './ledger.ts';

export const currencies: Record<Currency, string> = { EUR: 'Euro · EUR', USD: 'Dollar américain · USD', GBP: 'Livre sterling · GBP', CHF: 'Franc suisse · CHF', CAD: 'Dollar canadien · CAD' };
export const categories = { repas: 'Repas', courses: 'Courses', transport: 'Transport', logement: 'Logement', loisirs: 'Loisirs', autre: 'Autre' } as const;
export const displayMoney = (amount: number, currency: Currency) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount / 100);
export const displayDate = (date: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(n => Array.from(n)[0]).join('').toUpperCase();
export const sortedEntries = (entries: Entry[]) => [...entries].reverse().sort((a,b) => b.date.localeCompare(a.date));

export const example: Group = {
  name: 'Week-end à Lisbonne', currency: 'EUR', version: 0,
  members: [{ id: 'camille', name: 'Camille' }, { id: 'noe', name: 'Noé' }, { id: 'jade', name: 'Jade' }, { id: 'sami', name: 'Sami' }],
  entries: [
    { id: 'appartement', kind: 'expense', category: 'logement', label: 'Appartement à Alfama', date: '2026-05-15', payerId: 'camille', amount: 24800, shares: { camille: 6200, noe: 6200, jade: 6200, sami: 6200 } },
    { id: 'tram', kind: 'expense', category: 'transport', label: 'Tickets de tram', date: '2026-05-16', payerId: 'jade', amount: 1600, shares: { camille: 400, noe: 400, jade: 400, sami: 400 } },
    { id: 'resto', kind: 'expense', category: 'repas', label: 'Dîner au Time Out Market', date: '2026-05-16', payerId: 'noe', amount: 8640, shares: { camille: 2160, noe: 2160, jade: 2160, sami: 2160 } },
    { id: 'brunch', kind: 'expense', category: 'repas', label: 'Brunch chez Nicolau', date: '2026-05-17', payerId: 'sami', amount: 5200, shares: { camille: 1300, noe: 1300, jade: 1300, sami: 1300 } },
  ],
};
