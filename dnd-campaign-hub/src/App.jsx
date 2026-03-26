import './App.css';
import { useEncounter } from './hooks/useEncounter.js';
import MonsterSearch from './components/MonsterSearch.jsx';
import EncounterTray from './components/EncounterTray.jsx';
import PartySetup from './components/PartySetup.jsx';
import SceneNarrator from './components/SceneNarrator.jsx';

export default function App() {
  const { state, dispatch, derived } = useEncounter();

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">&#9876; D&amp;D Campaign Hub</h1>
      </header>

      <div className="app-body">
        {/* Left column — monster browser */}
        <aside className="column column--left">
          <MonsterSearch
            crRange={derived.crRange}
            onAddMonster={dispatch.addMonster}
          />
        </aside>

        {/* Right column — party config + encounter tray + narrator */}
        <main className="column column--right">
          <PartySetup
            party={state.party}
            setting={state.setting}
            crRange={derived.crRange}
            onSetParty={dispatch.setParty}
            onSetSetting={dispatch.setSetting}
          />

          <EncounterTray
            monsters={state.monsters}
            derived={derived}
            onRemoveMonster={dispatch.removeMonster}
            onIncrementCount={dispatch.incrementCount}
            onDecrementCount={dispatch.decrementCount}
          />

          <SceneNarrator
            monsters={state.monsters}
            party={state.party}
            setting={state.setting}
            scene={state.scene}
            isLoadingScene={state.isLoadingScene}
            onSetScene={dispatch.setScene}
            onSetLoadingScene={dispatch.setLoadingScene}
          />
        </main>
      </div>
    </div>
  );
}
