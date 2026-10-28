# job-fit-rag

Paste in a job posting, and this tool tells you which requirements your resume actually backs up, which ones are gaps, and how sure it is. Then it measures itself against your own judgment, so you know when to trust it.

I built it to run my own job search.

## How it works

```
Job posting (Notion database or .txt file)
        │
        ▼
Claude extracts requirements ──► embed each one ──► Postgres (pgvector)
                                                          │
Resume bullets (data/resume.json) ──► embed each one ─────┤
                                                          ▼
                              top-k bullets per requirement (cosine similarity)
                                                          │
                                                          ▼
                              SUPPORTED / GAP report  +  evals vs. hand labels
```

- **Extraction:** Claude turns a posting into short, standalone requirements, each tagged `required` or `nice_to_have`.
- **Embeddings:** A small local model (`all-MiniLM-L6-v2` via transformers.js) runs on your machine, with no API key or per-call cost.
- **Storage:** Postgres with the pgvector extension, run in Docker, holds resume bullets, postings, requirements, and saved matches.
- **Retrieval:** pgvector finds the closest resume bullets for each requirement. A requirement counts as supported when its best match clears `MATCH_THRESHOLD`.
- **Evals:** You label each requirement true or false by hand. `npm run eval` reports precision and recall, sweeps thresholds, and lists every disagreement.

## Setup

You need Node 20+, Docker, and an Anthropic API key.

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY
npm run db:up                 # starts Postgres with pgvector
npm run db:init               # creates the tables
```

## Usage

```bash
npm run ingest:resume                  # embeds data/resume.json
npm run ingest:postings                # extracts + embeds every posting
npm run match                          # lists posting ids
npm run match -- file:notion-ai        # SUPPORTED / GAP report for one posting
npm run web                            # same thing in the browser at http://localhost:3000
```

### Web UI

`npm run web` starts a small local server (Node's built-in `http`, no framework) at http://localhost:3000.

- Paste a company, title, and job description, then click **Check fit**.
- The report shows a supported-requirements score, each requirement marked SUPPORTED or GAP (required vs. nice-to-have), and the closest resume bullets with similarity scores. Filter by supported or gap.
- Reopen any posting you've checked before from the dropdown, without calling Claude again.
- Each pasted posting is also saved to `data/postings/<company>-<title>.txt`, so the CLI and evals see it under the same `file:` id.

The server reads `.env` at startup, so restart it after changing the API key or model.

### Cost

Only requirement extraction calls Claude: one call per posting checked. Embeddings and matching run locally for free. After each check, the web UI (and `ingest:postings` in the terminal) shows that call's input and output tokens and its cost in dollars. With `claude-sonnet-5-5` a typical posting costs about 1–2 cents. Prices live in `PRICES` in `src/extract.ts`; add a row if you change `CLAUDE_MODEL`.

**Adding postings:** Either save them as `data/postings/<name>.txt` (see `example.txt.sample`), or point the tool at a Notion job-tracker database by setting `NOTION_TOKEN` and `NOTION_DATA_SOURCE_ID`. Each Notion page needs `Company` and `Role` properties, with the job description in the page body.

## Evals

```bash
npm run eval:template -- file:notion-ai   # writes evals/labels/file_notion-ai.json
# set each "met" to true or false by hand
npm run eval
```

Precision matters most here. A false positive means the tool says you meet a requirement you don't, which is exactly the claim you don't want on a resume.

## Decisions to make (and write up as you go)

- **Chunking:** One bullet per chunk. Would splitting long bullets into separate claims retrieve better?
- **Embedding model:** Local and free versus a hosted model. Swap it in `src/embed.ts` and compare with evals.
- **Threshold:** Pick `MATCH_THRESHOLD` from the eval sweep, not by feel.
- **Extraction prompt:** How granular should a "requirement" be? Change the prompt in `src/extract.ts` and re-run the evals.

## Results

_Fill this in once you've labeled a few postings: precision and recall at your chosen threshold, and what kinds of requirements it gets wrong._
# dion-pham-job-fit-rag
