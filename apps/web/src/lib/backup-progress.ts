/** Stage estimates, not byte counts or a prediction of remaining time. */
export const BACKUP_STAGES = {
  cloning: { percent: 10, label: 'Copying repository history…' },
  history: { percent: 25, label: 'Checking commits and branches…' },
  bundling: { percent: 40, label: 'Creating your backup bundle…' },
  encrypting: { percent: 50, label: 'Encrypting your backup…' },
  uploading: { percent: 60, label: 'Uploading your encrypted backup…' },
  anchoring: { percent: 75, label: 'Preparing the backup proof…' },
  confirming: { percent: 90, label: 'Waiting for proof confirmation…' },
} as const;

export function backupProgress(state: string, progress: number) {
  if (state === 'completed') return { percent: 100, label: 'Backup complete' };
  if (state === 'failed') return { percent: Math.min(progress || 0, 90), label: 'Backup interrupted' };
  const percent = state === 'prepared' ? 90 : Math.max(0, Math.min(progress || 0, 90));
  const stage = Object.values(BACKUP_STAGES).find(stage => stage.percent === percent);
  return { percent, label: stage?.label || 'Waiting for a backup worker…' };
}
