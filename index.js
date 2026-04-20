require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const adminId = parseInt(process.env.ADMIN_ID);

// Initialize bot
const bot = new TelegramBot(token, { polling: true });

// In-memory "Database"
let db = {
    welcomeMessage: "Hello! Your request to join has been approved.",
    groups: [] 
};

// Middleware to check if user is admin
const isAdmin = (msg) => msg.from.id === adminId;

// Helper: Cleans group titles of special characters
const cleanTitle = (title) => title ? title.replace(/[_*[\]()~`>#+-=|{}.!]/g, '') : "Group";

// 1. Handle adding/removing the bot from groups
bot.on('my_chat_member', (msg) => {
    const chat = msg.chat;
    const status = msg.new_chat_member.status;

    if (chat.type === 'group' || chat.type === 'supergroup') {
        const safeTitle = cleanTitle(chat.title);
        
        if (status === 'administrator' || status === 'member') {
            if (!db.groups.find(g => g.id === chat.id)) {
                db.groups.push({ 
                    id: chat.id, 
                    title: safeTitle,
                    delayMs: 0,       
                    autoAccept: true, 
                    pendingUsers: [] 
                });
                bot.sendMessage(adminId, `✅ <b>NEW GROUP ADDED</b>\nName: ${safeTitle}\nStatus: Auto-accept is 🟢 ON by default.`, { parse_mode: 'HTML' });
            }
        } else if (status === 'kicked' || status === 'left') {
            db.groups = db.groups.filter(g => g.id !== chat.id);
            bot.sendMessage(adminId, `❌ <b>GROUP REMOVED</b>\nBot was removed from: ${safeTitle}`, { parse_mode: 'HTML' });
        }
    }
});

// 2. Handle Chat Join Requests (With fixed DM order)
bot.on('chat_join_request', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const group = db.groups.find(g => g.id === chatId);
    
    // If group not found or auto-accept is OFF, ignore
    if (!group || group.autoAccept === false) return;

    if (!group.pendingUsers) group.pendingUsers = [];

    // --- INSTANT ACCEPT LOGIC ---
    if (group.delayMs === 0) {
        // Step 1: Send DM FIRST before permission is revoked
        if (db.welcomeMessage) {
            try {
                await bot.sendMessage(userId, db.welcomeMessage);
            } catch (error) {
                console.log(`Failed to DM user ${userId}. They may have strict privacy settings.`);
            }
        }
        
        // Step 2: Approve Request SECOND
        try {
            await bot.approveChatJoinRequest(chatId, userId);
        } catch (error) {
            console.log(`Failed to approve user ${userId}.`);
        }
        return;
    }

    // --- BATCH WAITING ROOM LOGIC ---
    group.pendingUsers.push(userId);

    // If FIRST person in waiting room, start batch timer
    if (group.pendingUsers.length === 1) {
        setTimeout(async () => {
            const usersToAccept = [...group.pendingUsers];
            group.pendingUsers = []; // Clear room for next batch

            for (const uid of usersToAccept) {
                // Step 1: Send DM FIRST
                if (db.welcomeMessage) {
                    try {
                        await bot.sendMessage(uid, db.welcomeMessage);
                    } catch (error) {}
                }
                
                // Step 2: Approve Request SECOND
                try {
                    await bot.approveChatJoinRequest(chatId, uid);
                } catch (error) {}
            }
        }, group.delayMs);
    }
});

// 3. Admin Commands
bot.on('message', async (msg) => {
    if (!msg.text || !isAdmin(msg) || msg.chat.type !== 'private') return;

    const text = msg.text.trim();

    // Command: /botmsg [text]
    if (text.startsWith('/botmsg')) {
        const newMsg = text.replace('/botmsg', '').trim();
        if (!newMsg) return bot.sendMessage(adminId, "⚠️ <b>Oops!</b> You forgot the message.\nExample: <code>/botmsg Welcome to the club!</code>", { parse_mode: 'HTML' });
        
        db.welcomeMessage = newMsg;
        bot.sendMessage(adminId, `✅ <b>MESSAGE UPDATED</b>\nUsers will now receive this DM when accepted:\n\n${db.welcomeMessage}`, { parse_mode: 'HTML' });
    }

    // Command: /setdelay [group_number] [seconds]
    else if (text.startsWith('/setdelay')) {
        const args = text.split(' ');
        const groupNum = parseInt(args[1]);
        const seconds = parseInt(args[2]);

        if (isNaN(groupNum) || isNaN(seconds)) {
            return bot.sendMessage(adminId, "⚠️ <b>Invalid Format.</b>\nExample: <code>/setdelay 1 15</code> (Sets Group 1 to wait 15 seconds before accepting)", { parse_mode: 'HTML' });
        }

        const groupIndex = groupNum - 1;
        if (!db.groups[groupIndex]) return bot.sendMessage(adminId, "⚠️ Invalid group number. Send /groups to check your list.");

        db.groups[groupIndex].delayMs = seconds * 1000;
        bot.sendMessage(adminId, `✅ <b>DELAY SET SUCCESSFULLY</b>\nGroup: ${db.groups[groupIndex].title}\nBot will now wait ${seconds} seconds to gather users before accepting them all at once.`, { parse_mode: 'HTML' });
    }

    // Command: /toggle [group_number]
    else if (text.startsWith('/toggle')) {
        const args = text.split(' ');
        const groupNum = parseInt(args[1]);

        if (isNaN(groupNum)) return bot.sendMessage(adminId, "⚠️ <b>Invalid Format.</b>\nExample: <code>/toggle 1</code> (Turns Group 1 ON or OFF)", { parse_mode: 'HTML' });

        const groupIndex = groupNum - 1;
        if (!db.groups[groupIndex]) return bot.sendMessage(adminId, "⚠️ Invalid group number. Send /groups to check your list.");

        db.groups[groupIndex].autoAccept = !db.groups[groupIndex].autoAccept;
        
        const isNowOn = db.groups[groupIndex].autoAccept;
        const statusText = isNowOn ? "🟢 ON (Bot is accepting users)" : "🔴 OFF (Bot is ignoring join requests)";
        
        bot.sendMessage(adminId, `⚙️ <b>STATUS CHANGED</b>\nGroup: ${db.groups[groupIndex].title}\nAuto-Accept is now: ${statusText}`, { parse_mode: 'HTML' });
    }

    // Command: /groups - Dashboard view
    else if (text.startsWith('/groups')) {
        if (db.groups.length === 0) {
            return bot.sendMessage(adminId, "⚠️ You haven't added the bot to any groups yet.\n\n*(Note: If Railway restarted, the bot's memory was wiped. Remove the bot from your group and add it back to re-register it).*", { parse_mode: 'HTML' });
        }
        
        let list = "📋 <b>MANAGED GROUPS DASHBOARD:</b>\n\n";
        db.groups.forEach((g, index) => {
            const status = g.autoAccept ? "🟢 ON" : "🔴 OFF";
            const delay = g.delayMs / 1000;
            const waitingCount = g.pendingUsers ? g.pendingUsers.length : 0;
            list += `<b>${index + 1}. ${g.title}</b>\n   ↳ Accept Users: ${status}\n   ↳ Wait Time: ${delay} seconds\n   ↳ Users Waiting: ${waitingCount}\n\n`;
        });
        
        bot.sendMessage(adminId, list, { parse_mode: 'HTML' });
    }

    // Command: /group [number] - Broadcast
    else if (text.startsWith('/group ')) {
        if (!msg.reply_to_message) return bot.sendMessage(adminId, "⚠️ Please <b>reply</b> to the message you want to send.", { parse_mode: 'HTML' });
        
        const groupIndex = parseInt(text.split(' ')[1]) - 1;
        const targetGroup = db.groups[groupIndex];

        if (targetGroup) {
            try {
                await bot.copyMessage(targetGroup.id, adminId, msg.reply_to_message.message_id);
                bot.sendMessage(adminId, `✅ <b>BROADCAST SUCCESSFUL</b>\nMessage sent to: ${targetGroup.title}`, { parse_mode: 'HTML' });
            } catch (err) {
                bot.sendMessage(adminId, `❌ <b>BROADCAST FAILED</b>\nCould not send to ${targetGroup.title}. Ensure the bot still has Admin permissions to send messages.`, { parse_mode: 'HTML' });
            }
        } else {
            bot.sendMessage(adminId, "⚠️ Invalid group number.");
        }
    }

    // Command: /all - Broadcast
    else if (text === '/all') {
        if (!msg.reply_to_message) return bot.sendMessage(adminId, "⚠️ Please <b>reply</b> to the message you want to send.", { parse_mode: 'HTML' });
        if (db.groups.length === 0) return bot.sendMessage(adminId, "No groups available to send to.");

        let successCount = 0;
        bot.sendMessage(adminId, `⏳ Broadcasting to ${db.groups.length} groups...`);

        for (const group of db.groups) {
            try {
                await bot.copyMessage(group.id, adminId, msg.reply_to_message.message_id);
                successCount++;
            } catch (err) {}
        }
        bot.sendMessage(adminId, `✅ <b>BROADCAST COMPLETE</b>\nSuccessfully sent to ${successCount} out of ${db.groups.length} groups.`, { parse_mode: 'HTML' });
    }

    // Command: /start - Help menu
    else if (text === '/start') {
        const helpText = `
🛠 <b>ADVANCED ADMIN DASHBOARD</b>

<b>Settings & Status:</b>
<code>/groups</code> - View all groups and status
<code>/toggle 1</code> - Turn auto-accept ON/OFF for Group 1
<code>/setdelay 1 15</code> - Set Group 1 to wait 15 seconds
<code>/botmsg [text]</code> - Set DM for accepted users

<b>Broadcasting:</b>
1. Send an image/button/text message here.
2. <b>Reply</b> to it with <code>/group 1</code> to send to Group 1.
3. <b>Reply</b> to it with <code>/all</code> to send to everyone.
        `;
        bot.sendMessage(adminId, helpText, { parse_mode: 'HTML' });
    }
});

console.log("Bot is running...");