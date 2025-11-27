/**
 * Search Functions (Queries)
 *
 * Simple search functions that don't require Node.js runtime.
 * For hybrid vector search, see actions/search.ts
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

/**
 * Simple text search for testing (no embeddings)
 */
export const simpleTextSearch = query({
  args: {
    query: v.string(),
  },
  handler: async (ctx, args) => {
    const queryLower = args.query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    // Search through frames by keywords
    const allFrames = await ctx.db.query("frames").collect();
    const matchingFrames = allFrames.filter((frame) => {
      if (!frame.keywords) return false;
      const frameKeywords = frame.keywords.map((k) => k.toLowerCase());
      return queryWords.some((word) =>
        frameKeywords.some((k) => k.includes(word))
      );
    });

    // Group by video
    const videoFrames = new Map<string, typeof matchingFrames>();
    for (const frame of matchingFrames) {
      const videoId = frame.videoId as string;
      if (!videoFrames.has(videoId)) {
        videoFrames.set(videoId, []);
      }
      videoFrames.get(videoId)!.push(frame);
    }

    // Build results
    const results: Array<{
      videoId: string;
      filename: string;
      matchCount: number;
      timestamps: Array<{
        time: number;
        keywords: string[] | undefined;
        description: string | undefined;
      }>;
    }> = [];

    for (const [videoId, frames] of videoFrames) {
      const video = await ctx.db.get(videoId as Id<"videos">);
      if (!video) continue;

      results.push({
        videoId,
        filename: video.filename,
        matchCount: frames.length,
        timestamps: frames.map((f) => ({
          time: f.timestamp,
          keywords: f.keywords ?? undefined,
          description: f.description ?? undefined,
        })),
      });
    }

    return results;
  },
});
