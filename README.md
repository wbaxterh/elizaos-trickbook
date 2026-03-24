# ElizaOS TrickBook - Kaori AI Companion

AI companion bot server for [TrickBook](https://thetrickbook.com). Powers Kaori — an 18yo pro snowboarder from Sapporo, based on SSX Tricky's Kaori Nishidake.

## Architecture
- Express server on port 3001
- OpenRouter (Hermes 3 70B) for LLM
- PostgreSQL for conversation memory
- MongoDB (TrickBook) for user data (tricklists, spots, tricks)
- pgvector RAG from snowboard news articles

## Endpoints
- `POST /api/chat` — Send message, get Kaori's response
- `GET /api/agents` — Health check
- `GET /api/history/:userId` — Conversation history
