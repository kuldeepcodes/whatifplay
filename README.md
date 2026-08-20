# The Floor Is...

A colorful, instantly playable browser party game where the arena changes its mind every 20 seconds.

## Setup

```bash
npm install
npm run dev
```

Open the local URL, choose a look, and press **Play now**. No account or backend is required.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | WASD or arrow keys | Left thumb stick |
| Jump / dodge | Space | Jump button |
| Grab / throw | E | Grab button |
| Emote | Q | Emote button |
| Pause / help | Esc or P | Pause button |

Browser scrolling and pinch gestures are disabled only while interacting with the game controls.

## Rules

The director gives a visible 3-2-1 warning before switching between:

- **Floor is Lava** - reach raised safe zones before the floor burns.
- **Tidal Trouble** - the arena floods; movement slows and dry platforms matter.
- **Ghost Rush** - spectral pursuers hunt the closest survivor.
- **Deep Freeze** - acceleration becomes slippery and stopping takes planning.
- **Chicken Attack** - chaotic chickens swarm and bump the player.
- **Piano Panic** - warning shadows mark where giant pianos will land.
- **Frog Mode** - movement becomes springy, green, and jump-focused.

Grab and throw arena props, collect stars, discover the hidden cove, and survive a five-minute run. Character color and accessory choices persist in local storage.

## Make the Rule

The landing screen can create a safe custom challenge using supported modifiers: tiny player, backwards controls, jump-only movement, super speed, extra chickens, and low gravity. Challenges can be played immediately, saved locally, or copied as a compact URL. Links are validated and malformed challenge data is ignored safely.

Challenge links are an honest asynchronous friend mode: there is no fake network multiplayer. The game is architected around isolated rule lifecycles so online rooms can be added later without changing core rule logic.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Deployment

`.github/workflows/deploy-pages.yml` builds and deploys the static `dist/` directory to GitHub Pages. Vite uses `/whatifplay/` on production builds and `/` during local development.

## MVP scope

This release is a polished single-device solo party game with shareable challenges. Online rooms, accounts, matchmaking, and authoritative multiplayer simulation are intentionally out of scope.