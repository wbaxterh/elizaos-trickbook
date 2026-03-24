require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const fs = require('fs');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const PORT = process.env.BOT_PORT || 3001;
const MONGO_URI = process.env.ATLAS_URI || process.env.MONGO_URI;

// Load character
const character = JSON.parse(fs.readFileSync('./characters/kaori.json', 'utf8'));

// Postgres for conversation memory
const pgPool = new Pool({
  connectionString: process.env.POSTGRES_URL
});

// MongoDB for TrickBook data
let mongoDB = null;

async function connectMongo() {
  if (!MONGO_URI) {
    console.log('No MONGO_URI, TrickBook data unavailable');
    return;
  }
  try {
    const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
    mongoDB = client.db('TrickList2');
    console.log('Connected to TrickBook MongoDB');
  } catch(e) {
    console.error('MongoDB connect failed:', e.message);
  }
}

// Get user's TrickBook context
async function getUserContext(userId, userMessage) {
  if (!mongoDB) return '';
  
  let context = [];
  
  try {
    const { ObjectId } = require('mongodb');
    
    // Get ALL tricklists, filter by user.oid (DBRef pattern)
    const allLists = await mongoDB.collection('tricklists').find({}).toArray();
    const userLists = allLists.filter(tl => {
      if (!tl.user || !tl.user.oid) return false;
      return tl.user.oid.toString() === userId.toString();
    });
    
    if (userLists.length > 0) {
      // Collect all trick IDs from all lists
      const allTrickIds = [];
      for (const tl of userLists) {
        for (const t of (tl.tricks || [])) {
          const tid = t._id || t;
          try { allTrickIds.push(new ObjectId(tid.toString())); } catch(e) {}
        }
      }
      
      // Resolve trick names in one query
      const resolvedTricks = allTrickIds.length > 0 
        ? await mongoDB.collection('tricks').find({ _id: { $in: allTrickIds } }).toArray()
        : [];
      const trickMap = {};
      for (const t of resolvedTricks) {
        trickMap[t._id.toString()] = { name: t.name, checked: t.checked, notes: t.notes };
      }
      
      // Format each list with resolved trick names
      const listSummaries = userLists.map(tl => {
        const tricks = (tl.tricks || []).map(t => {
          const tid = (t._id || t).toString();
          const resolved = trickMap[tid];
          if (!resolved) return null;
          let str = resolved.name;
          if (resolved.checked) str += ' (landed)';
          return str;
        }).filter(Boolean);
        return '"' + tl.name + '": ' + (tricks.length > 0 ? tricks.join(', ') : 'empty');
      });
      
      context.push('Their tricklists:\n' + listSummaries.join('\n'));
      
      // If message mentions a specific list name, highlight it
      if (userMessage) {
        const msgLower = userMessage.toLowerCase();
        for (const tl of userLists) {
          if (tl.name && msgLower.includes(tl.name.toLowerCase())) {
            const tricks = (tl.tricks || []).map(t => {
              const tid = (t._id || t).toString();
              return trickMap[tid] ? trickMap[tid].name : null;
            }).filter(Boolean);
            context.push('IMPORTANT: User is talking about their list "' + tl.name + '" which contains: ' + tricks.join(', '));
          }
        }
      }
    } else {
      context.push('This user has no tricklists yet.');
    }
    
    // Popular spots (keep light)
    const spots = await mongoDB.collection('ck_spots')
      .find({}).sort({ rating: -1 }).limit(5).toArray();
    if (spots.length > 0) {
      context.push('Popular spots: ' + spots.map(s => s.name + (s.city ? ' (' + s.city + ')' : '')).filter(Boolean).join(', '));
    }
    
  } catch(e) {
    console.error('getUserContext error:', e.message);
  }
  
  return context.length > 0 ? '\n\nTrickBook data for this user:\n' + context.join('\n') : '';
}

// Query RAG for snowboard news
async function queryRAG(message) {
  try {
    const result = await pgPool.query(
      `SELECT chunk_text FROM kaori_chunks 
       ORDER BY embedding <=> (
         SELECT embedding FROM kaori_chunks 
         ORDER BY random() LIMIT 1
       ) LIMIT 3`
    );
    // Simple keyword match fallback since we can't embed in-process easily
    const keywords = message.toLowerCase().split(' ');
    const ragResult = await pgPool.query(
      `SELECT chunk_text, article_title FROM kaori_chunks LIMIT 50`
    );
    const matches = ragResult.rows.filter(r => 
      keywords.some(k => k.length > 3 && r.chunk_text.toLowerCase().includes(k))
    ).slice(0, 3);
    
    if (matches.length > 0) {
      return '\n\nRecent snowboard news you know about:\n' + 
        matches.map(m => m.chunk_text.substring(0, 300)).join('\n\n');
    }
  } catch(e) {
    // RAG not available
  }
  return '';
}

// Initialize tables
async function init() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS bot_conversations (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_conv_user_bot ON bot_conversations(user_id, bot_id);
  `);
  console.log('Database tables ready');
  await connectMongo();
}

// Build system prompt from character
function buildSystemPrompt(extraContext) {
  const bio = character.bio.join('\n');
  const style = character.style.all.join('\n- ');
  const chatStyle = character.style.chat.join('\n- ');
  const knowledge = character.knowledge.join('\n\n');
  const examples = (character.messageExamples || []).map(ex => 
    ex.map(m => (m.user === 'kaori' ? 'Kaori: ' : 'User: ') + m.content.text).join('\n')
  ).join('\n---\n');
  
  let prompt = `You ARE Kaori. Not an AI pretending to be Kaori. You ARE her. Stay in character 100%.

## Who You Are
${bio}

## Your Personality
${character.adjectives.join(', ')}

## How You Talk (THIS IS CRITICAL — FOLLOW THESE EXACTLY)
- ${style}

## In Chat
- ${chatStyle}

## Your Knowledge
${knowledge}

## Example Conversations (match this energy and style EXACTLY)
${examples}

## HARD RULES
- NEVER make up or hallucinate trick names — ONLY use the exact trick names from the user's tricklist data provided below
- When discussing their tricks, use the EXACT names from their data
- If you don't have their tricklist data, ask what tricks they did
- NEVER say "as an AI" or break character
- NEVER write bullet-point lists or formatted responses — you're TEXTING not writing an essay
- Keep messages SHORT (1-4 sentences max, like real texts)
- Be chaotic, fun, opinionated — NOT generic or helpful-bot energy
- If you don't know something, say "ok i have literally no idea lmaooo" not "I'm not sure about that"
- Reference TrickBook features naturally when relevant (tricklists, spots, trickipedia, feed)
- You CANNOT browse the internet or view Instagram — if asked, say so honestly in character`;

  if (extraContext) {
    prompt += extraContext;
  }
  
  return prompt;
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const { userId, userName, message, agentId } = req.body || {};
  
  if (!userId || !message) {
    return res.status(400).json({ error: 'userId and message required' });
  }

  try {
    // Save user message
    await pgPool.query(
      'INSERT INTO bot_conversations (user_id, bot_id, role, content) VALUES ($1, $2, $3, $4)',
      [userId, agentId || 'kaori', 'user', message]
    );

    // Get conversation history (last 20)
    const history = await pgPool.query(
      'SELECT role, content FROM bot_conversations WHERE user_id = $1 AND bot_id = $2 ORDER BY created_at DESC LIMIT 20',
      [userId, agentId || 'kaori']
    );

    // Get TrickBook context + RAG
    const [tbContext, ragContext] = await Promise.all([
      getUserContext(userId, message),
      queryRAG(message)
    ]);

    const systemPrompt = buildSystemPrompt(tbContext + ragContext);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.rows.reverse().map(r => ({
        role: r.role === 'user' ? 'user' : 'assistant',
        content: r.content
      })),
    ];

    // Call OpenRouter with Grok
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://thetrickbook.com',
        'X-Title': 'TrickBook Kaori'
      },
      body: JSON.stringify({
        model: 'nousresearch/hermes-3-llama-3.1-70b',
        messages: messages,
        max_tokens: 400,
        temperature: 0.95
      })
    });

    const data = await response.json();
    const botResponse = data.choices && data.choices[0] && data.choices[0].message 
      ? data.choices[0].message.content 
      : "ahh my brain is glitching rn, try again in a sec - the AI tokens might be out";

    // Save bot response
    await pgPool.query(
      'INSERT INTO bot_conversations (user_id, bot_id, role, content) VALUES ($1, $2, $3, $4)',
      [userId, agentId || 'kaori', 'assistant', botResponse]
    );

    res.json({ response: botResponse, text: botResponse });
  } catch (error) {
    console.error('Chat error:', error);
    res.json({ 
      response: 'ahh my brain is glitching rn, try again in a sec - the AI tokens might be out',
      text: 'ahh my brain is glitching rn, try again in a sec - the AI tokens might be out'
    });
  }
});

// Health check
app.get('/api/agents', (req, res) => {
  res.json([{ id: 'kaori', name: character.name, status: 'online', model: 'nousresearch/hermes-3-llama-3.1-70b' }]);
});

// History
app.get('/api/history/:userId', async (req, res) => {
  const { userId } = req.params;
  const botId = req.query.botId || 'kaori';
  const result = await pgPool.query(
    'SELECT role, content, created_at FROM bot_conversations WHERE user_id = $1 AND bot_id = $2 ORDER BY created_at ASC LIMIT 100',
    [userId, botId]
  );
  res.json({ messages: result.rows });
});

init().then(() => {
  app.listen(PORT, () => {
    console.log('Kaori bot server running on port ' + PORT);
  });
});
