import { randomUUID } from 'node:crypto';
import { ccc } from '@ckb-ccc/core';
import { findSpore } from '@ckb-ccc/spore';
import { Prisma, SovereignPassport } from '@prisma/client';
import { prisma, readWithConnectionRetry } from './db';
import { createTestnetClient } from './ckb-server';
import { parseJoyIdAddress } from './wallet-proof';
import { exportManifestProof } from './cota-manifest-service';
import { manifestIssuer, transactionJson } from './cota-manifest-config';
import { verifyManifestProofPackage, ManifestProofPackage } from './cota-manifest-verify';
import { buildPassportMint } from './passport-chain';
import { passportContent, verifyPassportOutput, validatePassportSignature } from './passport';

const transaction = (value: unknown) => ccc.Transaction.from(value as ccc.TransactionLike);
const enabled = () => process.env.PASSPORT_ENABLED === 'true';
async function account(githubId: string) {
  const user = await readWithConnectionRetry(() => prisma.user.findUnique({ where: { githubId } }));
  if (!user?.ckbAddress || !user.ckbAddressVerifiedAt) throw new Error('Verify your JoyID wallet before minting a passport.');
  return user;
}
async function refresh(passport: SovereignPassport, client: ccc.Client) {
  if (!passport.txHash || !passport.signedTransaction || passport.status === 'confirmed') return passport;
  const found = await client.getTransaction(passport.txHash);
  if (found?.status !== 'committed') return passport;
  const owner = (await ccc.Address.fromString(passport.ownerAddress, client)).script;
  verifyPassportOutput(found.transaction, owner, passport.content, passport.sporeId!, client);
  validatePassportSignature(transaction(passport.unsignedTransaction), found.transaction);
  return prisma.sovereignPassport.update({ where: { userId: passport.userId }, data: { status: 'confirmed' } });
}
function view(passport: SovereignPassport | null) {
  const tx = passport?.unsignedTransaction ? transaction(passport.unsignedTransaction) : null;
  const inputCapacity = tx?.inputs.reduce((sum, input) => sum + (input.cellOutput?.capacity || 0n), 0n) || 0n;
  const outputCapacity = tx?.outputs.reduce((sum, output) => sum + output.capacity, 0n) || 0n;
  return { enabled: enabled(), passport: passport ? { status: passport.status, sporeId: passport.sporeId,
    txHash: passport.txHash, manifestRoot: passport.manifestRoot, ownerAddress: passport.ownerAddress,
    transaction: passport.status === 'prepared' && !passport.signedTransaction ? passport.unsignedTransaction : null,
    capacityCKB: tx ? ccc.fixedPointToString(tx.outputs[0].capacity) : null,
    feeCKB: tx ? ccc.fixedPointToString(inputCapacity - outputCapacity) : null,
    explorerUrl: passport.txHash ? `https://pudge.explorer.nervos.org/transaction/${passport.txHash}` : null } : null };
}
export async function getPassport(githubId: string, client = createTestnetClient()) {
  const user = await account(githubId);
  const saved = await prisma.sovereignPassport.findUnique({ where: { userId: user.id } });
  return view(saved ? await refresh(saved, client) : null);
}
export async function preparePassport(githubId: string, client = createTestnetClient()) {
  if (!enabled()) throw new Error('Passport minting is not enabled.');
  const user = await account(githubId);
  const existing = await prisma.sovereignPassport.findUnique({ where: { userId: user.id } });
  if (existing) {
    if (existing.status === 'building' && existing.updatedAt.getTime() < Date.now() - 300000) {
      await prisma.sovereignPassport.deleteMany({ where: { userId: user.id, status: 'building', txHash: null, buildToken: existing.buildToken } });
      return preparePassport(githubId, client);
    }
    return view(await refresh(existing, client));
  }
  const owner = (await parseJoyIdAddress(user.ckbAddress!, client)).script;
  const proof = await exportManifestProof(githubId, client) as ManifestProofPackage;
  const issuer = await manifestIssuer(client);
  const verified = await verifyManifestProofPackage(proof, { client, expectedIssuerLockHash: issuer.lock.hash() });
  if (verified.githubId !== githubId || verified.ownerLockHash !== owner.hash()) throw new Error('Passport manifest ownership differs from the verified wallet.');
  const content = passportContent(githubId, verified.githubUsername, proof);
  const buildToken = randomUUID();
  try {
    await prisma.sovereignPassport.create({ data: { userId: user.id, ownerAddress: user.ckbAddress!, ownerLockHash: owner.hash(),
      manifestRoot: verified.manifestRoot, manifestProof: proof as unknown as Prisma.InputJsonValue, content, status: 'building', buildToken } });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return getPassport(githubId, client);
    throw error;
  }
  try {
    const { tx, id } = await buildPassportMint(owner, content, client);
    const committed = await prisma.sovereignPassport.updateMany({ where: { userId: user.id, status: 'building', buildToken }, data: { status: 'prepared', sporeId: id,
      txHash: tx.hash(), unsignedTransaction: transactionJson(tx), buildToken: null } });
    if (committed.count !== 1) throw new Error('Passport preparation was replaced. Refresh the saved plan.');
  } catch (error) {
    // No transaction was signed or sent; releasing an unfinished build is safe.
    await prisma.sovereignPassport.deleteMany({ where: { userId: user.id, status: 'building', txHash: null, buildToken } });
    throw error;
  }
  return getPassport(githubId, client);
}
export async function submitPassport(githubId: string, signedLike?: ccc.TransactionLike, client = createTestnetClient()) {
  if (!enabled()) throw new Error('Passport minting is not enabled.');
  const user = await account(githubId);
  let saved = await prisma.sovereignPassport.findUnique({ where: { userId: user.id } });
  if (!saved?.unsignedTransaction || saved.ownerAddress !== user.ckbAddress) throw new Error('No passport mint is prepared for this wallet.');
  saved = await refresh(saved, client);
  if (saved.status === 'confirmed') return view(saved);
  if (!saved.signedTransaction) {
    if (!signedLike) throw new Error('Approve the saved passport in JoyID first.');
    const signed = transaction(signedLike);
    validatePassportSignature(transaction(saved.unsignedTransaction), signed);
    verifyPassportOutput(signed, (await parseJoyIdAddress(user.ckbAddress, client)).script, saved.content, saved.sporeId!, client);
    await client.sendTransactionDry(signed);
    // First valid candidate wins. Concurrent retries use precisely these bytes.
    await prisma.sovereignPassport.updateMany({ where: { userId: user.id, status: 'prepared', signedTransaction: { equals: Prisma.DbNull } },
      data: { signedTransaction: transactionJson(signed), status: 'accepted' } });
    saved = (await prisma.sovereignPassport.findUnique({ where: { userId: user.id } }))!;
  }
  if (!saved.signedTransaction) throw new Error('Passport approval could not be saved.');
  const signed = transaction(saved.signedTransaction);
  const known = await client.getTransaction(saved.txHash!);
  if (!known || !['pending', 'proposed', 'committed'].includes(known.status)) {
    // Network ambiguity never constructs a replacement transaction.
    const hash = await client.sendTransaction(signed);
    if (hash !== saved.txHash) throw new Error('Passport broadcast returned an unexpected hash.');
  }
  await prisma.sovereignPassport.updateMany({ where: { userId: user.id, status: 'accepted' }, data: { status: 'submitted' } });
  return getPassport(githubId, client);
}
export async function verifyLivePassport(saved: SovereignPassport, client = createTestnetClient()) {
  const minted = await client.getTransaction(saved.txHash!);
  if (minted?.status !== 'committed') throw new Error('Passport mint is not confirmed.');
  const owner = (await ccc.Address.fromString(saved.ownerAddress, client)).script;
  verifyPassportOutput(minted.transaction, owner, saved.content, saved.sporeId!, client);
  const live = await findSpore(client, saved.sporeId!);
  const current = live ? await client.getCellLiveNoCache(live.cell.outPoint, true) : undefined;
  return { sporeId: saved.sporeId!, mintTxHash: saved.txHash!, manifestRoot: saved.manifestRoot,
    ownedByLinkedWallet: !!current?.cellOutput.lock.eq(owner), live: !!current,
    explorerUrl: `https://pudge.explorer.nervos.org/transaction/${saved.txHash}` };
}
