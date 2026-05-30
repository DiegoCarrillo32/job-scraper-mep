const { Client, LocalAuth } = require('whatsapp-web.js');

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('ready', async () => {
    console.log('WhatsApp Client is ready!\n');
    console.log('--- YOUR WHATSAPP GROUPS ---');
    
    // Get all chats
    const chats = await client.getChats();
    
    // Filter out only groups
    const groups = chats.filter(chat => chat.isGroup);
    
    if (groups.length === 0) {
        console.log("No groups found.");
    } else {
        groups.forEach(group => {
            console.log(`Name: "${group.name}"`);
            console.log(`Group ID: ${group.id._serialized}\n`);
        });
    }
    
    console.log('----------------------------');
    console.log('Copy the Group ID you want to use and paste it as the "whatsappNumber" in your config.json.');
    console.log('You can now press Ctrl+C to stop this script.');
    process.exit(0);
});

console.log("Starting WhatsApp client... This can take 15-30 seconds to restore the session.");
client.initialize();
