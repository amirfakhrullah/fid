import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Generate upload URL for frame thumbnail
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Create a frame record
export const createFrame = mutation({
  args: {
    videoId: v.id("videos"),
    timestamp: v.number(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("frames", {
      videoId: args.videoId,
      timestamp: args.timestamp,
      storageId: args.storageId,
    });
  },
});

// Batch create frames
export const createFramesBatch = mutation({
  args: {
    frames: v.array(
      v.object({
        videoId: v.id("videos"),
        timestamp: v.number(),
        storageId: v.id("_storage"),
      })
    ),
  },
  handler: async (ctx, args) => {
    const frameIds = await Promise.all(
      args.frames.map((frame) => ctx.db.insert("frames", frame))
    );
    return frameIds;
  },
});

// Update frame with Claude Vision analysis
export const updateFrameAnalysis = mutation({
  args: {
    frameId: v.id("frames"),
    description: v.string(),
    keywords: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.frameId, {
      description: args.description,
      keywords: args.keywords,
    });
  },
});

// Update frame embeddings
export const updateFrameEmbeddings = mutation({
  args: {
    frameId: v.id("frames"),
    imageEmbedding: v.optional(v.array(v.float64())),
    keywordsEmbedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, number[]> = {};
    if (args.imageEmbedding) {
      updates.imageEmbedding = args.imageEmbedding;
    }
    if (args.keywordsEmbedding) {
      updates.keywordsEmbedding = args.keywordsEmbedding;
    }
    await ctx.db.patch(args.frameId, updates);
  },
});

// Get frames for a video
export const getFramesByVideo = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const frames = await ctx.db
      .query("frames")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();

    return Promise.all(
      frames.map(async (frame) => ({
        ...frame,
        url: await ctx.storage.getUrl(frame.storageId),
      }))
    );
  },
});

// Get frame by ID with URL
export const getFrame = query({
  args: { frameId: v.id("frames") },
  handler: async (ctx, args) => {
    const frame = await ctx.db.get(args.frameId);
    if (!frame) return null;

    return {
      ...frame,
      url: await ctx.storage.getUrl(frame.storageId),
    };
  },
});

// Get frames without analysis (for processing queue)
export const getFramesWithoutAnalysis = query({
  args: { videoId: v.id("videos"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const frames = await ctx.db
      .query("frames")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();

    const unanalyzed = frames.filter((f) => !f.description);
    const limited = args.limit ? unanalyzed.slice(0, args.limit) : unanalyzed;

    return Promise.all(
      limited.map(async (frame) => ({
        ...frame,
        url: await ctx.storage.getUrl(frame.storageId),
      }))
    );
  },
});

// Get frames without embeddings
export const getFramesWithoutEmbeddings = query({
  args: { videoId: v.id("videos"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const frames = await ctx.db
      .query("frames")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();

    const unembedded = frames.filter((f) => !f.imageEmbedding);
    const limited = args.limit ? unembedded.slice(0, args.limit) : unembedded;

    return Promise.all(
      limited.map(async (frame) => ({
        ...frame,
        url: await ctx.storage.getUrl(frame.storageId),
      }))
    );
  },
});

// Delete all frames for a video
export const deleteFramesByVideo = mutation({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const frames = await ctx.db
      .query("frames")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();

    await Promise.all(
      frames.map(async (frame) => {
        await ctx.storage.delete(frame.storageId);
        await ctx.db.delete(frame._id);
      })
    );

    return frames.length;
  },
});
