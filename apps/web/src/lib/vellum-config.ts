import { ccc } from '@ckb-ccc/core';
import { argsToDid, didToArgs } from '@ckb-ccc/did-ckb';
import type { ClaimScriptConfigLike } from '@usevellum/sdk';

export const RIVET_BACKUP_SCHEMA_ID = 'rivet.repository-backup.v1' as const;
export const RIVET_BACKUP_SCHEMA_HASH = '0x53165e4ecfb86396f39b777bd7dca5b15994ae5ae2c330f0a4e49b733ab1b780' as const;

const CLAIM_DEPLOYMENT_TX = '0xaf693346282063a5d51f79d180fc807cdba1b8ac9d7af30085ff0aa190e2686c';
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function scriptInfo(codeHash: ccc.Hex, index: number): ccc.ScriptInfoLike {
  return {
    codeHash,
    hashType: 'type',
    cellDeps: [{ cellDep: { outPoint: { txHash: CLAIM_DEPLOYMENT_TX, index }, depType: 'code' } }],
  };
}

export const vellumClaimScripts = {
  claimType: scriptInfo('0xfb2757e524b3f83161d8b85b8b3e00186e2019ff04f5dfe833c5a72731e13157', 0),
  didLock: scriptInfo('0xe1562cc57b4bd91619ada2f7e74d63805ea7038a7b6de0b18a529d51aa883d2d', 1),
} satisfies ClaimScriptConfigLike;

type Environment = Record<string, string | undefined>;
export type VellumIssuerConfiguration = { enabled: false } | {
  enabled: true;
  issuerDid: string;
  issuerPrivateKey: ccc.Hex;
  minimumConfirmations: number;
};

export class VellumConfigurationError extends Error {}

export function vellumIssuerConfiguration(environment: Environment = process.env): VellumIssuerConfiguration {
  const enabled = environment.RIVET_VELLUM_ISSUER_ENABLED?.trim();
  if (!enabled || enabled === 'false' || enabled === '0') return { enabled: false };
  if (enabled !== 'true' && enabled !== '1') {
    throw new VellumConfigurationError('RIVET_VELLUM_ISSUER_ENABLED must be true or false.');
  }
  const issuerDid = environment.RIVET_VELLUM_ISSUER_DID?.trim();
  let canonicalIssuerDid = '';
  try { if (issuerDid) canonicalIssuerDid = argsToDid(didToArgs(issuerDid)); }
  catch { canonicalIssuerDid = ''; }
  if (!issuerDid || canonicalIssuerDid !== issuerDid) {
    throw new VellumConfigurationError('The Rivet Vellum issuer DID is not configured.');
  }
  const privateKey = environment.RIVET_VELLUM_ISSUER_CKB_PRIVATE_KEY?.trim();
  if (!privateKey || !PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new VellumConfigurationError('The Rivet Vellum issuer credential is not configured.');
  }
  const confirmationText = environment.RIVET_VELLUM_MIN_CONFIRMATIONS?.trim();
  if (!confirmationText || !/^[1-9][0-9]{0,2}$/.test(confirmationText) || Number(confirmationText) > 100) {
    throw new VellumConfigurationError('RIVET_VELLUM_MIN_CONFIRMATIONS must be an integer from 1 through 100.');
  }
  return {
    enabled: true,
    issuerDid: canonicalIssuerDid,
    issuerPrivateKey: privateKey.toLowerCase() as ccc.Hex,
    minimumConfirmations: Number(confirmationText),
  };
}

function publicUrl(value: string | undefined, fallback: string): string {
  let parsed: URL;
  try { parsed = new URL(value?.trim() || fallback); }
  catch { throw new VellumConfigurationError('A configured Vellum URL is invalid.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new VellumConfigurationError('Configured Vellum URLs must be public HTTPS origins.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function vellumPublicUrls(environment: Environment = process.env) {
  return {
    api: publicUrl(environment.VELLUM_API_URL, 'https://dashboard.usevellum.xyz'),
    profile: publicUrl(environment.VELLUM_PROFILE_URL, 'https://usevellum.xyz'),
  };
}
