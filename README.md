# allan_bot

Discord bot for Candy SMP: party games, leveling, a virtual economy, trivia, and alerts when friendslop games go on sale.

## Features

| Area | Commands |
| --- | --- |
| **Party games** (existing) | `/game` (Imposter / Mafia / Wavelength), `/gameover`, `/categories`, plus `$game` in the game channel |
| **Leveling & XP** | `/rank`, `/leaderboard`, `/levelrole add/remove/list/mode`, `/xpadmin give/reset` |
| **Economy & shop** | `/balance`, `/daily`, `/pay`, `/shop`, `/buy`, `/inventory`, `/use`, `/gift`, `/shopadmin`, `/economy give` |
| **Gambling** | `/coinflip`, `/slots`, `/blackjack` |
| **Minigames** | `/trivia`, `/triviastop`, `/scramble`, `/poll` |
| **Friendslop deals** | `/deals now/list/add/remove/setup/check` |

### How it works

- **XP from chat:** 15–25 XP per message, at most once a minute per person. Curve is MEE6-style (`5L² + 50L + 100` XP per level).
- **XP from voice:** 10 XP and 1 🍬 per minute, only when at least 2 people are in the channel and you aren't deafened. The AFK channel doesn't count.
- **Tier roles:** `/levelrole add level:10 role:@Regular`. By default members keep only their highest tier; `/levelrole mode stack:true` lets them keep every tier.
- **Currency:** earned from chatting, voice time, `/daily` (200 + 25 per streak day, capped at 7), level-ups, trivia and scramble wins.
- **Shop:** ships with an ⚡ XP Boost (2× XP for an hour) and some collectibles. Admins can add role items: `/shopadmin add name:VIP price:5000 role:@VIP`.
- **Gambling:** virtual currency only. Slots are tuned to about 95% return. Max bet and a short cooldown are configurable.
- **Trivia:** questions from [Open Trivia DB](https://opentdb.com), with a built-in question bank if the API is down. Everyone gets one answer per question; faster correct answers score more.
- **Polls:** uses Discord's native polls (the bot needs the **Send Polls** permission).
- **Deals:** checks Steam prices every 6 hours for a starter list of 16 friendslop games (Lethal Company, R.E.P.O., PEAK, Content Warning, Phasmophobia, Among Us, YAPYAP, and more) and posts when one goes on sale or gets a deeper discount. Run `/deals setup channel:#deals ping:@Gamers` once.

Data is saved to `data/store.json` with atomic writes and a `.bak` copy.

## Hosting on bot-hosting.net

1. **Discord Developer Portal** → your app → **Bot**: turn on **Server Members Intent** and **Message Content Intent**. Copy the token.
2. Make sure the bot's role is **above** any roles it should hand out (tier roles, shop roles, Candy/Visitor).
3. On [bot-hosting.net](https://bot-hosting.net), create a **Node.js / JavaScript** server.
4. Get the code onto the server (pick one):
   - **Git (easiest to update):** in the **Startup** tab set the git repo to `https://github.com/allandng/allan_bot` and the branch to `main`. For a private repo also fill in your GitHub username and a personal access token. Then clear the files and hit **Reinstall Server**. Afterwards, pushing to GitHub and restarting pulls the new code.
   - **Upload:** zip the repo **without** `node_modules`, upload it in the File Manager, then use the ⋮ menu → **Unarchive**.
5. In the File Manager create a `.env` file (copy `.env.example`) and set at least:
   ```
   TOKEN=your-bot-token
   GUILD_ID=your-server-id
   ```
   `GUILD_ID` makes slash commands show up instantly instead of taking up to an hour.
6. **Startup** tab: leave the main/bot file as `index.js` (the root `index.js` starts `src/index.js`). If there's a Node version or Docker image option, pick the newest available (Node 18.17+ is required).
7. Start the server. The host installs dependencies from `package.json` automatically. You should see `✅ allan_bot#xxxx is online` and `Registered 25 slash commands`.

Keep an eye on your coin balance on bot-hosting.net so the server doesn't get suspended.

## Running locally

```bash
npm install
cp .env.example .env   # add TOKEN and GUILD_ID
npm start
npm test               # unit + command tests, no Discord connection needed
```

`npm run send-roles` posts the old Candy/Visitor button message (one-off).

## Project layout

```
index.js                 entry shim for hosts that default to index.js
src/index.js             client, slash-command registry, interaction router
src/config.js            all settings (overridable via .env)
src/lib/db.js            JSON data store
src/game.js              Imposter / Mafia / Wavelength
src/features/leveling.js XP, voice tracking, tier roles, leaderboards
src/features/economy.js  balance, daily, shop, inventory
src/features/gambling.js coinflip, slots, blackjack
src/features/trivia.js   trivia, scramble, polls
src/features/deals.js    Steam friendslop price watcher
src/data/                trivia fallback questions, scramble words, friendslop list
```

To add a feature, create a module exporting `{ name, commands, onCommand }` (plus optional `setup`, `onComponent` with `componentPrefix`, `onAutocomplete`) and add it to the `modules` array in `src/index.js`.
