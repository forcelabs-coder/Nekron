// ============================================================
//  Nekron ⛩️ — Force Town Discord Bot
//  Built for ItzForcex1 / ForceLabs
// ============================================================
//
//  SETUP:
//  1. npm install discord.js @anthropic-ai/sdk node-cron dotenv
//  2. Fill .env file (see .env.example)
//  3. node nekron.js
//
//  SLASH COMMANDS (register once on startup automatically):
//  /set channel:[channel] type:[dailyleaderboard|dailymessage|announcement|tickets|levelups]
//  /send channel:[channel] message:[text]
//  /ticket
//  /rank
//  /leaderboard
//  /services
//
// ============================================================

require('dotenv').config();

const {
  Client, GatewayIntentBits, Partials,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, ChannelType,
  REST, Routes, SlashCommandBuilder,
  ActivityType,
} = require('discord.js');
const Anthropic  = require('@anthropic-ai/sdk');
const cron       = require('node-cron');

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

// ── Persistent config (in-memory, survives restarts if you add a JSON file) ─
const config = {
  dailyLeaderboardChannel: process.env.DAILY_LB_CHANNEL    || null,
  dailyMessageChannel:     process.env.DAILY_MSG_CHANNEL   || null,
  announcementChannel:     process.env.ANNOUNCE_CHANNEL    || null,
  ticketCategory:          process.env.TICKET_CATEGORY_ID  || null,
  ticketLogChannel:        process.env.TICKET_LOG_CHANNEL  || null,
  levelUpChannel:          process.env.LEVELUP_CHANNEL     || null,
};

// ── XP System ────────────────────────────────────────────────
const xpData     = {};   // { userId: { xp, level, lastMsg, msgCount } }
const XP_GAIN    = 12;
const XP_COOL    = 25000; // 25s cooldown
const XP_NEEDED  = (lvl) => lvl * 120;

function getUser(id) {
  if (!xpData[id]) xpData[id] = { xp: 0, level: 1, lastMsg: 0, msgCount: 0 };
  return xpData[id];
}

async function giveXP(message) {
  const u   = getUser(message.author.id);
  const now = Date.now();
  if (now - u.lastMsg < XP_COOL) return;
  u.lastMsg  = now;
  u.msgCount++;
  u.xp += XP_GAIN + Math.floor(Math.random() * 8);
  while (u.xp >= XP_NEEDED(u.level)) {
    u.xp -= XP_NEEDED(u.level);
    u.level++;
    await levelUpMsg(message, u.level);
  }
}

async function levelUpMsg(message, level) {
  const chId = config.levelUpChannel;
  const ch   = chId ? message.client.channels.cache.get(chId) : message.channel;
  if (!ch) return;
  const msgs = [
    `Arre waah! <@${message.author.id}> bhai Level **${level}** pe pahunch gaya! ⚡ Force Town mein legend ban raha hai tu!`,
    `Kya baat hai <@${message.author.id}>! Level **${level}** — Force Town ka star! ⛩️`,
    `Level **${level}** unlock! <@${message.author.id}> bhai grind karta reh, top pe milenge! 🔥`,
    `Oye hoye! <@${message.author.id}> ne Level **${level}** maar diya! ⚡ Aage bhi aisa hi rehna!`,
  ];
  const embed = new EmbedBuilder()
    .setColor(0x00e5ff)
    .setTitle('⚡ Level Up!')
    .setDescription(msgs[Math.floor(Math.random() * msgs.length)])
    .setFooter({ text: 'Force Town ⛩️' })
    .setTimestamp();
  ch.send({ embeds: [embed] });
}

// ── First Message Auto-Reply System ──────────────────────────
// Bot replies to first message from a user, then waits for THEIR reply to respond again
const waitingForReply = new Set();  // users bot is waiting to reply to
const hasSpoken       = new Set();  // users who already got first-message treatment

async function handleFirstMessage(message) {
  const uid = message.author.id;

  // Already in conversation mode — if user replied, bot responds once then stops
  if (waitingForReply.has(uid)) {
    waitingForReply.delete(uid);
    await sendHinglishReply(message, true); // one reply, then done
    return true;
  }

  // First ever message from this user
  if (!hasSpoken.has(uid)) {
    hasSpoken.add(uid);
    waitingForReply.add(uid);
    await sendFirstWelcome(message);
    return true;
  }

  return false; // not handled, let other logic run
}

async function sendFirstWelcome(message) {
  const greets = [
    `Aye <@${message.author.id}> bhai! Force Town mein swagat hai! ⛩️\nMain Nekron hoon — yahan ka bot. Kuch chahiye toh bata, nahi toh chill kar! 😎`,
    `Oye <@${message.author.id}>! Aagaya finally! ⚡ Force Town mein welcome!\nMain Nekron hoon. Kisi bhi kaam ke liye \`/ticket\` maar do! 🔥`,
    `Arre bhai <@${message.author.id}> aa gaya! ⛩️ Force Town ki jaan ban ja!\nMain Nekron hoon — thoda AI, thoda jugaad! Kuch chahiye? Bol! 😄`,
  ];
  await message.reply(greets[Math.floor(Math.random() * greets.length)]);
}

async function sendHinglishReply(message, isFollowUp = false) {
  const userText = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!userText) return;

  try {
    await message.channel.sendTyping();
    const res = await ai.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `Tu Nekron hai — Force Town Discord server ka bot. Force Town, ForceLabs ka server hai jo ItzForcex1 chalata hai. 
ItzForcex1 Discord server development aur freelance video editing karta hai.
Tu Hinglish mein baat karta hai (Hindi + English mix). 
Replies chhoti rakho — max 3-4 lines. Friendly aur chill rehna.
Kabhi kabhi emojis use karo — zyada nahi.
Agar koi service ke baare mein puche: Discord dev ₹299 se shuru, video editing flexible budget.
Order karna ho toh /ticket use karo.
${isFollowUp ? 'Yeh user ne reply kiya hai toh ek baar acha sa jawab de, friendly rehna.' : ''}`,
      messages: [{ role: 'user', content: userText }],
    });
    await message.reply(res.content[0].text);
  } catch (e) {
    console.error('AI error:', e);
    await message.reply('Arre yaar, mera dimaag thoda hang ho gaya! Phir try kar 😅');
  }
}

// ── Ticket System ─────────────────────────────────────────────
const openTickets = {};

async function createTicket(interaction) {
  const { guild, user } = interaction;
  if (openTickets[user.id]) {
    return interaction.reply({ content: `⚠️ Bhai tera ticket already khula hai: <#${openTickets[user.id]}>`, ephemeral: true });
  }

  const ch = await guild.channels.create({
    name: `ticket-${user.username.toLowerCase().replace(/\s/g, '-')}`,
    type: ChannelType.GuildText,
    parent: config.ticketCategory || null,
    permissionOverwrites: [
      { id: guild.id,  deny:  [PermissionFlagsBits.ViewChannel] },
      { id: user.id,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ],
  });

  openTickets[user.id] = ch.id;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('close_ticket').setLabel('Ticket Band Karo').setStyle(ButtonStyle.Danger).setEmoji('🔒')
  );

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle('🎫 Naya Ticket — Force Town ⛩️')
    .setDescription(
      `Aye <@${user.id}> bhai! Ticket khul gaya ✅\n\n` +
      `Inhe bata do:\n` +
      `**1.** Kya chahiye? (Discord server ya video edit?)\n` +
      `**2.** Kya kya features chahiye?\n` +
      `**3.** Budget kitna hai?\n` +
      `**4.** Deadline kab hai?\n\n` +
      `ItzForcex1 jaldi se reply karega! ⚡`
    )
    .setFooter({ text: 'Kaam ho jaye toh Ticket Band Karo button dabao.' })
    .setTimestamp();

  await ch.send({ embeds: [embed], components: [row] });

  const logCh = config.ticketLogChannel ? guild.channels.cache.get(config.ticketLogChannel) : null;
  if (logCh) {
    logCh.send({ embeds: [
      new EmbedBuilder().setColor(0x22c55e)
        .setTitle('📋 Ticket Khula')
        .setDescription(`<@${user.id}> ne ticket khola → <#${ch.id}>`)
        .setTimestamp()
    ]});
  }

  interaction.reply({ content: `✅ Tera ticket bana diya: <#${ch.id}>`, ephemeral: true });
}

async function closeTicket(interaction) {
  const ch  = interaction.channel;
  const uid = Object.keys(openTickets).find(k => openTickets[k] === ch.id);
  if (uid) delete openTickets[uid];

  const logCh = config.ticketLogChannel ? interaction.guild.channels.cache.get(config.ticketLogChannel) : null;
  if (logCh) {
    logCh.send({ embeds: [
      new EmbedBuilder().setColor(0xef4444)
        .setTitle('🔒 Ticket Band Hua')
        .setDescription(`**Channel:** ${ch.name}\n**Band kiya:** <@${interaction.user.id}>`)
        .setTimestamp()
    ]});
  }

  await interaction.reply('🔒 5 seconds mein ticket band ho jayega...');
  setTimeout(() => ch.delete().catch(() => {}), 5000);
}

// ── Daily Good Morning ────────────────────────────────────────
const gmMessages = [
  '☀️ **Good Morning Force Town!** ⛩️\nUth ja bhai, naya din aaya hai! Aaj kuch productive kar — grind karo, level up karo! ⚡',
  '🌅 **Good Morning sab log!** ⛩️\nAaj ka din ekdum fire hoga — bas mehnat karte raho! 🔥 Force Town ke sath start karo apna din!',
  '☀️ **Subah ho gayi Force Town!** ⛩️\nJo so rahe hain unhe uthao, jo jag rahe hain unhe ek GM bolne do! 😄 Aaj bhi legendary rehna! ⚡',
  '🌄 **GM GM GM Force Town!** ⛩️\nNaya din, naya mood, naya grind! ItzForcex1 ke server pe aake din shuru karo! 🔥',
  '☀️ **Uth jao yaar, Force Town bulaa raha hai!** ⛩️\nGood Morning! Aaj kuch bhi ho — positive raho, grind karo! ⚡',
];

async function sendGoodMorning() {
  const chId = config.dailyMessageChannel;
  if (!chId) return;
  const ch = client.channels.cache.get(chId);
  if (!ch) return;
  const msg = gmMessages[Math.floor(Math.random() * gmMessages.length)];
  const embed = new EmbedBuilder()
    .setColor(0xfbbf24)
    .setDescription(msg)
    .setFooter({ text: 'Force Town ⛩️ — Har din naya level!' })
    .setTimestamp();
  ch.send({ embeds: [embed] });
}

// ── Daily Leaderboard ─────────────────────────────────────────
async function sendDailyLeaderboard() {
  const chId = config.dailyLeaderboardChannel;
  if (!chId) return;
  const ch = client.channels.cache.get(chId);
  if (!ch) return;

  const sorted = Object.entries(xpData)
    .sort((a, b) => b[1].msgCount - a[1].msgCount)
    .slice(0, 10);

  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  const desc = sorted.length
    ? sorted.map(([id, d], i) => `${medals[i]} <@${id}> — **${d.msgCount}** messages | Level **${d.level}**`).join('\n')
    : 'Aaj kisi ne kuch nahi bola? Yaar chat toh karo! 😅';

  // Reset daily counts
  Object.values(xpData).forEach(u => u.msgCount = 0);

  const embed = new EmbedBuilder()
    .setColor(0x00e5ff)
    .setTitle('🏆 Aaj ke Top Chatters — Force Town ⛩️')
    .setDescription(desc)
    .setFooter({ text: 'Kal bhi active raho — top spot pakdo! ⚡' })
    .setTimestamp();
  ch.send({ embeds: [embed] });
}

// ── Chat Revive Alert ─────────────────────────────────────────
const lastMsgTime  = {};  // { channelId: timestamp }
const DEAD_LIMIT   = 45 * 60 * 1000; // 45 minutes of silence = dead chat

const reviveMsgs = [
  '💀 **Aye Force Town! Chat mar gaya kya?**\nKoi toh kuch bol yaar! Kya chal raha hai sab ke life mein? 😂',
  '📻 **Hello hello... koi hai yahan?**\nChat itna quiet hai ki main apni awaaz sun sakta hoon 👻\nKoi toh bol kuch!',
  '⚡ **Force Town mein sannata kyun hai?**\nSab so gaye kya? Utho utho! Kuch toh bolo! 🔥',
  '🕸️ **Bhai chat pe cobwebs aa gaye...**\nKoi toh revive karo is chat ko! Kya chal raha hai aaj? 😄',
  '😴 **Itna quiet mat raho yaar...**\nNekron akela baith ke bore ho raha hai! Kuch toh batao! ⛩️',
  '🔔 **WAKE UP FORCE TOWN!**\nChat dead ho gayi — koi toh kuch interesting bol! Kya scene hai aaj? ⚡',
];

async function checkDeadChats() {
  const now = Date.now();
  for (const [chId, lastTime] of Object.entries(lastMsgTime)) {
    if (now - lastTime > DEAD_LIMIT) {
      const ch = client.channels.cache.get(chId);
      if (ch && ch.isTextBased()) {
        const msg = reviveMsgs[Math.floor(Math.random() * reviveMsgs.length)];
        ch.send(msg).catch(() => {});
        lastMsgTime[chId] = now; // Reset so it doesn't spam
      }
    }
  }
}

// ── Slash Command Definitions ─────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('set')
    .setDescription('Nekron ke channels configure karo')
    .addChannelOption(o => o.setName('channel').setDescription('Channel select karo').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Kaunsa type?').setRequired(true)
      .addChoices(
        { name: 'dailyleaderboard', value: 'dailyleaderboard' },
        { name: 'dailymessage',     value: 'dailymessage'     },
        { name: 'announcement',     value: 'announcement'     },
        { name: 'tickets',          value: 'tickets'          },
        { name: 'levelups',         value: 'levelups'         },
      )),

  new SlashCommandBuilder()
    .setName('send')
    .setDescription('Kisi channel mein message bhejo')
    .addChannelOption(o => o.setName('channel').setDescription('Channel select karo').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message kya bhejein?').setRequired(true)),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Service ticket kholo — order karna ho toh!'),

  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Apna ya kisi ka bhi rank dekho')
    .addUserOption(o => o.setName('user').setDescription('Kiska rank?').setRequired(false)),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Force Town ke top chatters dekho'),

  new SlashCommandBuilder()
    .setName('services')
    .setDescription('ForceLabs ki services aur prices dekho'),

  new SlashCommandBuilder()
    .setName('gm')
    .setDescription('Good morning message manually bhejo'),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered!');
  } catch (e) {
    console.error('Commands register error:', e);
  }
}

// ── Handle Slash Commands ─────────────────────────────────────
async function handleSlash(interaction) {
  const { commandName } = interaction;

  // /set channel: type:
  if (commandName === 'set') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Bhai tujhe permission nahi hai yeh karne ki!', ephemeral: true });
    }
    const ch   = interaction.options.getChannel('channel');
    const type = interaction.options.getString('type');
    const typeMap = {
      dailyleaderboard: 'dailyLeaderboardChannel',
      dailymessage:     'dailyMessageChannel',
      announcement:     'announcementChannel',
      tickets:          'ticketCategory',
      levelups:         'levelUpChannel',
    };
    config[typeMap[type]] = ch.id;
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('✅ Channel Set Ho Gaya!')
        .setDescription(`**${type}** ke liye <#${ch.id}> set kar diya! ⚡`)
        .setFooter({ text: 'Nekron ⛩️' })],
      ephemeral: true,
    });
  }

  // /send channel: message:
  if (commandName === 'send') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: '❌ Bhai tujhe permission nahi!', ephemeral: true });
    }
    const ch  = interaction.options.getChannel('channel');
    const msg = interaction.options.getString('message');
    const target = interaction.guild.channels.cache.get(ch.id);
    if (!target) return interaction.reply({ content: '❌ Channel nahi mila!', ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setDescription(`📢 ${msg}`)
      .setFooter({ text: `Force Town ⛩️ — Sent by ${interaction.user.username}` })
      .setTimestamp();
    await target.send({ embeds: [embed] });
    return interaction.reply({ content: `✅ Message bhej diya <#${ch.id}> mein!`, ephemeral: true });
  }

  // /ticket
  if (commandName === 'ticket') {
    return createTicket(interaction);
  }

  // /rank
  if (commandName === 'rank') {
    const target = interaction.options.getUser('user') || interaction.user;
    const u      = getUser(target.id);
    const needed = XP_NEEDED(u.level);
    const pct    = Math.floor((u.xp / needed) * 10);
    const bar    = '█'.repeat(pct) + '░'.repeat(10 - pct);
    const embed  = new EmbedBuilder()
      .setColor(0x00e5ff)
      .setTitle(`⚡ ${target.username} ka Rank`)
      .setDescription(
        `**Level:** ${u.level}\n` +
        `**XP:** ${u.xp} / ${needed}\n` +
        `**Progress:** \`[${bar}]\`\n` +
        `**Total Messages:** ${u.msgCount}`
      )
      .setThumbnail(target.displayAvatarURL())
      .setFooter({ text: 'Force Town ⛩️ — Chat karo, level lo!' })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // /leaderboard
  if (commandName === 'leaderboard') {
    const sorted = Object.entries(xpData)
      .sort((a, b) => b[1].level - a[1].level || b[1].xp - a[1].xp)
      .slice(0, 10);
    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    const desc = sorted.length
      ? sorted.map(([id, d], i) => `${medals[i]} <@${id}> — Level **${d.level}** (${d.xp} XP)`).join('\n')
      : 'Abhi tak koi active nahi — pehle chat karo bhai! 😅';
    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle('🏆 Force Town — Top Members ⛩️')
      .setDescription(desc)
      .setFooter({ text: 'Grind karte raho — top pe aao! ⚡' })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // /services
  if (commandName === 'services') {
    const embed = new EmbedBuilder()
      .setColor(0x00e5ff)
      .setTitle('⚡ ForceLabs — Kya Kya Milega?')
      .addFields(
        { name: '🛠️ Discord Development', value: 'Server setup, custom bots, automation, branding\nStarting **₹299** onward', inline: false },
        { name: '🎬 Video Editing', value: 'Reels, YouTube, cinematic montages, gaming highlights\n**Flexible budget** — koi bhi amount chalega!', inline: false },
        { name: '📩 Order Karna Hai?', value: '`/ticket` maar do ya DM karo **ItzForcex1** ko\n🌐 forcelabs.netlify.app', inline: false },
      )
      .setFooter({ text: 'Force Town ⛩️ — Built Different by ForceLabs' })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // /gm
  if (commandName === 'gm') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: '❌ Permission nahi hai!', ephemeral: true });
    }
    await sendGoodMorning();
    return interaction.reply({ content: '✅ Good morning message bhej diya!', ephemeral: true });
  }
}

// ── READY ─────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Nekron online — ${client.user.tag}`);
  client.user.setUsername('Nekron').catch(() => {});
  client.user.setActivity('Force Town ⛩️ | /ticket', { type: ActivityType.Watching });

  await registerCommands();

  // Good Morning — 7:00 AM IST = 1:30 AM UTC
  cron.schedule('30 1 * * *', () => {
    sendGoodMorning();
    console.log('☀️ Good Morning sent');
  });

  // Daily Leaderboard — 11:55 PM IST = 6:25 PM UTC
  cron.schedule('25 18 * * *', () => {
    sendDailyLeaderboard();
    console.log('🏆 Daily leaderboard sent');
  });

  // Check dead chats every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    checkDeadChats();
  });
});

// ── MESSAGE CREATE ────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) retu
