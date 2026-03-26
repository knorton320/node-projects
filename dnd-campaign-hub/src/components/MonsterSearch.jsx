import { useState, useEffect, useRef } from 'react';
import { getMonsterListByCR, getMonster } from '../api/dnd5e.js';
import { formatCR } from '../utils/formatCR.js';

export default function MonsterSearch({ crRange, onAddMonster }) {
  const [stubs, setStubs]       = useState([]);   // lightweight list from API
  const [query, setQuery]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [adding, setAdding]     = useState(null); // index of monster being fetched
  const [error, setError]       = useState(null);
  const debounceRef             = useRef(null);

  // Re-fetch the stub list whenever crRange changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getMonsterListByCR(crRange.min, crRange.max)
      .then((results) => { if (!cancelled) setStubs(results); })
      .catch((err)    => { if (!cancelled) setError(err.message); })
      .finally(()     => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [crRange.min, crRange.max]);

  // Debounced search filter — runs client-side against the stub list
  const [filtered, setFiltered] = useState([]);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const q = query.trim().toLowerCase();
      setFiltered(q ? stubs.filter((s) => s.name.toLowerCase().includes(q)) : stubs);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, stubs]);

  async function handleAdd(stub) {
    setAdding(stub.index);
    try {
      const fullMonster = await getMonster(stub.index); // cached after first fetch
      onAddMonster(fullMonster);
    } catch (err) {
      setError(`Failed to load ${stub.name}: ${err.message}`);
    } finally {
      setAdding(null);
    }
  }

  return (
    <section className="monster-search">
      <h2 className="monster-search__heading">Monster Search</h2>

      <input
        className="monster-search__input"
        type="text"
        placeholder="Filter by name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search monsters by name"
      />

      {error && <p className="monster-search__error" role="alert">{error}</p>}

      {loading ? (
        <p className="monster-search__status">Loading monsters…</p>
      ) : (
        <ul className="monster-search__list">
          {filtered.map((stub) => (
            <li key={stub.index} className="monster-search__row">
              <span className="monster-search__name">{stub.name}</span>
              <span className="monster-search__cr">CR {formatCR(stub.challenge_rating)}</span>
              <button
                className="monster-search__add-btn"
                onClick={() => handleAdd(stub)}
                disabled={adding === stub.index}
                aria-label={`Add ${stub.name} to encounter`}
              >
                {adding === stub.index ? '…' : '+'}
              </button>
            </li>
          ))}
          {!filtered.length && !loading && (
            <li className="monster-search__empty">No monsters match.</li>
          )}
        </ul>
      )}
    </section>
  );
}