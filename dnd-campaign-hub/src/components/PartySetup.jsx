// Party configuration bar rendered at the top of the right column.
// Controls party size, average level, and encounter setting; shows the suggested CR range.

const SETTINGS = [
  'Forest',
  'Dungeon',
  'Cave',
  'City',
  'Desert',
  'Ocean',
  'Tundra',
  'Underdark',
];

/**
 * @param {{ party: {size: number, level: number}, setting: string,
 *           crRange: {min: number, max: number},
 *           onSetParty: (size: number, level: number) => void,
 *           onSetSetting: (setting: string) => void }} props
 */
export default function PartySetup({ party, setting, crRange, onSetParty, onSetSetting }) {
  function handleSize(e) {
    onSetParty(Number(e.target.value), party.level);
  }

  function handleLevel(e) {
    onSetParty(party.size, Number(e.target.value));
  }

  function handleSetting(e) {
    onSetSetting(e.target.value);
  }

  // Format CR fractions for display (0.125 => "1/8", 0.25 => "1/4", 0.5 => "1/2")
  function formatCR(cr) {
    if (cr === 0.125) return '1/8';
    if (cr === 0.25)  return '1/4';
    if (cr === 0.5)   return '1/2';
    return String(cr);
  }

  return (
    <div className="party-setup">
      <label className="party-setup__field">
        <span className="party-setup__label">Party Size</span>
        <input
          className="party-setup__input"
          type="number"
          min={1}
          max={10}
          value={party.size}
          onChange={handleSize}
        />
      </label>

      <label className="party-setup__field">
        <span className="party-setup__label">Avg Level</span>
        <input
          className="party-setup__input"
          type="number"
          min={1}
          max={20}
          value={party.level}
          onChange={handleLevel}
        />
      </label>

      <label className="party-setup__field">
        <span className="party-setup__label">Setting</span>
        <select
          className="party-setup__select"
          value={setting}
          onChange={handleSetting}
        >
          {SETTINGS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>

      <span className="party-setup__cr-badge">
        Suggested CR: {formatCR(crRange.min)}&ndash;{formatCR(crRange.max)}
      </span>
    </div>
  );
}
