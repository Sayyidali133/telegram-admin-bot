require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const adminId = parseInt(process.env.ADMIN_ID);

// Initialize bot
const bot = new TelegramBot(token, { polling: true });

// In-memory "Database"
let db = {
    welcomeMessage: "Hello! Your request to join has been approved.",
    delayMs: 0, // Default to instant
    groups: [] // Array to store { id: chat_id, title: chat_title }
};

// Middleware to check if user is admin
const isAdmin = (msg) => msg.from.id === adminId;

// 1. Handle adding/removing the bot from groups
bot.on('my_chat_member', (msg) => {
    const chat = msg.chat;
    const status = msg.new_chat_member.status;

    if (chat.type === 'group' || chat.type === 'supergroup') {
        if (status === 'administrator' || status === 'member') {
            // Add to database if not exists
            if (!db.groups.find(g => g.id === chat.id)) {
                db.groups.push({ id: chat.id, title: chat.title });
                bot.sendMessage(adminId, `✅ Bot added to group: ${chat.title}`);
            }
        } else if (status === 'kicked' || status === 'left') {
            // Remove from database
            db.groups = db.groups.filter(g => g.id !== chat.id);
            bot.sendMessage(adminId, `❌ Bot removed from group: ${chat.title}`);
        }
    }
});

// 2. Handle Chat Join Requests
bot.on('chat_join_request', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    setTimeout(async () => {
        try {
            // Approve the request
            await bot.approveChatJoinRequest(chatId, userId);
            
            // Send DM to the user
            await bot.sendMessage(userId, db.welcomeMessage);
        } catch (error) {
            console.error(`Failed to process join request for user ${userId}:`, error.message);
        }
    }, db.delayMs);
});

// 3. Admin Commands
bot.on('message', async (msg) => {
    if (!msg.text || !isAdmin(msg) || msg.chat.type !== 'private') return;

    const text = msg.text;

    // Command: /botmsg [text] - Set welcome DM
    if (text.startsWith('/botmsg ')) {
        db.welcomeMessage = text.replace('/botmsg ', '');
        bot.sendMessage(adminId, `✅ Welcome message updated to:\n\n${db.welcomeMessage}`);
    }

    // Command: /setdelay [seconds] - Set approval delay
    else if (text.startsWith('/setdelay ')) {
        const seconds = parseInt(text.split(' ')[1]);
        if (!isNaN(seconds)) {
            db.delayMs = seconds * 1000;
            bot.sendMessage(adminId, `✅ Join request delay set to ${seconds} seconds.`);
        }
    }

    // Command: /groups - List all managed groups
    else if (text === '/groups') {
        if (db.groups.length === 0) return bot.sendMessage(adminId, "You haven't added the bot to any groups yet.");
        let list = "📋 **Managed Groups:**\n\n";
        db.groups.forEach((g, index) => {
            list += `${index + 1}. ${g.title} (ID: ${g.id})\n`;
        });
        bot.sendMessage(adminId, list, { parse_mode: 'Markdown' });
    }

    // Command: /group [number] - Broadcast to specific group via reply
    else if (text.startsWith('/group ')) {
        if (!msg.reply_to_message) {
            return bot.sendMessage(adminId, "⚠️ Please **reply** to the message you want to send (images, buttons, text) with `/group [number]`.");
        }
        
        const groupIndex = parseInt(text.split(' ')[1]) - 1;
        const targetGroup = db.groups[groupIndex];

        if (targetGroup) {
            try {
                // copyMessage clones text, media, inline buttons exactly as they are
                await bot.copyMessage(targetGroup.id, adminId, msg.reply_to_message.message_id);
                bot.sendMessage(adminId, `✅ Message sent to ${targetGroup.title}`);
            } catch (err) {
                bot.sendMessage(adminId, `❌ Failed to send to ${targetGroup.title}. Ensure bot is admin.`);
            }
        } else {
            bot.sendMessage(adminId, "⚠️ Invalid group number. Check `/groups`.");
        }
    }

    // Command: /all - Broadcast to all groups via reply
    else if (text === '/all') {
        if (!msg.reply_to_message) {
            return bot.sendMessage(adminId, "⚠️ Please **reply** to the message you want to send with `/all`.");
        }

        if (db.groups.length === 0) return bot.sendMessage(adminId, "No groups available.");

        let successCount = 0;
        bot.sendMessage(adminId, `⏳ Broadcasting to ${db.groups.length} groups...`);

        for (const group of db.groups) {
            try {
                await bot.copyMessage(group.id, adminId, msg.reply_to_message.message_id);
                successCount++;
            } catch (err) {
                console.error(`Failed to send to ${group.title}`);
            }
        }
        bot.sendMessage(adminId, `✅ Broadcast complete. Successfully sent to ${successCount}/${db.groups.length} groups.`);
    }

    // Command: /start - Help menu
    else if (text === '/start') {
        const helpText = `
🛠 **Admin Dashboard**

**Setup:**
1. Add me to groups as an Admin.
2. Ensure "Approve new members" is turned ON in your group's invite link settings.

**Commands:**
\`/botmsg [text]\` - Set DM for accepted users
\`/setdelay [seconds]\` - Set delay before accepting
\`/groups\` - View all connected groups

**Broadcasting (Supports Images & Buttons):**
1. Send the perfect message here in my DMs.
2. **Reply** to that message with \`/all\` to send to everyone.
3. **Reply** to that message with \`/group 1\` to send to a specific group.
        `;
        bot.sendMessage(adminId, helpText, { parse_mode: 'Markdown' });
    }
});

console.log("Bot is running...");