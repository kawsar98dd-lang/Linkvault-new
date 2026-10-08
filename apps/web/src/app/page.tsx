import { t } from '@bnlinkvault/i18n';

/** Phase 2 shell. The product UI arrives in later phases; no legacy link tooling lives here. */
export default function Home() {
  return (
    <main>
      <h1>{t('en', 'app.name')}</h1>
      <p>{t('en', 'app.tagline')}</p>
      <p>{t('en', 'shell.status')}</p>
    </main>
  );
}
