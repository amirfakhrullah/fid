import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Main videos table
  videos: defineTable({
    filename: v.string(),
    storageId: v.id("_storage"),
    duration: v.optional(v.number()), // seconds
    status: v.union(
      v.literal("uploading"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed")
    ),
    // Processing status for each step
    processingSteps: v.optional(
      v.object({
        framesExtracted: v.boolean(),
        framesAnalyzed: v.boolean(),
        transcribed: v.boolean(),
        embedded: v.boolean(),
      })
    ),
    // Video-level data
    transcript: v.optional(v.string()),
    transcriptEmbedding: v.optional(v.array(v.float64())),
    summary: v.optional(v.string()),
    summaryEmbedding: v.optional(v.array(v.float64())),
    // Groq analysis (transcript-based)
    groqAnalysis: v.optional(
      v.object({
        keywords: v.array(v.string()),
        categories: v.array(v.string()),
      })
    ),
    // Claude Vision analysis (optional, sampled frames approach)
    claudeAnalysis: v.optional(
      v.object({
        keyMoments: v.array(
          v.object({
            timestamp: v.union(v.number(), v.string()),
            description: v.string(),
          })
        ),
        keywords: v.array(v.string()),
        categories: v.array(v.string()),
      })
    ),
  })
    .index("by_status", ["status"])
    .vectorIndex("by_transcript_embedding", {
      vectorField: "transcriptEmbedding",
      dimensions: 1536, // OpenAI ada-002 dimensions
      filterFields: ["status"],
    })
    .vectorIndex("by_summary_embedding", {
      vectorField: "summaryEmbedding",
      dimensions: 1536,
      filterFields: ["status"],
    }),

  // Extracted frames from videos
  frames: defineTable({
    videoId: v.id("videos"),
    timestamp: v.number(), // seconds into video
    storageId: v.id("_storage"), // thumbnail image
    // Claude Vision analysis
    description: v.optional(v.string()),
    keywords: v.optional(v.array(v.string())),
    // Embeddings
    imageEmbedding: v.optional(v.array(v.float64())), // CLIP embedding
    keywordsEmbedding: v.optional(v.array(v.float64())), // text embedding of keywords
  })
    .index("by_video", ["videoId"])
    .index("by_video_timestamp", ["videoId", "timestamp"])
    .vectorIndex("by_image_embedding", {
      vectorField: "imageEmbedding",
      dimensions: 512, // CLIP ViT-B/32 dimensions
      filterFields: ["videoId"],
    })
    .vectorIndex("by_keywords_embedding", {
      vectorField: "keywordsEmbedding",
      dimensions: 1536,
      filterFields: ["videoId"],
    }),

  // Processing jobs queue (for tracking async work)
  processingJobs: defineTable({
    videoId: v.id("videos"),
    type: v.union(
      v.literal("extract_frames"),
      v.literal("analyze_frames"),
      v.literal("transcribe"),
      v.literal("embed_frames"),
      v.literal("embed_video")
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    error: v.optional(v.string()),
    progress: v.optional(v.number()), // 0-100
  })
    .index("by_video", ["videoId"])
    .index("by_status", ["status"])
    .index("by_type_status", ["type", "status"]),
});
