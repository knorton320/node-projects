// Custom React hook for managing encounter state via useReducer.
// Exposes action dispatchers and derived encounter values (XP, difficulty, CR range).

import { useReducer, useMemo } from 'react';
import {
  getMonsterCRRange,
  getXPMultiplier,
  getDifficulty,
} from '../utils/xpCalculator.js';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState = {
  party: { size: 4, level: 7 },
  setting: 'Forest',
  monsters: [], // Array<{ monster: Object, count: number }>
  scene: null,
  isLoadingScene: false,
};

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

const SET_PARTY          = 'SET_PARTY';
const SET_SETTING        = 'SET_SETTING';
const ADD_MONSTER        = 'ADD_MONSTER';
const REMOVE_MONSTER     = 'REMOVE_MONSTER';
const INCREMENT_COUNT    = 'INCREMENT_COUNT';
const DECREMENT_COUNT    = 'DECREMENT_COUNT';
const SET_SCENE          = 'SET_SCENE';
const SET_LOADING_SCENE  = 'SET_LOADING_SCENE';

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function encounterReducer(state, action) {
  switch (action.type) {
    case SET_PARTY:
      return { ...state, party: { size: Math.max(1, Math.min(10, action.size || 4)), level: action.level } };

    case SET_SETTING:
      return { ...state, setting: action.setting };

    case ADD_MONSTER: {
      // If the same monster (by index) is already in the tray, increment its count.
      const existing = state.monsters.findIndex(
        (entry) => entry.monster.index === action.monster.index
      );
      if (existing !== -1) {
        const updated = state.monsters.map((entry, i) =>
          i === existing ? { ...entry, count: entry.count + 1 } : entry
        );
        return { ...state, monsters: updated };
      }
      return {
        ...state,
        monsters: [...state.monsters, { monster: action.monster, count: 1 }],
      };
    }

    case REMOVE_MONSTER:
      return {
        ...state,
        monsters: state.monsters.filter((_, i) => i !== action.monsterIndex),
      };

    case INCREMENT_COUNT:
      return {
        ...state,
        monsters: state.monsters.map((entry, i) =>
          i === action.monsterIndex ? { ...entry, count: entry.count + 1 } : entry
        ),
      };

    case DECREMENT_COUNT:
      return {
        ...state,
        monsters: state.monsters
          .map((entry, i) =>
            i === action.monsterIndex ? { ...entry, count: entry.count - 1 } : entry
          )
          // Remove entries that reach zero.
          .filter((entry) => entry.count > 0),
      };

    case SET_SCENE:
      return { ...state, scene: action.text };

    case SET_LOADING_SCENE:
      return { ...state, isLoadingScene: action.loading };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages all D&D encounter state and exposes action dispatchers plus
 * derived values computed from the current state.
 *
 * @returns {{ state: Object, dispatch: Object, derived: Object }}
 */
export function useEncounter() {
  const [state, rawDispatch] = useReducer(encounterReducer, initialState);

  // Stable action dispatcher object — functions are recreated only when
  // rawDispatch changes (i.e. never after mount).
  const dispatch = useMemo(() => ({
    setParty: (size, level) =>
      rawDispatch({ type: SET_PARTY, size, level }),

    setSetting: (setting) =>
      rawDispatch({ type: SET_SETTING, setting }),

    addMonster: (monsterObject) =>
      rawDispatch({ type: ADD_MONSTER, monster: monsterObject }),

    removeMonster: (monsterIndex) =>
      rawDispatch({ type: REMOVE_MONSTER, monsterIndex }),

    incrementCount: (monsterIndex) =>
      rawDispatch({ type: INCREMENT_COUNT, monsterIndex }),

    decrementCount: (monsterIndex) =>
      rawDispatch({ type: DECREMENT_COUNT, monsterIndex }),

    setScene: (text) =>
      rawDispatch({ type: SET_SCENE, text }),

    setLoadingScene: (loading) =>
      rawDispatch({ type: SET_LOADING_SCENE, loading }),
  }), [rawDispatch]);

  // Derived values — recomputed only when monsters or party changes.
  const derived = useMemo(() => {
    const { monsters, party } = state;

    const totalXP = monsters.reduce(
      (sum, { monster, count }) => sum + (monster.xp ?? 0) * count,
      0
    );

    const totalMonsterCount = monsters.reduce((sum, { count }) => sum + count, 0);
    const multiplier = getXPMultiplier(totalMonsterCount);
    const adjustedXP = Math.floor(totalXP * multiplier);

    const difficulty =
      totalMonsterCount === 0
        ? 'Trivial'
        : getDifficulty(adjustedXP, party.size, party.level);

    const crRange = getMonsterCRRange(party.level);

    return { totalXP, adjustedXP, difficulty, crRange };
  }, [state.monsters, state.party]);

  return { state, dispatch, derived };
}
