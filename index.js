const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ChannelType } = require('discord.js');
const fs = require("fs");

// ===== قراءة إعدادات البوت =====
const config = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
const TOKEN = config.TOKEN;
const BOT_ID = config.BOT_ID;
const GUILD_ID = config.GUILD_ID;

const MEMBER_ROLE_NAME = config.MEMBER_ROLE_NAME;
const NOT_ROLED_ROLE_NAME = config.NOT_ROLED_ROLE_NAME;
const BACKUP_ROLE_NAME = config.BACKUP_ROLE_NAME;
const BACKUP_CHANNEL_NAME = config.BACKUP_CHANNEL_NAME;
const ADMIN_ROLE_NAME = config.ADMIN_ROLE_NAME;
const ERRORS_CHANNEL_NAME = config.ERRORS_CHANNEL_NAME;

// ===== إنشاء البوت =====
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ===== تخزين المستخدمين والرسائل =====
const usedBackup = new Map();
const CODE_COOLDOWN = 5 * 60 * 1000;
const storedEchoes = new Map();

// ===== تسجيل الأوامر =====
const commands = [
    new SlashCommandBuilder()
        .setName("addbankai")
        .setDescription("إعطاء رتبة للجميع")
        .addStringOption(option => option.setName("rolename").setDescription("اسم الرتبة").setRequired(true)),
    new SlashCommandBuilder()
        .setName("removebankai")
        .setDescription("إزالة رتبة من الجميع")
        .addStringOption(option => option.setName("rolename").setDescription("اسم الرتبة").setRequired(true)),
    new SlashCommandBuilder()
        .setName("backup")
        .setDescription("طلب فزعة (باك أب) مرة كل 5 دقائق")
        .addStringOption(option => option.setName("code").setDescription("اكتب كود السيرفر (مثال: AB1234)").setRequired(true)),
    new SlashCommandBuilder()
        .setName("echo")
        .setDescription("ارسال رسالة في روم محدد")
        .addChannelOption(option =>
            option.setName("channel")
                .setDescription("اختر الروم")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("message")
                .setDescription("الرسالة اللي تبغاها")
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName("removeecho")
        .setDescription("حذف رسالة بواسطة ID")
        .addStringOption(option => option.setName("messageid").setDescription("ID الرسالة").setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

// ===== تسجيل الأوامر في السيرفر =====
(async () => {
    try {
        console.log("جارٍ تسجيل الأوامر...");
        await rest.put(Routes.applicationGuildCommands(BOT_ID, GUILD_ID), { body: commands });
        console.log("✅ تم تسجيل الأوامر");
    } catch (error) { sendError(error); }
})();

// ===== تحقق من الكود =====
function isValidCode(code) {
    return /^[A-Z]{2}\d{4}$/.test(code) && code.length === 6;
}

// ===== دالة إرسال الأخطاء =====
async function sendError(error) {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = guild.channels.cache.find(c => c.name === ERRORS_CHANNEL_NAME && c.isTextBased());
        if (!channel) return console.error("❌ روم الأخطاء مش موجود!");
        const errorMsg = `\`\`\`[${new Date().toLocaleString()}]\n${error.stack || error}\`\`\``;
        await channel.send({ content: errorMsg });
    } catch (err) {
        console.error("❌ فشل إرسال الخطأ:", err);
    }
}

// ===== التعامل مع الأوامر =====
client.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isChatInputCommand()) return;
        const guild = interaction.guild;
        const member = interaction.member;
        const adminRole = guild.roles.cache.find(r => r.name === ADMIN_ROLE_NAME);
        const isAdmin = member.roles.cache.has(adminRole?.id);

        // deferReply للعمليات الطويلة
        if (["addbankai", "removebankai", "backup", "echo", "removeecho"].includes(interaction.commandName)) {
            if (!interaction.replied && !interaction.deferred) await interaction.deferReply({ ephemeral: true });
        }

        // ----- /addbankai -----
        if (interaction.commandName === "addbankai") {
            if (!isAdmin) return interaction.editReply({ content: "❌ هذا الأمر للـ Administrator فقط." });
            const roleName = interaction.options.getString("rolename");
            const role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) return interaction.editReply({ content: `❌ ما لقيت رتبة باسم: **${roleName}**` });

            const members = await guild.members.fetch();
            let count = 0;
            for (const m of members.values()) {
                if (!m.roles.cache.has(role.id)) {
                    try { await m.roles.add(role); count++; } catch { }
                }
            }
            await interaction.editReply({ content: `✅ تمت إضافة رتبة **${roleName}** لـ ${count} عضو.` });
        }

        // ----- /removebankai -----
        if (interaction.commandName === "removebankai") {
            if (!isAdmin) return interaction.editReply({ content: "❌ هذا الأمر للـ Administrator فقط." });
            const roleName = interaction.options.getString("rolename");
            const role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) return interaction.editReply({ content: `❌ ما لقيت رتبة باسم: **${roleName}**` });

            const members = await guild.members.fetch();
            let count = 0;
            for (const m of members.values()) {
                if (m.roles.cache.has(role.id)) {
                    try { await m.roles.remove(role); count++; } catch { }
                }
            }
            await interaction.editReply({ content: `✅ تمت إزالة رتبة **${roleName}** من ${count} عضو.` });
        }

        // ----- /backup -----
        if (interaction.commandName === "backup") {
            const channel = guild.channels.cache.find(c => c.name === BACKUP_CHANNEL_NAME);
            const backupRole = guild.roles.cache.find(r => r.name === BACKUP_ROLE_NAME);
            if (!channel || !backupRole) return interaction.editReply({ content: "❌ روم الباك أب أو الرتبة غير موجودة." });
            if (interaction.channelId !== channel.id) return interaction.editReply({ content: `❌ تقدر تستخدم الأمر فقط في ${channel}.` });

            const now = Date.now();
            if (usedBackup.has(member.id) && now - usedBackup.get(member.id) < CODE_COOLDOWN) {
                const remain = Math.ceil((CODE_COOLDOWN - (now - usedBackup.get(member.id))) / 60000);
                return interaction.editReply({ content: `⏳ ما تقدر تطلب باك أب إلا بعد ${remain} دقيقة.` });
            }

            const code = interaction.options.getString("code").toUpperCase();
            if (!isValidCode(code)) return interaction.editReply({ content: "❌ الكود غير صحيح. مثال: AB1234" });

            usedBackup.set(member.id, now);
            await interaction.editReply({ content: `🚨 ${backupRole} تم طلب باك أب من <@${member.id}>!\n🔑 كود السيرفر: **${code}**` });
        }

        // ----- /echo -----
        if (interaction.commandName === "echo") {
            if (!isAdmin) return interaction.editReply({ content: "❌ هذا الأمر للـ Administrator فقط." });

            const targetChannel = interaction.options.getChannel("channel");
            const messageContent = interaction.options.getString("message");

            if (!targetChannel || !targetChannel.isTextBased())
                return interaction.editReply({ content: "❌ هذا الروم غير صالح للإرسال." });

            const sentMessage = await targetChannel.send(messageContent);
            storedEchoes.set(sentMessage.id, sentMessage);

            await interaction.editReply({ content: `✅ تم إرسال الرسالة في ${targetChannel.name}` });
        }

        // ----- /removeecho -----
        if (interaction.commandName === "removeecho") {
            if (!isAdmin) return interaction.editReply({ content: "❌ هذا الأمر للـ Administrator فقط." });
            const messageId = interaction.options.getString("messageid");
            const msg = storedEchoes.get(messageId);
            if (!msg) return interaction.editReply({ content: "❌ ما لقيت الرسالة أو تم حذفها مسبقاً." });
            await msg.delete();
            storedEchoes.delete(messageId);
            await interaction.editReply({ content: `✅ تم حذف الرسالة ${messageId}` });
        }

    } catch (error) { sendError(error); }
});

// ===== عند دخول عضو جديد =====
client.on("guildMemberAdd", async (member) => {
    try {
        const guild = member.guild;
        const memberRole = guild.roles.cache.find(r => r.name === MEMBER_ROLE_NAME);
        const notRoledRole = guild.roles.cache.find(r => r.name === NOT_ROLED_ROLE_NAME);
        if (!memberRole || !notRoledRole) return;

        if (member.roles.cache.size === 1) await member.roles.add(notRoledRole);

    } catch (error) { sendError(error); }
});

// ===== تحديث الرتب (Member ↔ not roled!) =====
client.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
        const guild = newMember.guild;
        const memberRole = guild.roles.cache.find(r => r.name === MEMBER_ROLE_NAME);
        const notRoledRole = guild.roles.cache.find(r => r.name === NOT_ROLED_ROLE_NAME);
        if (!memberRole || !notRoledRole) return;

        if (!oldMember.roles.cache.has(memberRole.id) && newMember.roles.cache.has(memberRole.id)) {
            if (newMember.roles.cache.has(notRoledRole.id)) await newMember.roles.remove(notRoledRole);
        }

        if (oldMember.roles.cache.has(memberRole.id) && !newMember.roles.cache.has(memberRole.id)) {
            if (!newMember.roles.cache.has(notRoledRole.id)) await newMember.roles.add(notRoledRole);
        }

    } catch (error) { sendError(error); }
});

// ===== أوتو-تشيك عند تشغيل البوت =====
client.once("ready", async () => {
    console.log(`✅ Bot is online as ${client.user.tag}`);
});

client.login(TOKEN);
