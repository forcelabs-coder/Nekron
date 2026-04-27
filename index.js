// ============================================================
//  Nekron ⛩️  —  Force Town Discord Bot  v4.0
//  Built for ItzForcex1 / ForceLabs
//  PostgreSQL + crash-safe error handling
// ============================================================
"use strict";
require("dotenv").config();

const {
  Client, GatewayIntentBits, Partials,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, ChannelType,
  REST, Routes, SlashCommandBuilder, ActivityType,
} = require("discord.js");
const Anthropic = require("@anthropic-ai/sdk");
const cron      = require("node-cron");
const { Pool }  = require("pg");

// ── Crash protection ──────────────────────────────────────────
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
process.on("uncaughtException",  (err) => console.error("Uncaught exception:", err));

// ── Clients ───────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

// ── DB setup ──────────────────────────────────────────────────
// Falls back gracefully if POSTGRES_URL not set
let db = null;
if (process.env.POSTGRES_URL) {
  db = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  db.on("error", (err) => console.error("DB pool error:", err));
  console.log("DB pool created");
} else {
  console.warn("WARNING: POSTGRES_URL not set — using in-memory storage (data resets on restart)");
}

// ── In-memory fallback ────────────────────────────────────────
const memUsers  = {};
const memConfig = {};
const memTickets = {};

// ── DB helpers ────────────────────────────────────────────────
async function initDB() {
  if (!db) return;
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS users (
      user_id    TEXT PRIMARY KEY,
      xp         INTEGER DEFAULT 0,
      level      INTEGER DEFAULT 1,
      msg_count  INTEGER DEFAULT 0,
      daily_msgs INTEGER DEFAULT 0,
      last_msg   BIGINT  DEFAULT 0,
      has_spoken BOOLEAN DEFAULT FALSE
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS tickets (
      user_id    TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS bot_config (
      key   TEXT PRIMARY KEY,
      value TEXT
    )`);
    console.log("✅ DB tables ready");
  } catch (e) {
    console.error("DB init error:", e.message);
  }
}

async function getUser(id) {
  if (db) {
    try {
      const r = await db.query("SELECT * FROM users WHERE user_id=$1", [id]);
      if (r.rows.length) return r.rows[0];
      await db.query("INSERT INTO users(user_id) VALUES($1) ON CONFLICT DO NOTHING", [id]);
    } catch (e) { console.error("getUser error:", e.message); }
  }
  if (!memUsers[id]) memUsers[id] = { user_id:id, xp:0, level:1, msg_count:0, daily_msgs:0, last_msg:0, has_spoken:false };
  return memUsers[id];
}

async function updateUser(id, fields) {
  if (db) {
    try {
      const keys = Object.keys(fields);
      const vals = Object.values(fields);
      const set  = keys.map((k, i) => `${k}=$${i+2}`).join(",");
      await db.query(`UPDATE users SET ${set} WHERE user_id=$1`, [id, ...vals]);
      return;
    } catch (e) { console.error("updateUser error:", e.message); }
  }
  if (!memUsers[id]) memUsers[id] = await getUser(id);
  Object.assign(memUsers[id], fields);
}

async function getConf(key) {
  if (db) {
    try {
      const r = await db.query("SELECT value FROM bot_config WHERE key=$1", [key]);
      return r.rows[0]?.value || null;
    } catch (e) { console.error("getConf error:", e.message); }
  }
  return memConfig[key] || null;
}

async function setConf(key, val) {
  if (db) {
    try {
      await db.query("INSERT INTO bot_config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2", [key, val]);
      return;
    } catch (e) { console.error("setConf error:", e.message); }
  }
  memConfig[key] = val;
}

async function getTicket(userId) {
  if (db) {
    try {
      const r = await db.query("SELECT channel_id FROM tickets WHERE user_id=$1", [userId]);
      return r.rows[0]?.channel_id || null;
    } catch (e) { console.error("getTicket error:", e.message); }
  }
  return memTickets[userId] || null;
}

async function saveTicket(userId, channelId) {
  if (db) {
    try {
      await db.query("INSERT INTO tickets(user_id,channel_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET channel_id=$2", [userId, channelId]);
      return;
    } catch (e) { console.error("saveTicket error:", e.message); }
  }
  memTickets[userId] = channelId;
}

async function deleteTicket(channelId) {
  if (db) {
    try {
      await db.query("DELETE FROM tickets WHERE channel_id=$1", [channelId]);
      return;
    } catch (e) { console.error("deleteTicket error:", e.message); }
  }
  for (const [uid, chid] of Object.entries(memTickets)) {
    if (chid === channelId) delete memTickets[uid];
  }
}

// ── Config ────────────────────────────────────────────────────
const cfg = {
  lbCh:   process.env.DAILY_LB_CHANNEL   || null,
  gmCh:   process.env.DAILY_MSG_CHANNEL  || null,
  annCh:  process.env.ANNOUNCE_CHANNEL   || null,
  tktCat: process.env.TICKET_CATEGORY_ID || null,
  tktLog: process.env.TICKET_LOG_CHANNEL || null,
  lvlCh:  process.env.LEVELUP_CHANNEL    || null,
};

async function loadCfg() {
  try {
    const keys = Object.keys(cfg);
    for (const k of keys) { const v = await getConf(k); if (v) cfg[k] = v; }
    console.log("✅ Config loaded");
  } catch (e) { console.error("loadCfg error:", e.message); }
}

// ── XP System ─────────────────────────────────────────────────
const XP_COOL = 25000;
const XP_NEED = (lvl) => lvl * 120;

async function giveXP(msg) {
  try {
    const u   = await getUser(msg.author.id);
    const now = Date.now();
    if (now - Number(u.last_msg) < XP_COOL) return;
    let xp = u.xp + 12 + Math.floor(Math.random() * 8);
    let lv = u.level;
    let leveled = false;
    while (xp >= XP_NEED(lv)) { xp -= XP_NEED(lv); lv++; leveled = true; }
    await updateUser(msg.author.id, { xp, level:lv, last_msg:now, msg_count:u.msg_count+1, daily_msgs:u.daily_msgs+1 });
    if (leveled) await sendLevelUp(msg, lv);
  } catch (e) { console.error("giveXP error:", e.message); }
}

async function sendLevelUp(msg, lv) {
  try {
    const chId = cfg.lvlCh;
    const ch   = chId ? msg.client.channels.cache.get(chId) : msg.channel;
    if (!ch) return;
    const texts = [
      `Arre waah! <@${msg.author.id}> bhai Level **${lv}** pe pahunch gaya! ⚡`,
      `Kya baat hai <@${msg.author.id}>! Level **${lv}** — Force Town ka star! ⛩️`,
      `Level **${lv}** unlock! <@${msg.author.id}> grind karta reh! 🔥`,
    ];
    await ch.send({ embeds: [
      new EmbedBuilder().setColor(0x00e5ff).setTitle("⚡ Level Up!")
        .setDescription(texts[Math.floor(Math.random() * texts.length)])
        .setFooter({ text: "Force Town ⛩️" }).setTimestamp()
    ]});
  } catch (e) { console.error("sendLevelUp error:", e.message); }
}

// ── First message system ──────────────────────────────────────
const waitSet = new Set();

async function handleFirst(msg) {
  try {
    const u = await getUser(msg.author.id);
    if (waitSet.has(msg.author.id)) {
      waitSet.delete(msg.author.id);
      await aiReply(msg);
      return true;
    }
    if (!u.has_spoken) {
      await updateUser(msg.author.id, { has_spoken: true });
      waitSet.add(msg.author.id);
      const greets = [
        `Aye <@${msg.author.id}> bhai! Force Town mein swagat hai! ⛩️\nMain Nekron hoon — kuch chahiye toh bata! 😎`,
        `Oye <@${msg.author.id}>! Force Town mein welcome! ⚡\nMain Nekron hoon. Order ke liye \`/ticket\` maar do! 🔥`,
        `Arre <@${msg.author.id}> aa gaya! ⛩️\nMain Nekron hoon — thoda AI thoda jugaad! Kuch chahiye? 😄`,
      ];
      await msg.reply(greets[Math.floor(Math.random() * greets.length)]);
      return true;
    }
  } catch (e) { console.error("handleFirst error:", e.message); }
  return false;
}

async function aiReply(msg) {
  const text = msg.content.replace(/<@!?\d+>/g, "").trim();
  if (!text) return;
  try {
    await msg.channel.sendTyping();
    const r = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: "Tu Nekron hai — Force Town Discord server ka bot. ForceLabs ka server hai jo ItzForcex1 chalata hai. Tu Hinglish mein baat karta hai (Hindi + English mix). Replies chhoti rakho max 3-4 lines. Friendly aur chill rehna. Discord dev Rs.299 se shuru, video editing flexible budget. Order ke liye /ticket.",
      messages: [{ role: "user", content: text }],
    });
    await msg.reply(r.content[0].text);
  } catch (e) {
    console.error("aiReply error:", e.message);
    await msg.reply("Arre yaar hang ho gaya! Phir try kar 😅");
  }
}

// ── Ticket system ─────────────────────────────────────────────
async function openTicket(interaction) {
  try {
    const { guild, user } = interaction;
    const existing = await getTicket(user.id);
    if (existing) return interaction.reply({ content: `⚠️ Tera ticket already khula hai: <#${existing}>`, ephemeral: true });

    const ch = await guild.channels.create({
      name: `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
      type: ChannelType.GuildText,
      parent: cfg.tktCat || null,
      permissionOverwrites: [
        { id: guild.id,  deny:  [PermissionFlagsBits.ViewChannel] },
        { id: user.id,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ],
    });

    await saveTicket(user.id, ch.id);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("close_ticket").setLabel("Ticket Band Karo").setStyle(ButtonStyle.Danger).setEmoji("🔒")
    );

    await ch.send({ embeds: [
      new EmbedBuilder().setColor(0x8b5cf6).setTitle("🎫 Naya Ticket — Force Town ⛩️")
        .setDescription(`Aye <@${user.id}> bhai! Ticket khul gaya ✅\n\nInhe bata do:\n**1.** Discord server ya video edit?\n**2.** Kya features chahiye?\n**3.** Budget kitna hai?\n**4.** Deadline kab hai?\n\nItzForcex1 jaldi reply karega! ⚡`)
        .setFooter({ text: "Kaam ho jaye toh Band Karo dabao." }).setTimestamp()
    ], components: [row] });

    if (cfg.tktLog) {
      const logCh = guild.channels.cache.get(cfg.tktLog);
      if (logCh) await logCh.send({ embeds: [
        new EmbedBuilder().setColor(0x22c55e).setTitle("📋 Ticket Khula")
          .setDescription(`<@${user.id}> ne ticket khola → <#${ch.id}>`).setTimestamp()
      ]});
    }

    await interaction.reply({ content: `✅ Ticket bana diya: <#${ch.id}>`, ephemeral: true });
  } catch (e) {
    console.error("openTicket error:", e.message);
    if (!interaction.replied) await interaction.reply({ content: "❌ Ticket nahi ban paya! Try again.", ephemeral: true });
  }
}

async function closeTicket(interaction) {
  try {
    const ch = interaction.channel;
    await deleteTicket(ch.id);
    if (cfg.tktLog) {
      const logCh = interaction.guild.channels.cache.get(cfg.tktLog);
      if (logCh) await logCh.send({ embeds: [
        new EmbedBuilder().setColor(0xef4444).setTitle("🔒 Ticket Band")
          .setDescription(`**Channel:** ${ch.name}\n**By:** <@${interaction.user.id}>`).setTimestamp()
      ]});
    }
    await interaction.reply("🔒 5 seconds mein band ho jayega...");
    setTimeout(() => ch.delete().catch(() => {}), 5000);
  } catch (e) { console.error("closeTicket error:", e.message); }
}

// ── Good Morning ──────────────────────────────────────────────
const gmTexts = [
  "☀️ **Good Morning Force Town!** ⛩️\nUth ja bhai, naya din aaya hai! Grind karo, level up karo! ⚡",
  "🌅 **Good Morning sab log!** ⛩️\nAaj ka din ekdum fire hoga — mehnat karte raho! 🔥",
  "☀️ **Subah ho gayi Force Town!** ⛩️\nAaj bhi legendary rehna! ⚡",
  "🌄 **GM GM GM Force Town!** ⛩️\nNaya din, naya grind! ⚡",
  "☀️ **Uth jao yaar, Force Town bulaa raha hai!** ⛩️\nPositive raho, grind karo! 🔥",
];

async function sendGM() {
  try {
    if (!cfg.gmCh) return;
    const ch = client.channels.cache.get(cfg.gmCh);
    if (!ch) return;
    await ch.send({ embeds: [
      new EmbedBuilder().setColor(0xfbbf24)
        .setDescription(gmTexts[Math.floor(Math.random() * gmTexts.length)])
        .setFooter({ text: "Force Town ⛩️ — Har din naya level!" }).setTimestamp()
    ]});
  } catch (e) { console.error("sendGM error:", e.message); }
}

// ── Daily Leaderboard ─────────────────────────────────────────
async function sendLB() {
  try {
    if (!cfg.lbCh) return;
    const ch = client.channels.cache.get(cfg.lbCh);
    if (!ch) return;
    let rows = [];
    if (db) {
      const r = await db.query("SELECT user_id,daily_msgs,level FROM users ORDER BY daily_msgs DESC LIMIT 10");
      await db.query("UPDATE users SET daily_msgs=0");
      rows = r.rows;
    } else {
      rows = Object.values(memUsers).sort((a,b) => b.daily_msgs - a.daily_msgs).slice(0,10);
      Object.values(memUsers).forEach(u => u.daily_msgs = 0);
    }
    const medals = ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
    const desc = rows.length
      ? rows.map((x,i) => `${medals[i]} <@${x.user_id}> — **${x.daily_msgs}** messages | Level **${x.level}**`).join("\n")
      : "Aaj kisi ne kuch nahi bola! Kal toh active rehna! 😅";
    await ch.send({ embeds: [
      new EmbedBuilder().setColor(0x00e5ff).setTitle("🏆 Aaj ke Top Chatters — Force Town ⛩️")
        .setDescription(desc).setFooter({ text: "Kal bhi active raho — top spot pakdo! ⚡" }).setTimestamp()
    ]});
  } catch (e) { console.error("sendLB error:", e.message); }
}

// ── Dead chat revive ──────────────────────────────────────────
const lastMsg = {};
const DEAD    = 45 * 60 * 1000;
const revive  = [
  "💀 **Aye Force Town! Chat mar gaya kya?**\nKoi toh kuch bol yaar! 😂",
  "📻 **Hello... koi hai yahan?**\nChat itna quiet hai ki main akela hoon 👻",
  "⚡ **Force Town mein sannata kyun?**\nSab so gaye kya? Utho! 🔥",
  "🕸️ **Chat pe cobwebs aa gaye...**\nKoi toh kuch bolo! 😄",
  "😴 **Nekron akela bore ho raha hai!** ⛩️\nKuch toh batao!",
  "🔔 **WAKE UP FORCE TOWN!**\nChat dead ho gayi! ⚡",
];

async function checkDead() {
  const now = Date.now();
  for (const [chId, t] of Object.entries(lastMsg)) {
    if (now - t > DEAD) {
      try {
        const ch = client.channels.cache.get(chId);
        if (ch && ch.isTextBased()) {
          await ch.send(revive[Math.floor(Math.random() * revive.length)]);
          lastMsg[chId] = now;
        }
      } catch (e) { /* ignore */ }
    }
  }
}

// ── Slash Commands ────────────────────────────────────────────
const slashCmds = [
  new SlashCommandBuilder().setName("set").setDescription("Nekron ke channels configure karo")
    .addChannelOption(o => o.setName("channel").setDescription("Channel select karo").setRequired(true))
    .addStringOption(o => o.setName("type").setDescription("Type?").setRequired(true).addChoices(
      { name: "dailyleaderboard", value: "lbCh"   },
      { name: "dailymessage",     value: "gmCh"   },
      { name: "announcement",     value: "annCh"  },
      { name: "tickets",          value: "tktCat" },
      { name: "levelups",         value: "lvlCh"  },
    )),
  new SlashCommandBuilder().setName("send").setDescription("Kisi channel mein announcement bhejo")
    .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("Message").setRequired(true)),
  new SlashCommandBuilder().setName("ticket").setDescription("Service ticket kholo"),
  new SlashCommandBuilder().setName("rank").setDescription("Apna ya kisi ka rank dekho")
    .addUserOption(o => o.setName("user").setDescription("Kiska rank?").setRequired(false)),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Top members dekho"),
  new SlashCommandBuilder().setName("services").setDescription("ForceLabs ki services dekho"),
  new SlashCommandBuilder().setName("gm").setDescription("Good morning manually bhejo"),
].map(c => c.toJSON());

async function regCmds() {
  try {
    if (!process.env.CLIENT_ID || !process.env.GUILD_ID) {
      console.warn("CLIENT_ID or GUILD_ID missing — skipping command registration");
      return;
    }
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: slashCmds });
    console.log("✅ Slash commands registered");
  } catch (e) { console.error("regCmds error:", e.message); }
}

// ── Handle slash commands ─────────────────────────────────────
async function handleSlash(i) {
  const c = i.commandName;

  if (c === "set") {
    if (!i.memberPermissions.has(PermissionFlagsBits.ManageGuild))
      return i.reply({ content: "❌ Permission nahi hai bhai!", ephemeral: true });
    const ch = i.options.getChannel("channel"), type = i.options.getString("type");
    cfg[type] = ch.id;
    await setConf(type, ch.id);
    return i.reply({ embeds: [new EmbedBuilder().setColor(0x22c55e).setTitle("✅ Channel Set!")
      .setDescription(`<#${ch.id}> set kar diya! ⚡`).setFooter({ text: "Nekron ⛩️" })], ephemeral: true });
  }

  if (c === "send") {
    if (!i.memberPermissions.has(PermissionFlagsBits.ManageMessages))
      return i.reply({ content: "❌ Permission nahi!", ephemeral: true });
    const ch = i.options.getChannel("channel"), msg = i.options.getString("message");
    const target = i.guild.channels.cache.get(ch.id);
    if (!target) return i.reply({ content: "❌ Channel nahi mila!", ephemeral: true });
    await target.send({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setDescription(`📢 ${msg}`)
      .setFooter({ text: `Force Town ⛩️ — by ${i.user.username}` }).setTimestamp()] });
    return i.reply({ content: `✅ Message bhej diya <#${ch.id}> mein!`, ephemeral: true });
  }

  if (c === "ticket") return openTicket(i);

  if (c === "rank") {
    const t = i.options.getUser("user") || i.user;
    const u = await getUser(t.id);
    const need = XP_NEED(u.level);
    const pct  = Math.min(10, Math.floor((u.xp / need) * 10));
    const bar  = "█".repeat(pct) + "░".repeat(10 - pct);
    return i.reply({ embeds: [new EmbedBuilder().setColor(0x00e5ff).setTitle(`⚡ ${t.username} ka Rank`)
      .setDescription(`**Level:** ${u.level}\n**XP:** ${u.xp} / ${need}\n**Progress:** \`[${bar}]\`\n**Total Messages:** ${u.msg_count}`)
      .setThumbnail(t.displayAvatarURL()).setFooter({ text: "Force Town ⛩️ — Chat karo, level lo!" }).setTimestamp()] });
  }

  if (c === "leaderboard") {
    let rows = [];
    if (db) {
      const r = await db.query("SELECT user_id,level,xp FROM users ORDER BY level DESC,xp DESC LIMIT 10");
      rows = r.rows;
    } else {
      rows = Object.values(memUsers).sort((a,b) => b.level-a.level || b.xp-a.xp).slice(0,10)
        .map(u => ({ user_id: u.user_id, level: u.level, xp: u.xp }));
    }
    const medals = ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
    const desc = rows.length
      ? rows.map((x,idx) => `${medals[idx]} <@${x.user_id}> — Level **${x.level}** (${x.xp} XP)`).join("\n")
      : "Koi active nahi abhi! Pehle chat karo! 😅";
    return i.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle("🏆 Force Town Top Members ⛩️")
      .setDescription(desc).setFooter({ text: "Grind karo, top pe aao! ⚡" }).setTimestamp()] });
  }

  if (c === "services") {
    return i.reply({ embeds: [new EmbedBuilder().setColor(0x00e5ff).setTitle("⚡ ForceLabs — Kya Kya Milega?")
      .addFields(
        { name: "🛠️ Discord Development", val
