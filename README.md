# Nekron ⛩️ — Force Town Discord Bot

> Built for **Force Town** Discord server by **ForceLabs / ItzForcex1**

## Features

- 🌅 **7 AM Good Morning** — Daily Hinglish good morning message
- 🏆 **Daily Leaderboard** — Top chatters posted every night automatically  
- 💬 **Smart Chat** — Replies to first message, waits for user reply, responds once
- 🤖 **AI Chat (Hinglish)** — Mention @Nekron to chat with AI in Hinglish
- 💀 **Dead Chat Revive** — Auto detects silent chat and sends funny revival message
- 🎫 **Ticket System** — Private ticket channels for service orders
- ⚡ **XP + Level System** — Earn XP by chatting, level up with notifications
- 📢 **Announcement System** — Send announcements via slash command

## Slash Commands

| Command | Description |
|---------|-------------|
| `/set channel: type:` | Configure channels for bot features |
| `/send channel: message:` | Send announcement to any channel |
| `/ticket` | Open a service order ticket |
| `/rank` | View your XP rank |
| `/leaderboard` | Top 10 members |
| `/services` | View ForceLabs services |
| `/gm` | Manually send good morning |

## Setup

### 1. Discord Bot
1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. New Application → name it **Nekron**
3. Bot tab → Reset Token → copy it
4. Enable all 3 Privileged Intents (Presence, Server Members, Message Content)
5. OAuth2 → URL Generator → scopes: `bot` + `applications.commands`
6. Bot Permissions: Send Messages, Read Messages, Manage Channels, Embed Links, Read Message History, Use Slash Commands
7. Copy generated URL → add bot to your server

### 2. Deploy on Railway
1. Fork or upload this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select this repo
4. Go to **Variables** tab — Railway will auto-detect all variables from source code
5. Fill in all values (see below)
6. Deploy!

## Environment Variables

| Variable | Description | Where to get |
|----------|-------------|--------------|
| `DISCORD_TOKEN` | Bot token | Discord Developer Portal → Bot → Reset Token |
| `CLIENT_ID` | Bot application ID | Discord Developer Portal → General Information |
| `GUILD_ID` | Your server ID | Right click server → Copy Server ID |
| `ANTHROPIC_KEY` | Claude AI API key | [console.anthropic.com](https://console.anthropic.com) |
| `DAILY_LB_CHANNEL` | Channel for daily leaderboard | Right click channel → Copy Channel ID |
| `DAILY_MSG_CHANNEL` | Channel for good morning messages | Right click channel → Copy Channel ID |
| `ANNOUNCE_CHANNEL` | Default announcement channel | Right click channel → Copy Channel ID |
| `TICKET_CATEGORY_ID` | Category ID for tickets | Right click category → Copy ID |
| `TICKET_LOG_CHANNEL` | Channel for ticket logs | Right click channel → Copy Channel ID |
| `LEVELUP_CHANNEL` | Channel for level up messages | Right click channel → Copy Channel ID |

> **Enable Developer Mode:** Discord Settings → Advanced → Developer Mode ON — then you can right click anything to Copy ID

## After Deploy — Set Channels in Discord

```
/set channel:#general type:dailymessage
/set channel:#leaderboard type:dailyleaderboard  
/set channel:#ticket-logs type:tickets
/set channel:#level-ups type:levelups
```

---
Made with ⚡ by ForceLabs
