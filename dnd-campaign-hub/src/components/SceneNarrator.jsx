// Calls the Claude API to generate atmospheric scene narration for the current encounter.

import { useState } from 'react';
import { generateSceneDescription } from '../api/claude.js';

/**
 * @param {{
 *   monsters:        Array<{ monster: Object, count: number }>,
 *   party:           { size: number, level: number },
 *   setting:         string,
 *   scene:           string | null,
 *   isLoadingScene:  boolean,
 *   onSetScene:      (text: string) => void,
 *   onSetLoadingScene: (loading: boolean) => void,
 * }} props
 */
export default function SceneNarrator({
  monsters,
  party,
  setting,
  scene,
  isLoadingScene,
  onSetScene,
  onSetLoadingScene,
}) {
  const [error, setError] = useState(null);

  const isEmpty = monsters.length === 0;

  async function handleNarrate() {
    setError(null);
    onSetLoadingScene(true);

    try {
      // Flatten monster entries into a plain list the API prompt can use.
      const monsterList = monsters.flatMap(({ monster, count }) =>
        Array(count).fill(monster)
      );

      const text = await generateSceneDescription({
        monsters: monsterList,
        partySize: party.size,
        partyLevel: party.level,
        setting,
      });

      onSetScene(text);
    } catch (err) {
      setError(err.message);
    } finally {
      onSetLoadingScene(false);
    }
  }

  return (
    <section className="scene-narrator">
      <div className="scene-narrator__header">
        <h2 className="scene-narrator__heading">Scene Narration</h2>
        <button
          className="scene-narrator__btn"
          onClick={handleNarrate}
          disabled={isEmpty || isLoadingScene}
          title={isEmpty ? 'Add monsters to the encounter first' : 'Generate a scene description'}
        >
          {isLoadingScene ? 'Writing scene\u2026' : 'Narrate Scene'}
        </button>
      </div>

      {error && (
        <p className="scene-narrator__error" role="alert">
          {error}
        </p>
      )}

      {!error && scene && (
        <div className="scene-narrator__scene-wrap">
          {isLoadingScene && (
            <div className="scene-narrator__overlay">
              <span className="scene-narrator__overlay-text">Rewriting scene&#8230;</span>
            </div>
          )}
          <blockquote className={`scene-narrator__scene${isLoadingScene ? ' scene-narrator__scene--stale' : ''}`}>
            {scene}
          </blockquote>
        </div>
      )}

      {!error && isLoadingScene && !scene && (
        <p className="scene-narrator__empty">Writing scene&#8230;</p>
      )}

      {!error && !isLoadingScene && !scene && (
        <p className="scene-narrator__empty">
          {isEmpty
            ? 'Add monsters to the encounter, then click \u201cNarrate Scene\u201d.'
            : 'Click \u201cNarrate Scene\u201d to generate an atmospheric description.'}
        </p>
      )}
    </section>
  );
}
