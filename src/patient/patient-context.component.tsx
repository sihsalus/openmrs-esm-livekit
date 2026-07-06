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
        setSummary(buildPatientSummary(conditions, allergies, medications));
      })
      .catch(() => {
        if (!cancelled) {
          setSummary({ conditions: [], allergies: [], medications: [] });
        }
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
  const isEmpty =
    summary.conditions.length === 0 && summary.allergies.length === 0 && summary.medications.length === 0;

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
          />
          <ContextGroup
            label={t('knownAllergies', 'Known allergies')}
            items={summary.allergies}
            tagType="magenta"
            emptyLabel={t('nkda', 'NKDA')}
          />
          <ContextGroup
            label={t('activeMedications', 'Active medications')}
            items={summary.medications}
            tagType="teal"
            emptyLabel={t('noneOnFile', 'None on file')}
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
}> = ({ label, items, tagType, emptyLabel }) => (
  <div className={styles.contextGroup}>
    <span className={styles.contextLabel}>{label}</span>
    <div className={styles.tagWrap}>
      {items.length > 0 ? (
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

async function fetchFhirList(path: string): Promise<FhirEntry[]> {
  try {
    const res = await openmrsFetch(path);
    const bundle = res.data;
    return bundle?.entry ?? [];
  } catch {
    return [];
  }
}

export default PatientContext;
