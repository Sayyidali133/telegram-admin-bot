sendMessage(adminId, "⚠️ Invalid group number. Check /groups.");
        }
    }

    // Command: /all - Broadcast to all groups via reply
    else if (text === '/all') {
        if (!msg.reply_to_message) {
            return bot.sendMessage(adminId, "⚠️ Please reply to the message you want to send with /all.");
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
🛠 Admin Dashboard

Setup:
1. Add me to groups as an Admin.
2. Ensure "Approve new members" is turned ON in your group's invite link settings.

Commands:
\`/botmsg [text]\` - Set DM for accepted users
\`/setdelay [seconds]\` - Set delay before accepting
\`/groups\` - View all connected groups

Broadcasting (Supports Images & Buttons):
1. Send the perfect message here in my DMs.
2. Reply to that message with \`/all\` to send to everyone.
3. Reply to that message with \`/group 1\` to send to a specific group.
        `;
        bot.sendMessage(adminId, helpText, { parse_mode: 'Markdown' });
    }
});

console.log("Bot is running...");