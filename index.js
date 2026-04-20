require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

const token = process.env.BOT_TOKEN;
const adminId = parseInt(process.env.ADMIN_ID);

// 1. Initialize Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const firestore = admin.firestore();
const dbRef = firestore.collection('telegramBot').doc('serverData');

const bot = new TelegramBot(token, { polling: true });

let db = {
    welcomeMessage: "Hello! Your request to join has been approved.",
    groups: [] 
};

// Sync Memory to Firebase
const syncToDatabase = () => {
    dbRef.set(db).catch(err => console.error("Firebase save error:", err));
};

const isAdmin = (msg) => (msg.from ? msg.from.id : msg.chat.id) === adminId;
const cleanTitle = (title) => title ? title.replace(/[_*[\]()~`>#+-=|{}.!]/g, '') : "Group";

async function startBot() {
    // Load data from Firebase
    const snapshot = await dbRef.get();
    if (snapshot.exists) {
        db = snapshot.data();
        // Ensure all groups have a pendingUsers array
        db.groups = db.groups.map(g => ({ ...g, pendingUsers: g.pendingUsers || [] }));
    }

    // 1. Handle Join Requests (Collection Only)
    bot.on('chat_join_request', async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const group = db.groups.find(g => g.id === chatId);

        if (!group || group.autoAccept === false) return;

        // Add to list if not already there
        if (!group.pendingUsers.includes(userId)) {
            group.pendingUsers.push(userId);
            syncToDatabase();
        }
    });

    // 2. Handle Dashboard Button Clicks
    bot.on('callback_query', async (query) => {
        const data = query.data;
        const [action, index] = data.split('_');
        const group = db.groups[parseInt(index)];

        if (!group) return bot.answerCallbackQuery(query.id, { text: "Group not found" });

        // ACTION: ACCEPT ALL
        if (action === 'accept') {
            const count = group.pendingUsers.length;
            if (count === 0) return bot.answerCallbackQuery(query.id, { text: "No pending requests!" });

            bot.answerCallbackQuery(query.id, { text: `Accepting ${count} users...` });
            
            const usersToProcess = [...group.pendingUsers];
            group.pendingUsers = []; // Clear list immediately
            syncToDatabase();

            for (const uid of usersToProcess) {
                try {
                    if (db.welcomeMessage) await bot.sendMessage(uid, db.welcomeMessage);
                    await bot.approveChatJoinRequest(group.id, uid);
                } catch (e) {}
            }
            bot.sendMessage(adminId, `✅ Finished accepting ${count} users in ${group.title}`);
        }

        // ACTION: TOGGLE ON/OFF
        if (action === 'toggle') {
            group.autoAccept = !group.autoAccept;
            syncToDatabase();
            bot.answerCallbackQuery(query.id, { text: `Auto-accept is now ${group.autoAccept ? "ON" : "OFF"}` });
        }

        // Refresh the dashboard message
        showDashboard(query.message.chat.id, query.message.message_id);
    });

    // 3. Main Dashboard Function
    async function showDashboard(chatId, messageId = null) {
        if (db.groups.length === 0) return bot.sendMessage(chatId, "No groups managed yet.");

        let totalReq = 0;
        let text = "📊 <b>LIVE REQUEST DASHBOARD</b>\n\n";

        const keyboard = [];

        db.groups.forEach((g, i) => {
            const count = g.pendingUsers.length;
            totalReq += count;
            const status = g.autoAccept ? "🟢 ON" : "🔴 OFF";
            
            text += `<b>${i + 1}. ${g.title}</b>\n`;
            text += `Status: ${status} | Pending: <b>${count}</b>\n\n`;

            // Buttons for this group
            keyboard.push([
                { text: `✅ Accept (${count})`, callback_data: `accept_${i}` },
                { text: `${g.autoAccept ? "Stop Accepting" : "Start Accepting"}`, callback_data: `toggle_${i}` }
            ]);
        });

        text += `────────────────────\n<b>TOTAL PENDING REQS: ${totalReq}</b>`;

        const options = {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
        };

        if (messageId) {
            bot.editMessageText(text, { ...options, chat_id: chatId, message_id: messageId }).catch(() => {});
        } else {
            bot.sendMessage(chatId, text, options);
        }
    }

    // 4. Admin Commands
    bot.on('message', async (msg) => {
        if (!msg.text || !isAdmin(msg) || msg.chat.type !== 'private') return;
        const text = msg.text.trim();

        if (text === '/groups' || text === '/start') {
            showDashboard(msg.chat.id);
        }

        if (text.startsWith('/botmsg')) {
            const newMsg = text.replace('/botmsg', '').trim();
            if (!newMsg) return bot.sendMessage(adminId, "Usage: /botmsg Hello!");
            db.welcomeMessage = newMsg;
            syncToDatabase();
            bot.sendMessage(adminId, "✅ Welcome message updated.");
        }

        // Broadcast Logic (Keep existing /all and /group features)
        if (msg.reply_to_message && text === '/all') {
            bot.sendMessage(adminId, "⏳ Broadcasting...");
            for (const g of db.groups) {
                try { await bot.copyMessage(g.id, adminId, msg.reply_to_message.message_id); } catch (e) {}
            }
            bot.sendMessage(adminId, "✅ Broadcast complete.");
        }
    });

    // Handle bot joining new groups
    bot.on('my_chat_member', (msg) => {
        const chat = msg.chat;
        if (msg.new_chat_member.status === 'administrator') {
            if (!db.groups.find(g => g.id === chat.id)) {
                db.groups.push({ id: chat.id, title: cleanTitle(chat.title), autoAccept: true, pendingUsers: [] });
                syncToDatabase();
                bot.sendMessage(adminId, `✅ Added to ${chat.title}`);
            }
        }
    });

    console.log("Dashboard Bot Online");
}

startBot();