# D&D Campaign Hub

A browser-based encounter builder for Dungeons & Dragons 5th Edition. Search the full SRD monster catalog, assemble encounters with automatic XP and difficulty calculations, and generate atmospheric scene narration powered by Claude AI.

## Features

**Monster Search & Filtering** — Browse monsters from the [D&D 5e SRD API](https://www.dnd5eapi.co) filtered to a suggested Challenge Rating range based on your party's level. Search by name with debounced client-side filtering. Results are cached in-memory to minimize API calls.

**Encounter Tray** — Add monsters to an encounter tray, adjust individual creature counts, and see per-monster stats at a glance (HP, AC, CR, XP). The tray calculates raw XP, applies the DMG's multi-monster multiplier, and displays adjusted XP with a color-coded difficulty badge (Trivial / Easy / Medium / Hard / Deadly).

**Party Configuration** — Set party size (1–10), average level (1–20), and encounter setting (Forest, Dungeon, Cave, City, Desert, Ocean, Tundra, Underdark). The suggested CR range and difficulty thresholds update automatically.

**AI Scene Narration** — Click "Narrate Scene" to generate an immersive, atmospheric description of the encounter moment using the Anthropic Messages API (Claude Haiku 4.5). The narration incorporates the selected setting, party composition, and monsters without referencing any game mechanics.

## Tech Stack

- **React 19** with functional components and hooks
- **Vite 8** for dev server and production builds
- **D&D 5e API** (`dnd5eapi.co`) for monster data
- **Anthropic Messages API** for AI scene generation
- **Vanilla CSS** with BEM-style class naming and a dark parchment theme
- **ESLint 9** with React Hooks and React Refresh plugins

## Project Structure

```
├── index.html                  # HTML entry point
├── public/
│   ├── favicon.svg             # App icon
│   └── icons.svg               # SVG icon sprite
├── src/
│   ├── main.jsx                # React root mount
│   ├── App.jsx                 # Top-level layout (two-column grid)
│   ├── App.css                 # All component styles (BEM)
│   ├── index.css               # Body reset
│   ├── api/
│   │   ├── claude.js           # Anthropic API client — scene generation
│   │   └── dnd5e.js            # D&D 5e API client — monster fetching with cache
│   ├── components/
│   │   ├── MonsterSearch.jsx   # CR-filtered monster browser with search
│   │   ├── EncounterTray.jsx   # Encounter composition & XP summary
│   │   ├── PartySetup.jsx      # Party size / level / setting controls
│   │   └── SceneNarrator.jsx   # AI narration trigger & display
│   ├── hooks/
│   │   └── useEncounter.js     # useReducer-based state management
│   ├── data/
│   │   └── xpThresholds.js     # DMG XP threshold table (levels 1–20)
│   └── utils/
│       ├── xpCalculator.js     # CR range, XP multiplier, difficulty logic
│       └── formatCR.js         # Fractional CR display (1/8, 1/4, 1/2)
├── .env.example                # Environment variable template
├── eslint.config.js            # ESLint flat config
├── vite.config.js              # Vite configuration
└── package.json
```

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- An **Anthropic API key** (for scene narration)

### Installation

```bash
git clone <your-repo-url>
cd dnd-campaign-hub
npm install
```

### Environment Setup

Copy the example env file and add your API key:

```bash
cp .env.example .env
```

Edit `.env` and replace the placeholder with your real key:

```
VITE_ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

> **Note:** The `.env` file is gitignored and must never be committed. The app will throw a clear error if the key is missing.

### Development

```bash
npm run dev
```

Opens a local dev server with hot module replacement (default: `http://localhost:5173`).

### Production Build

```bash
npm run build
npm run preview   # preview the built output locally
```

### Linting

```bash
npm run lint
```

## How It Works

### Encounter Difficulty Calculation

XP math follows the **Dungeon Master's Guide** (pp. 82–84):

1. Sum the XP value of every monster in the encounter (raw XP).
2. Apply a multiplier based on total monster count (×1 for a single monster up to ×4 for 15+).
3. Divide adjusted XP by party size and compare against the per-player threshold table to determine difficulty.

### Monster CR Range

The suggested CR range is derived from party level: the floor is `level − 4` (clamped to CR 1/8) and the ceiling is the party's level (clamped to CR 20). The monster search panel auto-fetches all SRD monsters within this range.

### Scene Narration

The narration prompt sends the encounter setting, party composition, and monster names to Claude Haiku 4.5 with a system prompt tuned for atmospheric, mechanic-free prose. Responses are limited to 300 tokens to keep descriptions concise.

## API Security Note

The Anthropic API key is exposed to the browser via Vite's `VITE_` env prefix. This is acceptable for local development and personal use. For a publicly deployed version, you would want to proxy API calls through a backend to keep the key server-side.

## License

This project is unlicensed / private. Add a LICENSE file if you plan to distribute it.
