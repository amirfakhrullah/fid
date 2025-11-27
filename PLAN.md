# Video Finder - Project Plan

> Hackathon project: Search videos by natural language and get exact timestamps of matching content.

## Overview

A hybrid video search system that allows users to:
- Upload videos to storage
- Search using natural language (e.g., "red shirt", "person running")
- Get matched videos with **exact timestamps** where the content appears

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Upload    │────▶│  Processing      │────▶│  Vector Store   │
│   Video     │     │  Pipeline        │     │  (Embeddings)   │
└─────────────┘     └──────────────────┘     └─────────────────┘
                            │                        │
                            ▼                        ▼
                    ┌──────────────────┐     ┌─────────────────┐
                    │  - Frame Extract │     │  Hybrid Search  │◀── User Query
                    │  - Transcription │     │  - Visual       │
                    │  - AI Analysis   │     │  - Keywords     │───▶ Results
                    │  - Keywords      │     │  - Transcript   │    + Timestamps
                    └──────────────────┘     │  - Summary      │
                                             └─────────────────┘
```

---

## Tech Stack (Hackathon Sponsors)

| Component | Technology | Sponsor |
|-----------|------------|---------|
| **Frontend** | Next.js 14 (App Router) | Vercel |
| **Hosting** | Vercel | Vercel |
| **Backend** | Convex (serverless functions) | Convex |
| **Database** | Convex (built-in) | Convex |
| **Vector Search** | Convex Vector Search | Convex |
| **File Storage** | Convex File Storage | Convex |
| **Vision AI** | Claude Vision (claude-3-5-sonnet) | Anthropic |
| **Summarization** | Claude | Anthropic |
| **Transcription** | Groq Whisper (ultra-fast) | Groq |
| **Image Embeddings** | Voyage AI / OpenAI CLIP | - |
| **Text Embeddings** | Voyage AI / OpenAI | - |
| **Frame Extraction** | FFmpeg (via Convex action) | - |
| **IDE** | Cursor | Cursor |

### Why This Stack?

- **Convex** handles backend, DB, vector search, AND file storage in one - huge time saver
- **Claude Vision** is excellent at understanding image content and extracting keywords
- **Groq** has the fastest Whisper inference (~10x faster than alternatives)
- **Vercel** + Next.js = instant deployment with great DX

---

## Key Technologies Explained

### OpenAI CLIP (Contrastive Language-Image Pre-training)

CLIP is a model that understands **both images and text in the same embedding space**. It was trained on 400M image-text pairs.

**Why it's perfect for video search:**

```
"red shirt" (text) ──→ [0.2, 0.5, 0.1, ...] ──┐
                                               ├── Similar vectors!
[image of red shirt] ──→ [0.2, 0.4, 0.1, ...] ─┘
```

**Usage in this project:**

```javascript
// 1. When processing video - embed frames as images
const frameEmbedding = await clipModel.embedImage(frameBuffer);
// → [0.2, 0.5, 0.1, ...] (512 or 768 dimensions)

// 2. When searching - embed query as text
const queryEmbedding = await clipModel.embedText("red shirt");
// → [0.2, 0.4, 0.1, ...] (same dimensions)

// 3. Vector search finds frames with similar embeddings
const results = await vectorDB.search(queryEmbedding);
// → Returns frames visually matching "red shirt"
```

### Claude Vision (Anthropic)

Claude's multimodal capability to analyze images. Send an image to Claude and it returns text descriptions.

**Usage in this project:**

```javascript
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{
    role: "user",
    content: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: frameBase64  // extracted video frame
        }
      },
      {
        type: "text",
        text: "List all objects, people, colors, actions, and setting as keywords."
      }
    ]
  }]
});
// Returns: "person, red shirt, walking, park, sunny, grass, trees..."
```

### CLIP vs Claude Vision

| | CLIP | Claude Vision |
|---|------|---------------|
| **Output** | Embedding vector (numbers) | Text description |
| **Use case** | Direct visual similarity search | Extract keywords, describe content |
| **Speed** | Very fast | Slower (LLM call) |
| **Cost** | Cheaper | More expensive |

**We use both:**
- **CLIP** → embed frames for fast visual similarity search
- **Claude Vision** → extract keywords/descriptions for semantic search

---

## Data Models

### Video Metadata
```json
{
  "id": "uuid",
  "filename": "video.mp4",
  "duration": 120.5,
  "storage_url": "s3://...",
  "uploaded_at": "2024-01-01T00:00:00Z",
  "summary": "A person walks through a park wearing a red shirt...",
  "summary_embedding": [0.1, 0.2, ...],
  "transcript": "Full transcript text...",
  "transcript_embedding": [0.1, 0.2, ...]
}
```

### Frame Data
```json
{
  "id": "uuid",
  "video_id": "uuid",
  "timestamp": 15.5,
  "thumbnail_url": "s3://thumbnails/...",
  "frame_embedding": [0.1, 0.2, ...],
  "keywords": ["person", "red shirt", "walking", "park", "sunny"],
  "keywords_embedding": [0.1, 0.2, ...],
  "description": "A person wearing a red shirt walks on a path..."
}
```

---

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Set up project structure (backend + frontend)
- [ ] Configure storage bucket for videos
- [ ] Set up vector database
- [ ] Create database schema for metadata

### Phase 2: Video Processing Pipeline
- [ ] Video upload endpoint
- [ ] Frame extraction (every 2 seconds or scene-based)
- [ ] Generate thumbnails for extracted frames
- [ ] Audio extraction for transcription

### Phase 3: Embedding Generation
- [ ] Image frame embeddings (CLIP/SigLIP)
- [ ] AI keyword extraction from frames (GPT-4o/Claude Vision)
- [ ] Keyword embeddings
- [ ] Video transcription (Whisper)
- [ ] Transcript embeddings (chunked with timestamps)
- [ ] Video summary generation
- [ ] Summary embeddings

### Phase 4: Search Implementation
- [ ] Query embedding generation
- [ ] Parallel vector searches across all embedding types:
  - Frame embeddings (visual similarity)
  - Keyword embeddings (semantic object search)
  - Transcript embeddings (spoken content)
  - Summary embeddings (overall context)
- [ ] Score fusion/reranking
- [ ] Temporal clustering (group nearby timestamps)
- [ ] Return results with video + timestamp ranges

### Phase 5: Frontend
- [ ] Video upload interface
- [ ] Search input
- [ ] Results display with:
  - Video thumbnails
  - Timestamp links (click to jump)
  - Preview frames
  - Relevance scores

### Phase 6: Polish (if time permits)
- [ ] Batch processing queue
- [ ] Progress indicators for processing
- [ ] Search filters (by video, date range)
- [ ] Playback with timestamp highlighting

---

## Search Algorithm

```python
def hybrid_search(query: str, weights: dict = None):
    weights = weights or {
        "frame": 0.35,      # Visual similarity
        "keywords": 0.30,   # Object/scene keywords
        "transcript": 0.20, # Spoken content
        "summary": 0.15     # Overall context
    }

    # 1. Embed the query
    text_embedding = embed_text(query)
    image_embedding = embed_text_for_clip(query)  # CLIP text encoder

    # 2. Search each index
    frame_results = search_frames(image_embedding)
    keyword_results = search_keywords(text_embedding)
    transcript_results = search_transcripts(text_embedding)
    summary_results = search_summaries(text_embedding)

    # 3. Combine with weights
    combined = fuse_results(
        frame_results, keyword_results,
        transcript_results, summary_results,
        weights=weights
    )

    # 4. Cluster timestamps & return
    return cluster_timestamps(combined)
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/videos/upload` | Upload new video |
| GET | `/api/videos/:id/status` | Check processing status |
| GET | `/api/videos` | List all videos |
| POST | `/api/search` | Search across all videos |
| GET | `/api/videos/:id/frames` | Get frames for a video |

---

## Example Search Response

```json
{
  "query": "red shirt",
  "results": [
    {
      "video_id": "abc123",
      "video_title": "Park Walk.mp4",
      "thumbnail_url": "...",
      "matches": [
        {
          "start_time": 15.0,
          "end_time": 23.0,
          "confidence": 0.92,
          "preview_frame": "...",
          "match_sources": ["frame", "keywords"]
        },
        {
          "start_time": 45.0,
          "end_time": 48.0,
          "confidence": 0.78,
          "preview_frame": "...",
          "match_sources": ["frame"]
        }
      ]
    }
  ]
}
```

---

## Hackathon Tips

1. **Start simple** - Get one embedding type working end-to-end first (frames)
2. **Use hosted services** - Don't self-host vector DBs; use Pinecone/Qdrant cloud
3. **Limit video length** - Cap at 2-5 min videos for demo
4. **Pre-process demo videos** - Have some videos ready before presentation
5. **Cache aggressively** - Cache embeddings, don't recompute

---

## MVP Checklist (Minimum for Demo)

- [ ] Upload video → extract frames → embed frames
- [ ] Search query → find matching frames → return timestamps
- [ ] Basic UI showing results with clickable timestamps
- [ ] 2-3 demo videos pre-loaded

Everything else is bonus!
