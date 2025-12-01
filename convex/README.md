# Convex Backend - Video Finder

## Structure

```
convex/
├── schema.ts              # Database schema with vector indexes
├── videos.ts              # Video CRUD operations
├── frames.ts              # Frame CRUD operations
├── processing.ts          # Auto-processing pipeline
├── search.ts              # Simple text search (query)
└── actions/
    ├── videoUpload.ts     # Upload videos from URL
    ├── frameExtraction.ts # Extract frames with FFmpeg
    ├── groqAnalysis.ts    # Analyze transcript with Groq Llama (PRIMARY)
    ├── transcription.ts   # Transcribe with Groq Whisper
    ├── embeddings.ts      # Generate embeddings (OpenAI)
    ├── claudeVision.ts    # Optional: Analyze frames with Claude Vision
    └── search.ts          # Hybrid vector search (action)
```

## Environment Variables

Add these to your Convex dashboard (Settings > Environment Variables):

```
GROQ_API_KEY=gsk_...             # Required: Whisper + Llama analysis
OPENAI_API_KEY=sk-...            # Required: Text embeddings + Vision (for frame descriptions)
REPLICATE_API_TOKEN=r8_...       # Optional: CLIP image embeddings (alternative to OpenAI Vision)
ANTHROPIC_API_KEY=sk-ant-...     # Optional: Claude Vision for deeper visual analysis
```

## Pipeline Architecture

**Primary (Multi-modal search with Groq + OpenAI):**
1. **Upload** → Video file to Convex storage
2. **Extract Frames** → FFmpeg extracts frames every 10s
3. **Transcribe** → Groq Whisper transcribes audio
4. **Analyze** → Groq Llama generates summary/keywords from transcript
5. **Embed Frames** → OpenAI Vision (GPT-4o-mini) describes frames, then embeds descriptions (1536-dim vectors)
6. **Embed Text** → OpenAI embeds transcript + summary (1536-dim vectors)
7. **Search** → Hybrid vector search across visual + text embeddings

**Cost per video (2 min):** ~$0.02-0.03 (Groq: $0.01 + OpenAI Vision: 12 frames × ~$0.001 = $0.012 + OpenAI embeddings: $0.002)

**Alternative: CLIP via Replicate (cheaper but with rate limits):**
- Uses CLIP for visual embeddings (512-dim vectors)
- Cost: ~$0.015 per video
- Requires payment method or patience (6 requests/min free tier)

**Optional (Claude Vision for enhanced visual understanding):**
- Samples 1 frame every 10 seconds (e.g., 6 frames for 1-min video, 30 frames for 5-min video)
- Analyzes each frame with Claude Vision to generate descriptions
- Cost scales with video length: ~$0.02 per minute
- Use when you need human-readable frame descriptions or videos with no audio

## Quick Start: Testing in Convex Dashboard

Test each step independently in the Convex Dashboard (Functions tab):

### Step 1: Upload Video from URL

```
Function: actions/videoUpload:uploadFromUrl
Args: { "url": "https://example.com/sample-video.mp4" }
Returns: { "success": true, "videoId": "abc123..." }
```

### Step 2: Extract Frames with FFmpeg

```
Function: actions/frameExtraction:extractFrames
Args: { "videoId": "<videoId from step 1>", "intervalSeconds": 2 }
Returns: { "success": true, "frameCount": 30 }
```

Downloads video, extracts frames every N seconds using FFmpeg, uploads to storage.

### Step 3: Analyze Frames with Claude Vision

```
Function: actions/claudeVision:analyzeFrame
Args: { "frameId": "<frameId from step 2>" }
Returns: { "success": true, "description": "...", "keywords": ["red", "shirt", ...] }
```

Or analyze all frames at once:
```
Function: actions/claudeVision:analyzeVideoFrames
Args: { "videoId": "<videoId>" }
```

### Step 4: Transcribe Video Audio

```
Function: actions/transcription:transcribeVideo
Args: { "videoId": "<videoId>" }
Returns: { "success": true, "transcript": "..." }
```

### Step 5: Generate Video Summary

```
Function: actions/claudeVision:generateVideoSummary
Args: { "videoId": "<videoId>" }
Returns: { "success": true, "summary": "..." }
```

### Step 6: Generate Embeddings

Frame keywords (text search):
```
Function: actions/embeddings:embedFrameKeywords
Args: { "frameId": "<frameId>" }
```

Frame images (visual search):
```
Function: actions/embeddings:embedFrameImage
Args: { "frameId": "<frameId>" }
```

Or batch all frames:
```
Function: actions/embeddings:embedVideoFrames
Args: { "videoId": "<videoId>" }
```

Video transcript + summary:
```
Function: actions/embeddings:embedVideoText
Args: { "videoId": "<videoId>" }
```

### Step 7: Search!

```
Function: actions/search:hybridSearch
Args: { "query": "person wearing red shirt" }
Returns: {
  "results": [{
    "videoId": "...",
    "filename": "...",
    "matches": [{ "startTime": 12, "endTime": 15, "confidence": 0.85, ... }],
    "overallScore": 0.92
  }]
}
```

### Function Dependencies

| Step | Function | Required Env Vars |
|------|----------|-------------------|
| 1 | `actions/videoUpload:uploadFromUrl` | - |
| 2 | `actions/frameExtraction:extractFrames` | - (uses FFmpeg) |
| 3 | `actions/claudeVision:analyzeFrame` | `ANTHROPIC_API_KEY` |
| 4 | `actions/transcription:transcribeVideo` | `GROQ_API_KEY` |
| 5 | `actions/claudeVision:generateVideoSummary` | `ANTHROPIC_API_KEY` |
| 6 | `actions/embeddings:embedFrameKeywords` | `OPENAI_API_KEY` |
| 7 | `actions/embeddings:embedFrameImage` | `REPLICATE_API_TOKEN` |
| 8 | `actions/embeddings:embedVideoText` | `OPENAI_API_KEY` |
| 9 | `actions/search:hybridSearch` | `OPENAI_API_KEY` |

## Processing Pipeline

Each step can be run independently for testing:

### 1. Upload Video

```typescript
// Generate upload URL
const uploadUrl = await generateUploadUrl();

// Upload file to Convex storage
const response = await fetch(uploadUrl, {
  method: "POST",
  body: videoFile,
});
const { storageId } = await response.json();

// Create video record
const videoId = await createVideo({ filename: "video.mp4", storageId });
```

### 2. Extract Frames

```typescript
// Option A: Client-side extraction (recommended)
// Extract frames in browser using Canvas + Video element
// Then upload each frame and call:
await storeExtractedFrames({
  videoId,
  frames: [{ timestamp: 0, storageId: frame1StorageId }, ...],
});

// Option B: Get recommended timestamps
const { timestamps } = await getFrameTimestamps({ duration: 120 });
```

### 3. Analyze Frames with Claude Vision

```typescript
// Analyze a single frame
await analyzeFrame({ frameId });

// Analyze all frames for a video
await analyzeVideoFrames({ videoId, limit: 50 });

// Generate video summary from frame descriptions
await generateVideoSummary({ videoId });
```

### 4. Transcribe Video

```typescript
// Basic transcription
await transcribeVideo({ videoId });

// With timestamps for each segment
await transcribeWithSegments({ videoId });

// Test Groq connection
await testGroqConnection();
```

### 5. Generate Embeddings

```typescript
// Embed frame keywords (for semantic search)
await embedFrameKeywords({ frameId });

// Embed frame images with CLIP (for visual search)
await embedFrameImage({ frameId });

// Embed all frames for a video
await embedVideoFrames({ videoId, embedImages: true });

// Embed video transcript and summary
await embedVideoText({ videoId });
```

### 6. Search

```typescript
// Hybrid search across all embedding types
const results = await hybridSearch({
  query: "red shirt",
  limit: 20,
  weights: {
    image: 0.35,
    keywords: 0.30,
    transcript: 0.20,
    summary: 0.15,
  },
});

// Simple text search (no embeddings needed)
const results = await simpleTextSearch({ query: "red shirt" });
```

## Testing Individual Steps

From the Convex Dashboard, you can test each function:

1. **Test API connections:**
   - `testGroqConnection` - Verify Groq API key works
   - `testOpenAIConnection` - Verify OpenAI API key works

2. **Test frame analysis:**
   - Upload a test image to storage
   - Create a frame record manually
   - Run `analyzeFrame` on it

3. **Test embeddings:**
   - Run `embedText({ text: "test query" })` to verify OpenAI
   - Run `embedImage({ imageUrl: "..." })` to verify CLIP

## Vector Search Indexes

The schema defines these vector indexes:

| Table | Index | Dimensions | Use |
|-------|-------|------------|-----|
| frames | by_image_embedding | 512 | CLIP visual search |
| frames | by_keywords_embedding | 1536 | Keyword semantic search |
| videos | by_transcript_embedding | 1536 | Transcript search |
| videos | by_summary_embedding | 1536 | Summary search |

## Processing Status

Each video tracks its processing status:

```typescript
processingSteps: {
  framesExtracted: boolean,
  framesAnalyzed: boolean,
  transcribed: boolean,
  embedded: boolean,
}
```

Query videos by processing state:

```typescript
await getVideosByStatus({ status: "processing" });
```
