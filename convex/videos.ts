import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Generate upload URL for video file
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Create video record after upload
export const createVideo = mutation({
  args: {
    filename: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const videoId = await ctx.db.insert("videos", {
      filename: args.filename,
      storageId: args.storageId,
      status: "uploading",
      processingSteps: {
        framesExtracted: false,
        framesAnalyzed: false,
        transcribed: false,
        embedded: false,
      },
    });
    return videoId;
  },
});

// Update video status
export const updateVideoStatus = mutation({
  args: {
    videoId: v.id("videos"),
    status: v.union(
      v.literal("uploading"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, { status: args.status });
  },
});

// Update processing step
export const updateProcessingStep = mutation({
  args: {
    videoId: v.id("videos"),
    step: v.union(
      v.literal("framesExtracted"),
      v.literal("framesAnalyzed"),
      v.literal("transcribed"),
      v.literal("embedded")
    ),
    value: v.boolean(),
  },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) throw new Error("Video not found");

    const processingSteps = video.processingSteps ?? {
      framesExtracted: false,
      framesAnalyzed: false,
      transcribed: false,
      embedded: false,
    };

    await ctx.db.patch(args.videoId, {
      processingSteps: {
        ...processingSteps,
        [args.step]: args.value,
      },
    });
  },
});

// Store transcript
export const storeTranscript = mutation({
  args: {
    videoId: v.id("videos"),
    transcript: v.string(),
    duration: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      transcript: args.transcript,
      duration: args.duration,
    });
  },
});

// Store summary
export const storeSummary = mutation({
  args: {
    videoId: v.id("videos"),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, { summary: args.summary });
  },
});

// Update video duration
export const updateVideoDuration = mutation({
  args: {
    videoId: v.id("videos"),
    duration: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, { duration: args.duration });
  },
});

// Store video-level embeddings
export const storeVideoEmbeddings = mutation({
  args: {
    videoId: v.id("videos"),
    transcriptEmbedding: v.optional(v.array(v.float64())),
    summaryEmbedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, number[]> = {};
    if (args.transcriptEmbedding) {
      updates.transcriptEmbedding = args.transcriptEmbedding;
    }
    if (args.summaryEmbedding) {
      updates.summaryEmbedding = args.summaryEmbedding;
    }
    await ctx.db.patch(args.videoId, updates);
  },
});

// Get video by ID
export const getVideo = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) return null;

    const url = await ctx.storage.getUrl(video.storageId);
    return { ...video, url };
  },
});

// List all videos
export const listVideos = query({
  args: {},
  handler: async (ctx) => {
    const videos = await ctx.db.query("videos").order("desc").collect();
    return Promise.all(
      videos.map(async (video) => ({
        ...video,
        url: await ctx.storage.getUrl(video.storageId),
      }))
    );
  },
});

// Get videos by status
export const getVideosByStatus = query({
  args: {
    status: v.union(
      v.literal("uploading"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed")
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("videos")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();
  },
});
