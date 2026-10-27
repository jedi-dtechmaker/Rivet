import { ccc } from '@ckb-ccc/core';
import { PrismaClient, Repository, User } from '@prisma/client';
import { readPublicRepository } from './public-repository';

export class ManifestBackupMetadataError extends Error {
  readonly code = 'MANIFEST_BACKUP_METADATA';
  constructor(repository: string, reason: string) {
    super(`Cannot sync ${repository}: ${reason} Your saved backup is unchanged. Use Refresh backup on its dashboard card if its references cannot be recovered.`);
    this.name = 'ManifestBackupMetadataError';
  }
}

/** Recover metadata for an existing backup; never upload or anchor another backup. */
export async function reconcileManifestBackups(
  user: Pick<User, 'id' | 'githubId'>,
  repositories: Repository[],
  options: {
    database: Pick<PrismaClient, 'repository'>;
    client: Pick<ccc.Client, 'getTransaction'>;
    token?: string;
    readRepository?: typeof readPublicRepository;
  },
) {
  const readRepository = options.readRepository || readPublicRepository;
  for (let offset = 0; offset < repositories.length; offset += 4) {
    await Promise.all(repositories.slice(offset, offset + 4).map(async repo => {
      if (repo.githubNumericId && repo.ckbCellOutpoint) return;
      const fail = (reason: string): never => { throw new ManifestBackupMetadataError(repo.fullName, reason); };
      if (repo.userId !== user.id || repo.isPrivate || !repo.isBackedUp) fail('this record is not an eligible public backup.');
      if (!repo.ckbTxHash || !repo.lastBackupCid) fail('its saved anchor or bundle reference is missing.');
      const anchor = await options.client.getTransaction(repo.ckbTxHash!);
      if (anchor?.status !== 'committed' || anchor.transaction.hash() !== repo.ckbTxHash) fail('its original backup anchor could not be confirmed.');
      const transaction = anchor!.transaction;
      let anchorOutpoint = repo.ckbCellOutpoint;
      if (!anchorOutpoint) {
        // Historical workers saved the transaction hash but not its output
        // index. Recover only an unambiguous, untyped 32-byte anchor output.
        const indexes = transaction.outputsData.flatMap((data, index) =>
          /^0x[0-9a-f]{64}$/i.test(data) && !transaction.outputs[index]?.type ? [index] : []);
        if (indexes.length !== 1) fail('its original transaction does not identify one unambiguous backup anchor.');
        anchorOutpoint = `${repo.ckbTxHash}:${indexes[0]}`;
      }
      const match = /^(0x[0-9a-f]{64}):(0|[1-9][0-9]*)$/i.exec(anchorOutpoint!);
      if (!match || match[1] !== repo.ckbTxHash || !Number.isSafeInteger(Number(match[2]))
        || !transaction.outputs[Number(match[2])] || !/^0x[0-9a-f]{64}$/i.test(transaction.outputsData[Number(match[2])] || '')) {
        fail('its saved anchor output is invalid.');
      }
      let numericId = repo.githubNumericId;
      if (!numericId) {
        const current = await readRepository(repo.fullName, options.token);
        if (!current.ok) fail('its public GitHub repository could not be verified.');
        if (!current.ok) return;
        const github = current.repository;
        const created = Date.parse(github.created_at || '');
        // A current path alone is insufficient: reject another owner and a
        // repository recreated after this backup record was first registered.
        // This is a present-day issuer attestation of the legacy association,
        // not a claim that GitHub signed the historical backup.
        if (!Number.isSafeInteger(github.id) || github.id! < 1 || String(github.owner?.id) !== user.githubId
          || !Number.isFinite(created) || created > repo.createdAt.getTime()) {
          fail('its historical repository identity cannot be safely associated with the current GitHub repository.');
        }
        numericId = String(github.id);
      }
      const saved = await options.database.repository.updateMany({
        where: { id: repo.id, userId: user.id, fullName: repo.fullName, isBackedUp: true, isPrivate: false,
          githubNumericId: repo.githubNumericId, ckbCellOutpoint: repo.ckbCellOutpoint,
          ckbTxHash: repo.ckbTxHash, lastBackupCid: repo.lastBackupCid, updatedAt: repo.updatedAt },
        data: { githubNumericId: numericId, ckbCellOutpoint: anchorOutpoint,
          // Metadata recovery must not change the displayed backup date.
          updatedAt: repo.updatedAt },
      });
      if (saved.count !== 1) fail('its backup changed during metadata recovery. Retry sync.');
    }));
  }
}
