"use node";
/**
 * Hybrid Search Action
 *
 * Vector search across multiple embedding types:
 * - Frame keyword embeddings (semantic object search)
 * - Video transcript embeddings (spoken content)
 * - Video summary embeddings (overall context)
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { Id } from "../_generated/dataModel";

// Search result types
interface FrameMatch {
  frameId: string;
  videoId: string;
  timestamp: number;
  score: number;
  source: "image" | "keywords";
  description?: string;
  keywords?: string[];
  thumbnailUrl?: string;
}

interface VideoMatch {
  videoId: string;
  filename: string;
  score: number;
  source: "transcript" | "summary";
  transcript?: string;
  summary?: string;
}

interface SearchResult {
  videoId: string;
  filename: string;
  videoUrl?: string;
  matches: Array<{
    startTime: number;
    endTime: number;
    confidence: number;
    previewUrl?: string;
    sources: string[];
    description?: string;
  }>;
  overallScore: number;
}

// Default weights for hybrid search
const DEFAULT_WEIGHTS = {
  image: 0.35,
  keywords: 0.30,
  transcript: 0.20,
  summary: 0.15,
};

/**
 * Main hybrid search action
 */
export const hybridSearch = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    weights: v.optional(
      v.object({
        image: v.number(),
        keywords: v.number(),
        transcript: v.number(),
        summary: v.number(),
      })
    ),
  },
  handler: async (ctx, args): Promise<{
    query: string;
    results: SearchResult[];
    totalMatches: number;
  }> => {
    const weights = args.weights ?? DEFAULT_WEIGHTS;
    const limit = args.limit ?? 20;

    console.log(`[Search] Query: "${args.query}"`);
    console.log(`[Search] Weights:`, weights);

    // Generate query embeddings
    // OpenAI embedding for text-based search (keywords, transcript, summary)
    const textEmbeddingResult = await ctx.runAction(
      api.actions.embeddings.embedText,
      { text: args.query }
    );
    const textEmbedding = textEmbeddingResult.embedding;

    // CLIP embedding for image search (only if image weight > 0)
    let clipEmbedding: number[] | null = null;
    if (weights.image > 0) {
      const clipEmbeddingResult = await ctx.runAction(
        api.actions.embeddings.embedTextWithCLIP,
        { text: args.query }
      );
      clipEmbedding = clipEmbeddingResult.embedding;
      console.log(`[Search] CLIP embedding dimensions: ${clipEmbeddingResult.dimensions}`);
    }

    // Collect all matches
    const frameMatches: FrameMatch[] = [];
    const videoMatches: VideoMatch[] = [];

    // Search image embeddings with CLIP
    if (weights.image > 0 && clipEmbedding) {
      const imageResults = await ctx.vectorSearch("frames", "by_image_embedding", {
        vector: clipEmbedding,
        limit: limit * 2,
      });

      for (const result of imageResults) {
        const frame = await ctx.runQuery(api.frames.getFrame, {
          frameId: result._id,
        });
        if (frame) {
          frameMatches.push({
            frameId: result._id as string,
            videoId: frame.videoId as string,
            timestamp: frame.timestamp,
            score: result._score * weights.image,
            source: "image",
            description: frame.description ?? undefined,
            keywords: frame.keywords ?? undefined,
            thumbnailUrl: frame.url ?? undefined,
          });
        }
      }
    }

    // Search keywords embeddings
    if (weights.keywords > 0) {
      const keywordResults = await ctx.vectorSearch("frames", "by_keywords_embedding", {
        vector: textEmbedding,
        limit: limit * 2,
      });

      for (const result of keywordResults) {
        const frame = await ctx.runQuery(api.frames.getFrame, {
          frameId: result._id,
        });
        if (frame) {
          frameMatches.push({
            frameId: result._id as string,
            videoId: frame.videoId as string,
            timestamp: frame.timestamp,
            score: result._score * weights.keywords,
            source: "keywords",
            description: frame.description ?? undefined,
            keywords: frame.keywords ?? undefined,
            thumbnailUrl: frame.url ?? undefined,
          });
        }
      }
    }

    // Search transcript embeddings
    if (weights.transcript > 0) {
      const transcriptResults = await ctx.vectorSearch(
        "videos",
        "by_transcript_embedding",
        {
          vector: textEmbedding,
          limit: 10,
          filter: (q) => q.eq("status", "ready"),
        }
      );

      for (const result of transcriptResults) {
        const video = await ctx.runQuery(api.videos.getVideo, {
          videoId: result._id,
        });
        if (video) {
          videoMatches.push({
            videoId: result._id as string,
            filename: video.filename,
            score: result._score * weights.transcript,
            source: "transcript",
            transcript: video.transcript ?? undefined,
          });
        }
      }
    }

    // Search summary embeddings
    if (weights.summary > 0) {
      const summaryResults = await ctx.vectorSearch(
        "videos",
        "by_summary_embedding",
        {
          vector: textEmbedding,
          limit: 10,
          filter: (q) => q.eq("status", "ready"),
        }
      );

      for (const result of summaryResults) {
        const video = await ctx.runQuery(api.videos.getVideo, {
          videoId: result._id,
        });
        if (video) {
          videoMatches.push({
            videoId: result._id as string,
            filename: video.filename,
            score: result._score * weights.summary,
            source: "summary",
            summary: video.summary ?? undefined,
          });
        }
      }
    }

    // Aggregate results by video
    const videoResults = aggregateResults(frameMatches, videoMatches);

    // Sort by overall score and limit
    const sortedResults = videoResults
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, limit);

    // Add video URLs
    const resultsWithUrls: SearchResult[] = await Promise.all(
      sortedResults.map(async (result): Promise<SearchResult> => {
        const video = await ctx.runQuery(api.videos.getVideo, {
          videoId: result.videoId as Id<"videos">,
        });
        return {
          ...result,
          videoUrl: video?.url ?? undefined,
          filename: video?.filename ?? result.filename,
        };
      })
    );

    return {
      query: args.query,
      results: resultsWithUrls,
      totalMatches: frameMatches.length + videoMatches.length,
    };
  },
});

/**
 * Aggregate frame and video matches into unified results
 */
function aggregateResults(
  frameMatches: FrameMatch[],
  videoMatches: VideoMatch[]
): SearchResult[] {
  const videoScores = new Map<
    string,
    {
      filename: string;
      totalScore: number;
      sources: Set<string>;
      frames: FrameMatch[];
    }
  >();

  // Process frame matches
  for (const match of frameMatches) {
    const videoId = match.videoId;
    if (!videoScores.has(videoId)) {
      videoScores.set(videoId, {
        filename: "",
        totalScore: 0,
        sources: new Set(),
        frames: [],
      });
    }
    const video = videoScores.get(videoId)!;
    video.totalScore += match.score;
    video.sources.add(match.source);
    video.frames.push(match);
  }

  // Process video matches
  for (const match of videoMatches) {
    const videoId = match.videoId;
    if (!videoScores.has(videoId)) {
      videoScores.set(videoId, {
        filename: match.filename,
        totalScore: 0,
        sources: new Set(),
        frames: [],
      });
    }
    const video = videoScores.get(videoId)!;
    video.filename = match.filename;
    video.totalScore += match.score;
    video.sources.add(match.source);
  }

  // Convert to results
  const results: SearchResult[] = [];
  for (const [videoId, data] of videoScores) {
    // Cluster nearby frames into time ranges
    const clusters = clusterTimestamps(data.frames);

    results.push({
      videoId,
      filename: data.filename,
      matches: clusters.map((cluster) => ({
        startTime: cluster.startTime,
        endTime: cluster.endTime,
        confidence: cluster.avgScore,
        previewUrl: cluster.frames[0]?.thumbnailUrl,
        sources: [...new Set(cluster.frames.map((f) => f.source))],
        description: cluster.frames[0]?.description,
      })),
      overallScore: data.totalScore,
    });
  }

  return results;
}

/**
 * Cluster nearby timestamps into ranges
 */
function clusterTimestamps(
  frames: FrameMatch[],
  maxGap: number = 5
): Array<{
  startTime: number;
  endTime: number;
  avgScore: number;
  frames: FrameMatch[];
}> {
  if (frames.length === 0) return [];

  // Sort by timestamp
  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);

  const clusters: Array<{
    startTime: number;
    endTime: number;
    avgScore: number;
    frames: FrameMatch[];
  }> = [];

  let currentCluster = {
    startTime: sorted[0].timestamp,
    endTime: sorted[0].timestamp,
    frames: [sorted[0]],
  };

  for (let i = 1; i < sorted.length; i++) {
    const frame = sorted[i];
    if (frame.timestamp - currentCluster.endTime <= maxGap) {
      // Add to current cluster
      currentCluster.endTime = frame.timestamp;
      currentCluster.frames.push(frame);
    } else {
      // Start new cluster
      const avgScore =
        currentCluster.frames.reduce((sum, f) => sum + f.score, 0) /
        currentCluster.frames.length;
      clusters.push({ ...currentCluster, avgScore });

      currentCluster = {
        startTime: frame.timestamp,
        endTime: frame.timestamp,
        frames: [frame],
      };
    }
  }

  // Don't forget the last cluster
  const avgScore =
    currentCluster.frames.reduce((sum, f) => sum + f.score, 0) /
    currentCluster.frames.length;
  clusters.push({ ...currentCluster, avgScore });

  return clusters;
}
