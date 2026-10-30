import { prisma } from './db';
import { exportManifestProof } from './cota-manifest-service';
import { manifestIssuer } from './cota-manifest-config';
import { verifyManifestProofPackage } from './cota-manifest-verify';
import { createTestnetClient } from './ckb-server';
import { verifyLivePassport } from './passport-service';

/** Only public profiles may export public identity references. No keys or private repos. */
export async function publicIdentity(username: string, client = createTestnetClient()) {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) return null;
  const user = await prisma.user.findFirst({ where: { githubUsername: username, isProfilePublic: true }, include: { cotaManifestEnrollment: true, cotaRegistration: true } });
  if (!user?.isProfilePublic || !user.ckbAddressVerifiedAt || user.cotaManifestEnrollment?.status !== 'claimed'
    || user.cotaRegistration?.status !== 'confirmed' || user.cotaRegistration.address !== user.ckbAddress) return null;
  const proof = await exportManifestProof(user.githubId, client);
  const issuer = await manifestIssuer(client);
  const manifest = await verifyManifestProofPackage(proof, { client, expectedIssuerLockHash: issuer.lock.hash() });
  const saved = await prisma.sovereignPassport.findUnique({ where: { userId: user.id } });
  let passport = null, passportStatus = saved?.status || null;
  if (saved?.signedTransaction && saved.txHash) {
    try { passport = await verifyLivePassport(saved, client); passportStatus = 'verified'; }
    catch { passportStatus = 'unavailable'; }
  }
  return { proof, manifest, passport, passportStatus };
}
