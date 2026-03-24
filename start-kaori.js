const { core } = require('@elizaos/core');
const { PostgresAdapter } = require('@elizaos/adapter-postgres');
const fs = require('fs');
const path = require('path');

async function startKaori() {
  try {
    // Load Kaori character
    const characterPath = path.join(__dirname, 'characters', 'kaori.json');
    const kaoriCharacter = JSON.parse(fs.readFileSync(characterPath, 'utf8'));
    
    console.log('Starting Kaori bot...');
    console.log('Character:', kaoriCharacter.name);
    
    // Initialize ElizaOS with Kaori character
    const elizaos = await core.initialize({
      character: kaoriCharacter,
      adapters: [PostgresAdapter],
      port: 3000
    });
    
    console.log('Kaori is ready! 🏂✨');
    console.log('ElizaOS running on http://localhost:3000');
    
  } catch (error) {
    console.error('Failed to start Kaori:', error);
    process.exit(1);
  }
}

startKaori().catch(console.error);