import { retryRead, delay } from './retry.mjs';

/** A saved signed transaction is the unit of recovery. Never rebuild after a send timeout. */
export async function submitSavedTransaction({ txHash, lookup, broadcast, wait = delay, polls = 20 }) {
  let known = await retryRead(lookup);
  if (known?.status === 'rejected') throw new Error('Saved transaction was rejected. Reconcile its inputs before starting another job.');
  if (!known) {
    try {
      const sent = await broadcast();
      if (sent !== txHash) throw new Error('Transaction submission returned an unexpected hash.');
    } catch (error) {
      known = await retryRead(lookup);
      if (!known) throw new Error('Transaction submission is uncertain. Keep the saved job and retry it; do not create a replacement transaction.', { cause: error });
    }
  }
  for (let poll = 0; poll < polls; poll++) {
    known = await retryRead(lookup);
    if (known?.status === 'committed') return known;
    if (known?.status === 'rejected') throw new Error('Saved transaction was rejected. Reconcile its inputs before starting another job.');
    await wait(3000);
  }
  throw new Error('Transaction is still pending. Keep the saved job and retry it; do not create a replacement transaction.');
}
