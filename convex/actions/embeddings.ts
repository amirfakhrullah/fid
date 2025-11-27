"use node";
/**
 * Embedding Generation Actions
 *
 * Generates embeddings for:
 * - Text (keywords, descriptions, transcripts, summaries) using OpenAI
 * - Images (video frames) using CLIP via Replicate or HuggingFace
 *
 * Required env vars:
 * - OPENAI_API_KEY (for text embeddings)
 * - REPLICATE_API_TOKEN (for CLIP image embeddings) - OR -
 * - HUGGINGFACE_API_KEY (alternative for CLIP)
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";

// OpenAI embedding model
const OPENAI_EMBEDDING_MODEL = "text-embedding-ada-002";
const OPENAI_EMBEDDING_DIMENSIONS = 1536;

// CLIP model on Replicate
const REPLICATE_CLIP_MODEL =
  "andreasjansson/clip-features:75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a";

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Generate text embedding using OpenAI
 */
export const embedText = action({
  args: {
    text: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_EMBEDDING_MODEL,
        input: args.text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const result = (await response.json()) as OpenAIEmbeddingResponse;
    return {
      embedding: result.data[0].embedding,
      dimensions: OPENAI_EMBEDDING_DIMENSIONS,
      tokens: result.usage.total_tokens,
    };
  },
});

/**
 * Generate image embedding using CLIP via Replicate
 */
export const embedImage = action({
  args: {
    imageUrl: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiToken = process.env.REPLICATE_API_TOKEN;
    if (!apiToken) {
      throw new Error("REPLICATE_API_TOKEN environment variable is required");
    }

    // Start prediction
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: REPLICATE_CLIP_MODEL.split(":")[1],
        input: {
          image: args.imageUrl,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Replicate API error: ${response.status} - ${error}`);
    }

    const prediction = await response.json();

    // Poll for completion
    let result = prediction;
    while (result.status !== "succeeded" && result.status !== "failed") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const pollResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            Authorization: `Token ${apiToken}`,
          },
        }
      );
      result = await pollResponse.json();
    }

    if (result.status === "failed") {
      throw new Error(`CLIP embedding failed: ${result.error}`);
    }

    return {
      embedding: result.output as number[],
      dimensions: 512, // CLIP ViT-B/32
    };
  },
});

/**
 * Embed frame keywords
 */
export const embedFrameKeywords = action({
  args: {
    frameId: v.id("frames"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ success: true; frameId: string; dimensions: number }> => {
    const frame = await ctx.runQuery(api.frames.getFrame, {
      frameId: args.frameId,
    });

    if (!frame) {
      throw new Error(`Frame ${args.frameId} not found`);
    }

    if (!frame.keywords || frame.keywords.length === 0) {
      throw new Error(`Frame ${args.frameId} has no keywords`);
    }

    // Combine keywords into searchable text
    const keywordsText: string = frame.keywords.join(", ");

    // Get embedding
    const result: { embedding: number[]; dimensions: number; tokens: number } =
      await ctx.runAction(api.actions.embeddings.embedText, {
        text: keywordsText,
      });

    // Store embedding
    await ctx.runMutation(api.frames.updateFrameEmbeddings, {
      frameId: args.frameId,
      keywordsEmbedding: result.embedding,
    });

    return {
      success: true,
      frameId: args.frameId as string,
      dimensions: result.dimensions,
    };
  },
});

/**
 * Embed frame image using CLIP
 */
export const embedFrameImage = action({
  args: {
    frameId: v.id("frames"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ success: true; frameId: string; dimensions: number }> => {
    const frame = await ctx.runQuery(api.frames.getFrame, {
      frameId: args.frameId,
    });

    if (!frame || !frame.url) {
      throw new Error(`Frame ${args.frameId} not found or has no URL`);
    }

    // Get CLIP embedding
    const result: { embedding: number[]; dimensions: number } =
      await ctx.runAction(api.actions.embeddings.embedImage, {
        imageUrl: frame.url,
      });

    // Store embedding
    await ctx.runMutation(api.frames.updateFrameEmbeddings, {
      frameId: args.frameId,
      imageEmbedding: result.embedding,
    });

    return {
      success: true,
      frameId: args.frameId as string,
      dimensions: result.dimensions,
    };
  },
});

/**
 * Embed all frames for a video
 */
export const embedVideoFrames = action({
  args: {
    videoId: v.id("videos"),
    embedImages: v.optional(v.boolean()), // Whether to embed images (slower, costs more)
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const frames = await ctx.runQuery(api.frames.getFramesWithoutEmbeddings, {
      videoId: args.videoId,
      limit: args.limit,
    });

    if (frames.length === 0) {
      return {
        success: true,
        message: "No frames to embed",
        embedded: 0,
      };
    }

    console.log(`[Embeddings] Processing ${frames.length} frames...`);

    const results: Array<{
      frameId: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const frame of frames) {
      try {
        // Always embed keywords if available
        if (frame.keywords && frame.keywords.length > 0) {
          await ctx.runAction(api.actions.embeddings.embedFrameKeywords, {
            frameId: frame._id,
          });
        }

        // Optionally embed images with CLIP
        if (args.embedImages) {
          await ctx.runAction(api.actions.embeddings.embedFrameImage, {
            frameId: frame._id,
          });
        }

        results.push({ frameId: frame._id, success: true });
      } catch (error) {
        results.push({
          frameId: frame._id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    // Check if all frames are embedded
    const remainingFrames = await ctx.runQuery(
      api.frames.getFramesWithoutEmbeddings,
      { videoId: args.videoId }
    );

    if (remainingFrames.length === 0) {
      await ctx.runMutation(api.videos.updateProcessingStep, {
        videoId: args.videoId,
        step: "embedded",
        value: true,
      });
    }

    return {
      success: true,
      embedded: successCount,
      failed: results.length - successCount,
      results,
    };
  },
});

/**
 * Embed video transcript and summary
 */
export const embedVideoText = action({
  args: {
    videoId: v.id("videos"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: true;
    embeddedTranscript: boolean;
    embeddedSummary: boolean;
  }> => {
    const video = await ctx.runQuery(api.videos.getVideo, {
      videoId: args.videoId,
    });

    if (!video) {
      throw new Error(`Video ${args.videoId} not found`);
    }

    const embeddings: {
      transcriptEmbedding?: number[];
      summaryEmbedding?: number[];
    } = {};

    // Embed transcript
    if (video.transcript) {
      console.log(`[Embeddings] Embedding transcript...`);
      const transcriptResult: {
        embedding: number[];
        dimensions: number;
        tokens: number;
      } = await ctx.runAction(api.actions.embeddings.embedText, {
        text: video.transcript.slice(0, 8000), // Limit to ~8k chars for token limits
      });
      embeddings.transcriptEmbedding = transcriptResult.embedding;
    }

    // Embed summary
    if (video.summary) {
      console.log(`[Embeddings] Embedding summary...`);
      const summaryResult: {
        embedding: number[];
        dimensions: number;
        tokens: number;
      } = await ctx.runAction(api.actions.embeddings.embedText, {
        text: video.summary,
      });
      embeddings.summaryEmbedding = summaryResult.embedding;
    }

    // Store embeddings
    if (embeddings.transcriptEmbedding || embeddings.summaryEmbedding) {
      await ctx.runMutation(api.videos.storeVideoEmbeddings, {
        videoId: args.videoId,
        ...embeddings,
      });
    }

    return {
      success: true,
      embeddedTranscript: !!embeddings.transcriptEmbedding,
      embeddedSummary: !!embeddings.summaryEmbedding,
    };
  },
});

/**
 * Test OpenAI connection
 */
export const testOpenAIConnection = action({
  args: {},
  handler: async () => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { success: false, error: "OPENAI_API_KEY not set" };
    }

    try {
      const result = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_EMBEDDING_MODEL,
          input: "test",
        }),
      });

      if (!result.ok) {
        return { success: false, error: `API error: ${result.status}` };
      }

      return { success: true, message: "OpenAI API connection successful" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
