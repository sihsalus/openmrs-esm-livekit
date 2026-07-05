import { describe, expect, it } from 'vitest';
import {
  clinicalLanguageDefaultsFromLocale,
  clinicalLanguageDefaultsFromOpenmrsLocale,
  clinicalLanguageFromLocale,
  openmrsLocaleFromI18n,
} from './clinical-language';

describe('clinical language defaults', () => {
  it('maps supported OpenMRS locales to clinical language codes', () => {
    expect(clinicalLanguageFromLocale('es')).toBe('es');
    expect(clinicalLanguageFromLocale('es-PE')).toBe('es');
    expect(clinicalLanguageFromLocale('es_MX')).toBe('es');
    expect(clinicalLanguageFromLocale('en')).toBe('en');
    expect(clinicalLanguageFromLocale('en-US')).toBe('en');
  });

  it('falls back to English for unsupported or missing locales', () => {
    expect(clinicalLanguageFromLocale('fr-FR')).toBe('en');
    expect(clinicalLanguageFromLocale('')).toBe('en');
    expect(clinicalLanguageFromLocale(undefined)).toBe('en');
  });

  it('uses Spanish for both sides when OpenMRS is localized in Spanish', () => {
    expect(clinicalLanguageDefaultsFromLocale('es-PE')).toEqual({
      doctorLanguage: 'es',
      patientLanguage: 'es',
    });
  });

  it('keeps the bilingual demo default when OpenMRS is localized in English', () => {
    expect(clinicalLanguageDefaultsFromLocale('en-US')).toEqual({
      doctorLanguage: 'en',
      patientLanguage: 'es',
    });
  });

  it('resolves locale from OpenMRS i18n before browser fallback', () => {
    expect(
      openmrsLocaleFromI18n(
        {
          resolvedLanguage: 'es-PE',
          language: 'en',
          languages: ['en'],
        },
        { language: 'en-US' },
      ),
    ).toBe('es-PE');

    expect(
      openmrsLocaleFromI18n(
        {
          language: 'en',
          languages: ['es-MX', 'en'],
        },
        { language: 'en-US' },
      ),
    ).toBe('es-MX');
  });

  it('derives clinical defaults from OpenMRS i18n', () => {
    expect(clinicalLanguageDefaultsFromOpenmrsLocale({ resolvedLanguage: 'es' })).toEqual({
      doctorLanguage: 'es',
      patientLanguage: 'es',
    });
  });
});
