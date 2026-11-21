# Phase Two — Production readiness and private backups

Status — November 21, 2026: funded Phase One implementation and project acceptance are complete. The [milestone checklist](./PHASE_ONE_MILESTONES.md) and [Milestone 2 acceptance record](./MILESTONE_TWO_LIVE_ACCEPTANCE_2026-11-21.md) document the delivered testnet scope. Community/reviewer sign-off remains separate.

Phase Two is the remaining proposed production scope from the funded proposal discussion. Its funding, schedule, hosting provider, and implementation milestones still need agreement.

## Remaining scope

| Deliverable | Remaining work |
| --- | --- |
| Dedicated hosting and domain | Move public GitHub Actions workers to the chosen VPS or managed worker host; configure the production domain, monitoring, worker recovery, and deployment runbook. |
| Encrypted private repositories | Implement an authorized private-repository backup/restore path with private job transport and recovery-key handling. Current testnet backups remain restricted to pushed public GitHub history. |
| Durable storage | Define premium IPFS pinning, retention and availability targets, and prove recovery when a gateway or pin provider is unavailable. |
| Independent security review | Commission a third-party review of authentication, secret handling, worker isolation, recovery, transaction submission, and private backup support; address findings before mainnet rollout. |
| CKB Mainnet deployment | Define network-specific configuration, treasury/subsidy budgets, migration and recovery procedures, and publish independently verifiable mainnet acceptance evidence. |
| Maintenance and scaling | Agree ownership, operating costs, monitoring, incident response, and long-term maintenance. |

## Proposed delivery order

1. Agree Phase Two scope, funding, operating costs, and acceptance criteria.
2. Establish the chosen hosting/domain and reliable pinning, and verify worker restart and independent recovery.
3. Deliver and verify private backups with authenticated access and controlled key handling.
4. Complete the independent security review and resolve its findings.
5. Roll out mainnet with explicit spending limits, repeat backup/exact/attribution recovery, and publish delivery evidence.

The six-stage [product roadmap](./PHASES.md) is broader than these funded phases. Social features and the full platform remain future product work; this production plan does not claim that the entire roadmap is delivered.
