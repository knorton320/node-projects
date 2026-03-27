// Utility functions for D&D 5e encounter XP calculations.
// Computes adjusted XP using monster multipliers and determines encounter difficulty.
// Source: D&D 5e Dungeon Master's Guide, pp. 82–84.

import xpThresholds from '../data/xpThresholds.js';

/**
 * Returns a suggested CR range for monsters appropriate to a given party level.
 * Based on the general guideline that a CR equal to party level is a hard fight,
 * and CR = level - 4 is typically easy. Clamped to valid CR values (0.125–20).
 *
 * @param {number} partyLevel - The average character level of the party (1–20).
 * @returns {{ min: number, max: number }} The minimum and maximum suggested CR.
 *
 * @example
 * getMonsterCRRange(1)  // => { min: 0.125, max: 1 }
 * getMonsterCRRange(5)  // => { min: 1, max: 5 }
 * getMonsterCRRange(10) // => { min: 6, max: 10 }
 * getMonsterCRRange(20) // => { min: 16, max: 20 }
 */
export function getMonsterCRRange(partyLevel) {
  const min = Math.max(0.125, partyLevel - 4);
  const max = Math.min(20, partyLevel);
  return { min, max };
}

/**
 * Returns the D&D 5e encounter XP multiplier based on the total number of monsters.
 * Used to compute "adjusted XP" that reflects the difficulty of facing multiple enemies.
 * Source: DMG p. 82, "Modify Total XP for Multiple Monsters" table.
 *
 * @param {number} totalMonsterCount - Total number of monsters in the encounter.
 * @returns {number} The XP multiplier (1, 1.5, 2, 2.5, 3, or 4).
 *
 * @example
 * getXPMultiplier(1)  // => 1
 * getXPMultiplier(2)  // => 1.5
 * getXPMultiplier(3)  // => 2
 * getXPMultiplier(6)  // => 2
 * getXPMultiplier(7)  // => 2.5
 * getXPMultiplier(10) // => 2.5
 * getXPMultiplier(11) // => 3
 * getXPMultiplier(14) // => 3
 * getXPMultiplier(15) // => 4
 * getXPMultiplier(20) // => 4
 */
export function getXPMultiplier(totalMonsterCount) {
  if (totalMonsterCount <= 0) return 1;
  if (totalMonsterCount === 1) return 1;
  if (totalMonsterCount === 2) return 1.5;
  if (totalMonsterCount <= 6) return 2;
  if (totalMonsterCount <= 10) return 2.5;
  if (totalMonsterCount <= 14) return 3;
  return 4;
}

/**
 * Determines the difficulty label of an encounter given its adjusted XP total.
 * Computes the per-player adjusted XP and compares it against the DMG threshold table.
 *
 * @param {number} adjustedXP - Total adjusted XP for the encounter (raw XP × multiplier).
 * @param {number} partySize  - Number of player characters in the party.
 * @param {number} partyLevel - Average character level of the party (1–20).
 * @returns {"Trivial" | "Easy" | "Medium" | "Hard" | "Deadly"} The difficulty rating.
 *
 * @example
 * // Party of 4 level-5 players; thresholds per player: easy=250, medium=500, hard=750, deadly=1100
 * getDifficulty(800,  4, 5) // => "Trivial"  (800  / 4 = 200  < easy 250)
 * getDifficulty(1200, 4, 5) // => "Easy"     (1200 / 4 = 300  >= easy 250, < medium 500)
 * getDifficulty(2200, 4, 5) // => "Medium"   (2200 / 4 = 550  >= medium 500, < hard 750)
 * getDifficulty(3200, 4, 5) // => "Hard"     (3200 / 4 = 800  >= hard 750, < deadly 1100)
 * getDifficulty(5000, 4, 5) // => "Deadly"   (5000 / 4 = 1250 >= deadly 1100)
 */
export function getDifficulty(adjustedXP, partySize, partyLevel) {
  const clampedLevel = Math.max(1, Math.min(20, partyLevel));
  const thresholds = xpThresholds[clampedLevel];
  const xpPerPlayer = adjustedXP / partySize;

  if (xpPerPlayer < thresholds.easy) return 'Trivial';
  if (xpPerPlayer < thresholds.medium) return 'Easy';
  if (xpPerPlayer < thresholds.hard) return 'Medium';
  if (xpPerPlayer < thresholds.deadly) return 'Hard';
  return 'Deadly';
}