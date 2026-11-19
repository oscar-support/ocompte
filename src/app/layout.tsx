import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/fraunces';
import './styles.css';

export const metadata: Metadata = {
  title: 'ocompte — Les bons comptes, ensemble',
  description: 'Un carnet pour les dépenses de groupe. Ajoutez les dépenses, répartissez-les et voyez qui rembourse qui.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="fr"><body>{children}</body></html>;
}
