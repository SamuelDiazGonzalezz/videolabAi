import { useEffect, useState } from 'react';

export type UiLocale = 'es' | 'en';
export type UiLanguagePreference = UiLocale | 'auto';

interface VidreumI18nApi {
  locale?: string;
  intlLocale?: string;
  t?: (source: string) => string;
  preference?: string;
  setLanguagePreference?: (preference: UiLanguagePreference) => string;
}

interface LanguageChangeDetail {
  locale?: string;
  intlLocale?: string;
}

function i18nApi(): VidreumI18nApi | undefined {
  return (window as Window & { vidreumI18n?: VidreumI18nApi }).vidreumI18n;
}

function normalizedLocale(value: unknown): UiLocale | null {
  const locale = String(value || '').trim().toLowerCase();
  if (locale === 'en' || locale.startsWith('en-')) return 'en';
  if (locale === 'es' || locale.startsWith('es-')) return 'es';
  return null;
}

export function getUiLocale(): UiLocale {
  return normalizedLocale(i18nApi()?.locale)
    || normalizedLocale(document.documentElement.lang)
    || 'es';
}

export function getIntlLocale(): string {
  const configured = normalizedLocale(i18nApi()?.intlLocale);
  const locale = configured || getUiLocale();
  return locale === 'en' ? 'en-US' : 'es-ES';
}

export function t(source: string): string {
  const translate = i18nApi()?.t;
  if (!translate) return source;
  try {
    const translated = translate(source);
    return typeof translated === 'string' && translated ? translated : source;
  } catch {
    return source;
  }
}

export function getUiLanguagePreference(): UiLanguagePreference {
  const preference = String(i18nApi()?.preference || '').trim().toLowerCase();
  return preference === 'es' || preference === 'en' ? preference : 'auto';
}

export function setUiLanguagePreference(preference: UiLanguagePreference): void {
  i18nApi()?.setLanguagePreference?.(preference);
}

// React debe volver a pintar los textos calculados (valores controlados,
// muestras CSS y ARIA que incluyen contenido del usuario) al cambiar el
// idioma. El observador global sigue ocupándose del texto HTML estático.
export function useUiLocale(): UiLocale {
  const [locale, setLocale] = useState<UiLocale>(getUiLocale);

  useEffect(() => {
    const handleLanguageChange = (event: Event) => {
      const detail = (event as CustomEvent<LanguageChangeDetail>).detail;
      setLocale(normalizedLocale(detail?.locale) || getUiLocale());
    };
    window.addEventListener('vidreum:language-change', handleLanguageChange);
    setLocale(getUiLocale());
    return () => window.removeEventListener('vidreum:language-change', handleLanguageChange);
  }, []);

  return locale;
}
