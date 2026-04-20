require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const adminId = parseInt(process.env.ADMIN_ID);

// Initialize bot
const bot = new TelegramBot(token, { polling: true });

// In-memory "Database"
let db = {
    welcomeMessage: "Hello! Your request to join has been approved.",
    groups: [] // Array to store { id, title, delayMs, autoAccept, pendingUsers }
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
                db.groups.push({ 
                    id: chat.id, 
                    title: chat.title,
                    delayMs: 0,       
                    autoAccept: true, 
                    pendingUsers: [] // The waiting room array
                });
                bot.sendMessage(adminId, `✅ Bot added to group: ${chat.title}\n*Auto-accept is ON by default.*`, { parse_mode: 'Markdown' });
            }
        } else if (status === 'kicked' || status === 'left') {
            // Remove from database
            db.groups = db.groups.filter(g => g.id !== chat.id);
            bot.sendMessage(adminId, `❌ Bot removed from group: ${chat.title}`);
        }
    }
});

// 2. Handle Chat Join Requests (Batch Processing)
bot.on('chat_join_request', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const group = db.groups.find(g => g.id === chatId);
    
    // If group not found or auto-accept is OFF, ignore the request
    if (!group || group.autoAccept === false) return;

    // Make sure the pending list exists
    if (!group.pendingUsers) group.pendingUsers = [];

    // If delay is 0, accept instantly without batching
    if (group.delayMs === 0) {
        try {
            await bot.approveChatJoinRequest(chatId, userId);
            if (db.welcomeMessage) await bot.sendMessage(userId, db.welcomeMessage);
        } catch (error) {
            console.error(`Failed to instant-accept user ${userId}`);
        }
        return;
    }

    // Add user to the waiting room
    group.pendingUsers.push(userId);

    // If this is the FIRST person in the waiting room, start the batch timer
    if (group.pendingUsers.length === 1) {
        
        setTimeout(async () => {
            // Lock in the current batch and clear the waiting room for the next batch
            const usersToAccept = [...group.pendingUsers];
            group.pendingUsers = []; 

            // Process everyone in the batch
            for (const uid of usersToAccept) {
                try {
                    await bot.approveChatJoinRequest(chatId, uid);
                    if (db.welcomeMessage) {
                        await bot.sendMessage(uid, db.welcomeMessage);
                    }
                } catch (error) {
                    console.error(`Failed to process join request for user ${uid}`);
                }
            }
            
            // Optional: Notify admin that a batch was processed
            // bot.sendMessage(adminId, `✅ Batch processed: Accepted ${usersToAccept.length} users into ${group.title}.`);

        }, group.delayMs);
    }
});

// 3. Admin Commands
bot.on('message', async (msg) => {
    if (!msg.text || !isAdmin(msg) || msg.chat.type !== 'private') return;

    const text = msg.text;

    // Command: /botmsg [text]
    if (text.startsWith('/botmsg')) {
        const newMsg = text.replace('/botmsg', '').trim();
        if (!newMsg) return bot.sendMessage(adminId, "⚠️ Please include the message on the same line.");
        
        db.welcomeMessage = newMsg;
        bot.sendMessage(adminId, `✅ Welcome message updated to:\n\n${db.welcomeMessage}`);
    }

    // Command: /setdelay [group_number] [seconds]
    else if (text.startsWith('/setdelay')) {
        const args = text.split(' ');
        const groupNum = parseInt(args[1]);
        const seconds = parseInt(args[2]);

        if (isNaN(groupNum) || isNaN(seconds)) {
            return bot.sendMessage(adminId, "⚠️ **Format:** `/setdelay [group_number] [seconds]`", { parse_mode: 'Markdown' });
        }

        const groupIndex = groupNum - 1;
        if (!db.groups[groupIndex]) return bot.sendMessage(adminId, "⚠️ Invalid group number.");

        db.groups[groupIndex].delayMs = seconds * 1000;
        bot.sendMessage(adminId, `✅ Batch waiting time for **${db.groups[groupIndex].title}** set to ${seconds} seconds.`, { parse_mode: 'Markdown' });
    }

    // Command: /toggle [group_number]
    else if (text.startsWith('/toggle')) {
        const args = text.split(' ');
        const groupNum = parseInt(args[1]);

        if (isNaN(groupNum)) return bot.sendMessage(adminId, "⚠️ **Format:** `/toggle [group_number]`", { parse_mode: 'Markdown' });

        const groupIndex = groupNum - 1;
        if (!db.groups[groupIndex]) return bot.sendMessage(adminId, "⚠️ Invalid group number.");

        db.groups[groupIndex].autoAccept = !db.groups[groupIndex].autoAccept;
        const status = db.groups[groupIndex].autoAccept ? "🟢 ON" : "🔴 OFF";
        bot.sendMessage(adminId, `⚙️ Auto-accept for **${db.groups[groupIndex].title}** is now ${status}`, { parse_mode: 'Markdown' });
    }

    // Command: /groups - Dashboard view
    else if (text === '/groups') {
        if (db.groups.length === 0) return bot.sendMessage(adminId, "You haven't added the bot to any groups yet.");
        
        let list = "📋 **Managed Groups Dashboard:**\n\n";
        db.groups.forEach((g, index) => {
            const status = g.autoAccept ? "🟢 ON" : "🔴 OFF";
            const delay = g.delayMs / 1000;
            const waitingCount = g.pendingUsers ? g.pendingUsers.length : 0;
            list += `**${index + 1}. ${g.title}**\n   ↳ Status: ${status} | Wait Time: ${delay}s | In Waiting Room: ${waitingCount}\n\n`;
        });
        
        bot.sendMessage(adminId, list, { parse_mode: 'Markdown' });
    }

    // Command: /group [number] - Broadcast
    else if (text.startsWith('/group ')) {
        if (!msg.reply_to_message) return bot.sendMessage(adminId, "⚠️ Please **reply** to the message you want to send.");
        
        const groupIndex = parseInt(text.split(' ')[1]) - 1;
        const targetGroup = db.groups[groupIndex];

        if (targetGroup) {
            try {
                await bot.copyMessage(targetGroup.id, adminId, msg.reply_to_message.message_id);
                bot.sendMessage(adminId, `✅ Message sent to ${targetGroup.title}`);
            } catch (err) {
                bot.sendMessage(adminId, `❌ Failed to send to ${targetGroup.title}. Ensure bot is admin.`);
            }
        }
    }

    // Command: /all - Broadcast
    else if (text === '/all') {
        if (!msg.reply_to_message) return bot.sendMessage(adminId, "⚠️ Please **reply** to the message you want to send.");
        if (db.groups.length === 0) return bot.sendMessage(adminId, "No groups available.");

        let successCount = 0;
        bot.sendMessage(adminId, `⏳ Broadcasting to ${db.groups.length} groups...`);

        for (const group of db.groups) {
            try {
                await bot.copyMessage(group.id, adminId, msg.reply_to_message.message_id);
                successCount++;
            } catch (err) {}
        }
        bot.sendMessage(adminId, `✅ Broadcast complete. Successfully sent to ${successCount}/${db.groups.length} groups.`);
    }

    // Command: /start - Help menu
    else if (text === '/start') {
        const helpText = `
🛠 **Advanced Admin Dashboard**

**Auto-Accept Settings:**
\`/groups\` - View all groups and see who is currently waiting
\`/toggle 1\` - Turn auto-accept ON or OFF for Group 1
\`/setdelay 1 15\` - Set Group 1 to gather users for 15 seconds before accepting them all at once.
\`/botmsg [text]\` - Set the DM for accepted users

**Broadcasting:**
1. Send the perfect message (images/buttons) here in my DMs.
2. **Reply** to it with \`/group 1\` to send to Group 1.
3. **Reply** to it with \`/all\` to send to everyone.
        `;
        bot.sendMessage(adminId, helpText, { parse_mode: 'Markdown' });
    }
});

console.log("Bot is running...");