import React, { useEffect, useState } from 'react';
import { Tag, SkeletonText } from '@carbon/react';
import { openmrsFetch, usePatient } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import styles from './patient-context.scss';
import { buildPatientContextPaths, buildPatientSummary, FhirEntry, PatientSummary } from './patient-context';

const PatientContext: React.FC = () => {
  const { t } = useTranslation();
  const { patient } = usePatient();
  const [summary, setSummary] = useState<PatientSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, [patient?.id]);

  if (loading) {
    return (
      <div className={styles.context}>
        <SkeletonText heading width="40%" />
        <SkeletonText paragraph lineCount={3} />
      </div>
    );
  }

  if (!summary) return null;

  const isEmpty =
    summary.conditions.length === 0 && summary.allergies.length === 0 && summary.medications.length === 0;

  return (
    <div className={styles.context}>
      <h5 className={styles.contextTitle}>{t('patientContext', 'Patient context')}</h5>
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
    </div>
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
