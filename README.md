# ocompte

Un carnet de dépenses de groupe en français, inspiré de Tricount. Créez un groupe, envoyez son lien, saisissez les dépenses et enregistrez les remboursements déjà effectués. L’application ne transfère pas d’argent.

- Dépenses réparties à parts égales entre les personnes sélectionnées ou par montants personnalisés.
- Calcul des soldes et proposition de remboursements en centimes entiers, dans la devise du groupe (EUR, USD, GBP, CHF ou CAD). Pas de conversion automatique.
- Sans compte : toute personne disposant du lien peut lire et modifier le groupe. Conservez ce lien et ne le publiez pas. L’historique des liens récents est propre au navigateur.
- La démonstration ne contient que des données fictives et ne nécessite pas de base.

## Lancer en local

Prérequis : Node.js 24 et une base PostgreSQL dédiée. Copiez `.env.example` vers `.env.local` et renseignez `DATABASE_URL` (URL de connexion du rôle applicatif, autorisé à créer les tables lors du premier accès). Ne commitez jamais `.env.local`.

```sh
npm ci
npm run dev
```

Vérifications :

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

Avec une application démarrée sur une base de test et Chromium installé (`npx playwright install chromium`, ou `CHROMIUM_PATH=/chemin/vers/chromium`) :

```sh
TEST_BASE_URL=http://localhost:3000 npm run test:browser
```

Ce scénario crée des données : n’utilisez pas une base de production pour les tests automatisés.

## Vercel

1. Importez `oscar-support/ocompte` avec l’intégration GitHub Vercel, en limitant l’installation à ce dépôt. Le framework est Next.js ; la branche de production est `main`.
2. Dans **Storage**, créez une base Neon dédiée. Sélectionnez le plan **Free** seulement, s’il est proposé. Connectez la base à l’environnement **Production** du projet : l’intégration fournit la variable serveur `DATABASE_URL`. Pour une preview fonctionnelle, connectez une base ou branche de test distincte à l’environnement **Preview**.
3. Redéployez après l’ajout de la variable. Vérifiez l’accueil, puis créez un groupe et ouvrez son lien dans un autre navigateur pour confirmer le partage.

Le lien utilise un jeton aléatoire dans le fragment (`#g=…`), envoyé à l’API via un en-tête d’autorisation. La base ne conserve que son empreinte. Les réponses de l’API ne sont pas mises en cache et les mises à jour concurrentes sont contrôlées par version.
