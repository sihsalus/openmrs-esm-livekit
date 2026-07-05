export type ClinicalLanguageCode = 'en' | 'es';

export type LocaleSource = {
  resolvedLanguage?: string;
  language?: string;
  languages?: readonly string[];
};

export type BrowserLanguageSource = {
  language?: string;
  languages?: readonly string[];
};

export type ClinicalLanguageDefaults = {
  doctorLanguage: ClinicalLanguageCode;
  patientLanguage: ClinicalLanguageCode;
};

const currentBrowserLanguageSource = (): BrowserLanguageSource | undefined => {
  return typeof navigator === 'undefined' ? undefined : navigator;
};

export const openmrsLocaleFromI18n = (
  i18n: LocaleSource | undefined,
  browser: BrowserLanguageSource | undefined = currentBrowserLanguageSource(),
) => {
  return (
    i18n?.resolvedLanguage ||
    i18n?.languages?.find(Boolean) ||
    i18n?.language ||
    browser?.languages?.find(Boolean) ||
    browser?.language ||
    ''
  );
};

export const clinicalLanguageFromLocale = (
  locale: string | null | undefined,
  fallback: ClinicalLanguageCode = 'en',
): ClinicalLanguageCode => {
  const normalized = (locale || '').trim().toLowerCase().replace('_', '-');

  if (normalized === 'es' || normalized.startsWith('es-')) {
    return 'es';
  }

  if (normalized === 'en' || normalized.startsWith('en-')) {
    return 'en';
  }

  return fallback;
};

export const clinicalLanguageDefaultsFromLocale = (
  locale: string | null | undefined,
): ClinicalLanguageDefaults => {
  const openmrsLanguage = clinicalLanguageFromLocale(locale);

  if (openmrsLanguage === 'es') {
    return {
      doctorLanguage: 'es',
      patientLanguage: 'es',
    };
  }

  return {
    doctorLanguage: 'en',
    patientLanguage: 'es',
  };
};

export const clinicalLanguageDefaultsFromOpenmrsLocale = (
  i18n: LocaleSource | undefined,
  browser?: BrowserLanguageSource,
) => clinicalLanguageDefaultsFromLocale(openmrsLocaleFromI18n(i18n, browser));
