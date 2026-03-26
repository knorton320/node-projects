// Displays the current encounter composition: monster list with count controls,
// and an XP summary with a colour-coded difficulty badge.

import { getXPMultiplier } from '../utils/xpCalculator.js';

/** Maps difficulty label → CSS class suffix for the badge colour. */
const DIFFICULTY_CLASS = {
  Trivial: 'trivial',
  Easy:    'easy',
  Medium:  'medium',
  Hard:    'hard',
  Deadly:  'deadly',
};

/** Format fractional CRs as readable strings. */
function formatCR(cr) {
  if (cr === 0.125) return '1/8';
  if (cr === 0.25)  return '1/4';
  if (cr === 0.5)   return '1/2';
  return String(cr);
}

/**
 * @param {{
 *   monsters: Array<{ monster: Object, count: number }>,
 *   derived:  { totalXP: number, adjustedXP: number, difficulty: string },
 *   onRemoveMonster:   (i: number) => void,
 *   onIncrementCount:  (i: number) => void,
 *   onDecrementCount:  (i: number) => void,
 * }} props
 */
export default function EncounterTray({
  monsters,
  derived,
  onRemoveMonster,
  onIncrementCount,
  onDecrementCount,
}) {
  const { totalXP, adjustedXP, difficulty } = derived;
  const totalMonsterCount = monsters.reduce((sum, { count }) => sum + count, 0);
  const multiplier = getXPMultiplier(totalMonsterCount);

  return (
    <section className="encounter-tray">
      <h2 className="encounter-tray__heading">Encounter Tray</h2>

      {/* Monster list */}
      {monsters.length === 0 ? (
        <p className="encounter-tray__empty">
          No monsters added yet. Search and add monsters on the left.
        </p>
      ) : (
        <ul className="encounter-tray__list">
          {monsters.map(({ monster, count }, i) => (
            <li key={monster.index} className="encounter-tray__row">
              <div className="encounter-tray__monster-info">
                <span className="encounter-tray__name">{monster.name}</span>
                <span className="encounter-tray__stat">HP {monster.hit_points}</span>
                <span className="encounter-tray__stat">AC {monster.armor_class?.[0]?.value ?? monster.armor_class}</span>
                <span className="encounter-tray__stat">CR {formatCR(monster.challenge_rating)}</span>
                <span className="encounter-tray__stat encounter-tray__stat--xp">
                  {(monster.xp ?? 0).toLocaleString()} XP ea.
                </span>
              </div>

              <div className="encounter-tray__controls">
                <button
                  className="encounter-tray__btn encounter-tray__btn--count"
                  onClick={() => onDecrementCount(i)}
                  aria-label={`Remove one ${monster.name}`}
                >
                  −
                </button>
                <span className="encounter-tray__count">{count}</span>
                <button
                  className="encounter-tray__btn encounter-tray__btn--count"
                  onClick={() => onIncrementCount(i)}
                  aria-label={`Add one ${monster.name}`}
                >
                  +
                </button>
                <button
                  className="encounter-tray__btn encounter-tray__btn--remove"
                  onClick={() => onRemoveMonster(i)}
                  aria-label={`Remove ${monster.name} from encounter`}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* XP summary */}
      <div className="encounter-tray__summary">
        <div className="encounter-tray__xp-row">
          <span className="encounter-tray__xp-label">Raw XP</span>
          <span className="encounter-tray__xp-value">{totalXP.toLocaleString()}</span>
        </div>
        <div className="encounter-tray__xp-row">
          <span className="encounter-tray__xp-label">Multiplier</span>
          <span className="encounter-tray__xp-value">×{multiplier}</span>
        </div>
        <div className="encounter-tray__xp-row">
          <span className="encounter-tray__xp-label">Adjusted XP</span>
          <span className="encounter-tray__xp-value encounter-tray__xp-value--total">
            {adjustedXP.toLocaleString()}
          </span>
        </div>
        <div className="encounter-tray__xp-row">
          <span className="encounter-tray__xp-label">Difficulty</span>
          <span className={`encounter-tray__difficulty encounter-tray__difficulty--${DIFFICULTY_CLASS[difficulty] ?? 'trivial'}`}>
            {difficulty}
          </span>
        </div>
      </div>
    </section>
  );
}
