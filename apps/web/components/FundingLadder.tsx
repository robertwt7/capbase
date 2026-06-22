import type { FundingRound } from '../lib/data';
import { formatDate, formatUsd } from '../lib/format';

import styles from './FundingLadder.module.css';

interface FundingLadderProps {
  rounds: FundingRound[];
}

// The signature view: funding rounds are an ordered sequence, so we render them
// as a vertical ledger where each rung's bar width encodes the capital raised.
// Reading top to bottom traces the company's trajectory like a cap table.
export function FundingLadder({ rounds }: FundingLadderProps) {
  const max = Math.max(...rounds.map((r) => r.amountUsd));

  return (
    <ol className={styles.ladder}>
      {rounds.map((round, i) => {
        const width = Math.max(8, Math.round((round.amountUsd / max) * 100));
        return (
          <li key={round.name} className={styles.rung}>
            <div className={styles.spine} aria-hidden="true">
              <span className={styles.node} />
              {i < rounds.length - 1 && <span className={styles.thread} />}
            </div>

            <div className={styles.head}>
              <span className={styles.round}>{round.name}</span>
              <span className={styles.date}>{formatDate(round.date)}</span>
            </div>

            <div className={styles.track}>
              <div className={styles.bar} style={{ width: `${width}%` }}>
                <span className={styles.amount}>{formatUsd(round.amountUsd)}</span>
              </div>
            </div>

            <div className={styles.meta}>
              <span className={styles.post}>
                {round.postMoneyUsd ? formatUsd(round.postMoneyUsd) : '—'}
                <span className={styles.postLabel}>post-money</span>
              </span>
              {round.lead && <span className={styles.lead}>Led by {round.lead}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
