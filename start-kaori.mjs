import { Agent, createAgent } from '@elizaos/core';
import { PostgresAdapter } from '@elizaos/adapter-postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startKaori() {
  try {
    // Load Kaori character
    const characterPath = path.join(__dirname, 'characters', 'kaori.json');
    const kaoriCharacter = JSON.parse(fs.readFileSync(characterPath, 'utf8'));
    
    console.log('Starting Kaori bot...');
    console.log('Character:', kaoriCharacter.name);
    
    // Create agent with Kaori character
    const agent = createAgent({
      character: kaoriCharacter,
      adapters: [PostgresAdapter]
    });
    
    console.log('Kaori is ready! 🏂✨');
    console.log('Agent created successfully');
    
    // Keep the process running
    process.on('SIGINT', () => {
      console.log('Shutting down Kaori bot...');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start Kaori:', error);
    process.exit(1);
  }
}

startKaori().catch(console.error);