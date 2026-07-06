import React, { useEffect, useState } from 'react';
import { Tag, SkeletonText, Tile } from '@carbon/react';
import { openmrsFetch, usePatient } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import styles from './patient-context.scss';
import {
  buildPatientContextPaths,
  buildPatientDemographics,
  buildPatientSummary,
  FhirEntry,
  PatientSummary,
} from './patient-context';

type PatientContextGroupKey = 'conditions' | 'allergies' | 'medications';

interface FhirListResult {
  entries: FhirEntry[];
  failed: boolean;
}

const PatientContext: React.FC = () => {
  const { t } = useTranslation();
  const { patient, isLoading: patientLoading } = usePatient();
  const [summary, setSummary] = useState<PatientSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const demographics = buildPatientDemographics(patient);

  useEffect(() => {
    if (patientLoading) {
      return;
    }

    if (!patient?.id) {
      setSummary(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const paths = buildPatientContextPaths(patient.id);

    Promise.all([
      fetchFhirList(paths.conditions),
      fetchFhirList(paths.allergies),
      fetchFhirList(paths.medications),
    ])
      .then(([conditions, allergies, medications]) => {
        if (cancelled) return;
        const nextSummary = buildPatientSummary(conditions.entries, allergies.entries, medications.entries);
        const unavailable: PatientContextGroupKey[] = [];
        if (conditions.failed) {
          unavailable.push('conditions');
        }
        if (allergies.failed) {
          unavailable.push('allergies');
        }
        if (medications.failed) {
          unavailable.push('medications');
        }
        setSummary({ ...nextSummary, unavailable });
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [patient?.id, patientLoading]);

  if (patientLoading || loading) {
    return (
      <Tile className={styles.contextCard}>
        <SkeletonText heading width="35%" />
        <SkeletonText paragraph lineCount={2} />
        <SkeletonText paragraph lineCount={4} />
      </Tile>
    );
  }

  if (!summary) return null;

  const patientName = demographics.name || t('unknownPatient', 'Unknown patient');
  const unavailable = new Set(summary.unavailable ?? []);
  const isEmpty =
    summary.conditions.length === 0 &&
    summary.allergies.length === 0 &&
    summary.medications.length === 0 &&
    unavailable.size === 0;

  return (
    <Tile className={styles.contextCard}>
      <div className={styles.contextHeader}>
        <div>
          <h5 className={styles.contextTitle}>{t('clinicalContext', 'Clinical context')}</h5>
          <p className={styles.patientName}>{patientName}</p>
        </div>
      </div>
      <dl className={styles.demographicsList}>
        {demographics.gender && (
          <div>
            <dt>{t('sex', 'Sex')}</dt>
            <dd>{demographics.gender}</dd>
          </div>
        )}
        {typeof demographics.age === 'number' && (
          <div>
            <dt>{t('age', 'Age')}</dt>
            <dd>{t('ageYears', '{{count}} years', { count: demographics.age })}</dd>
          </div>
        )}
        {demographics.birthDate && (
          <div>
            <dt>{t('birthDate', 'Birth date')}</dt>
            <dd>{demographics.birthDate}</dd>
          </div>
        )}
        {demographics.identifiers.slice(0, 2).map((identifier) => (
          <div key={`${identifier.label}-${identifier.value}`}>
            <dt>{identifier.label}</dt>
            <dd>{identifier.value}</dd>
          </div>
        ))}
      </dl>
      {isEmpty ? (
        <p className={styles.emptyState}>
          {t('noPatientContext', 'No active conditions, allergies, or medications on file.')}
        </p>
      ) : (
        <div className={styles.contextGrid}>
          <ContextGroup
            label={t('activeConditions', 'Active conditions')}
            items={summary.conditions}
            tagType="red"
            emptyLabel={t('noneOnFile', 'None on file')}
            unavailable={unavailable.has('conditions')}
            unavailableLabel={t('unableToLoad', 'Unable to load')}
          />
          <ContextGroup
            label={t('knownAllergies', 'Known allergies')}
            items={summary.allergies}
            tagType="magenta"
            emptyLabel={t('nkda', 'NKDA')}
            unavailable={unavailable.has('allergies')}
            unavailableLabel={t('unableToLoad', 'Unable to load')}
          />
          <ContextGroup
            label={t('activeMedications', 'Active medications')}
            items={summary.medications}
            tagType="teal"
            emptyLabel={t('noneOnFile', 'None on file')}
            unavailable={unavailable.has('medications')}
            unavailableLabel={t('unableToLoad', 'Unable to load')}
          />
        </div>
      )}
    </Tile>
  );
};

const ContextGroup: React.FC<{
  label: string;
  items: string[];
  tagType: string;
  emptyLabel: string;
  unavailable?: boolean;
  unavailableLabel: string;
}> = ({ label, items, tagType, emptyLabel, unavailable, unavailableLabel }) => (
  <div className={styles.contextGroup}>
    <span className={styles.contextLabel}>{label}</span>
    <div className={styles.tagWrap}>
      {unavailable ? (
        <Tag type="warm-gray" size="sm">
          {unavailableLabel}
        </Tag>
      ) : items.length > 0 ? (
        items.map((item, i) => (
          <Tag key={i} type={tagType as 'red' | 'magenta' | 'teal'} size="sm">
            {item}
          </Tag>
        ))
      ) : (
        <Tag type="gray" size="sm">
          {emptyLabel}
        </Tag>
      )}
    </div>
  </div>
);

async function fetchFhirList(path: string): Promise<FhirListResult> {
  try {
    const res = await openmrsFetch(path);
    const bundle = res.data;
    return { entries: bundle?.entry ?? [], failed: false };
  } catch {
    return { entries: [], failed: true };
  }
}

export default PatientContext;
