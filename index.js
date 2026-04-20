const groupNum = parseInt(args[1]);

        if (isNaN(groupNum)) {
            return bot.sendMessage(adminId, "⚠️ Format: /toggle [group_number]`\n\n*Example:* `/toggle 1 (Turns Group 1 ON or OFF)", { parse_mode: 'Markdown' });
        }

        const groupIndex = groupNum - 1;
        if (!db.groups[groupIndex]) {
            return bot.sendMessage(adminId, "⚠️ Invalid group number. Check /groups.");
        }

        // Flip the boolean
        db.groups[groupIndex].autoAccept = !db.groups[groupIndex].autoAccept;
        const status = db.groups[groupIndex].autoAccept ? "🟢 ON" : "🔴 OFF";
        
        bot.sendMessage(adminId, ⚙️ Auto-accept for **${db.groups[groupIndex].title}** is now ${status}, { parse_mode: 'Markdown' });
    }

    // Command: /groups - Dashboard view
    else if (text === '/groups') {
        if (db.groups.length === 0) return bot.sendMessage(adminId, "You haven't added the bot to any groups yet.");
        
        let list = "📋 **Managed Groups Dashboard:**\n\n";
        db.groups.forEach((g, index) => {
            const status = g.autoAccept ? "🟢 ON" : "🔴 OFF";
            const delay = g.delayMs / 1000;
            list += **${index + 1}. ${g.title}**\n   ↳ Status: ${status} | Delay: ${delay}s\n\n;
        });
        
        bot.sendMessage(adminId, list, { parse_mode: 'Markdown' });
    }

    // Command: /group [number] - Broadcast to specific group
    else if (text.startsWith('/group ')) {
        if (!msg.reply_to_message) {
            return bot.sendMessage(adminId, "⚠️ Please reply to the message you want to send with /group [number].", { parse_mode: 'Markdown' });
        }
        
        const groupIndex = parseInt(text.split(' ')[1]) - 1;
        const targetGroup = db.groups[groupIndex];

        if (targetGroup) {
            try {
                await bot.copyMessage(targetGroup.id, adminId, msg.reply_to_message.message_id);
                bot.sendMessage(adminId, `✅ Message sent to ${targetGroup.title}`);
            } catch (err) {
                bot.sendMessage(adminId, `❌ Failed to send to ${targetGroup.title}. Ensure bot is admin.`);
            }
        } else {
            bot.sendMessage(adminId, "⚠️ Invalid group number. Check /groups.");
        }
    }

    // Command: /all - Broadcast to all groups
    else if (text === '/all') {
        if (!msg.reply_to_message) {
            return bot.sendMessage(adminId, "⚠️ Please reply to the message you want to send with /all.", { parse_mode: 'Markdown' });
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
🛠 Advanced Admin Dashboard

Auto-Accept Settings:
\`/groups\` - View all groups, their ON/OFF status, and delays
\`/toggle 1\` - Turn auto-accept ON or OFF for Group 1
\`/setdelay 1 15\` - Set a 15-second delay for Group 1
\`/botmsg [text]\` - Set the DM for accepted users (Global)

Broadcasting:
1. Send the perfect message (images/buttons) here in my DMs.
2. Reply to it with \`/group 1\` to send to Group 1.
3. Reply to it with \`/all\` to send to everyone.
        `;
        bot.sendMessage(adminId, helpText, { parse_mode: 'Markdown' });
    }
});

console.log("Bot is running...");