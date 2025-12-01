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

    // Retry logic for rate limiting
    let retries = 0;
    const maxRetries = 5;
    let prediction;

    while (retries < maxRetries) {
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
            inputs: args.imageUrl,
          },
        }),
      });

      if (response.status === 429) {
        // Rate limited - parse retry_after and wait
        const errorData = await response.json();
        const retryAfter = errorData.retry_after || 10; // Default 10s if not specified
        console.log(
          `[Embeddings] Rate limited. Waiting ${retryAfter}s before retry ${retries + 1}/${maxRetries}...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, (retryAfter + 1) * 1000)
        ); // +1s buffer
        retries++;
        continue;
      }

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Replicate API error: ${response.status} - ${error}`);
      }

      prediction = await response.json();
      break; // Success - exit retry loop
    }

    if (!prediction) {
      throw new Error(
        `Failed to create prediction after ${maxRetries} retries due to rate limiting`
      );
    }

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

    // Handle different output formats from Replicate CLIP models
    let embedding: number[];

    if (Array.isArray(result.output)) {
      // Check if it's an array of objects [{embedding: [...]}] or direct numbers
      if (result.output.length > 0 && typeof result.output[0] === "object" && result.output[0]?.embedding) {
        embedding = result.output[0].embedding;
      } else {
        embedding = result.output;
      }
    } else if (result.output?.embedding) {
      // Object with embedding property
      embedding = result.output.embedding;
    } else {
      console.error("[Embeddings] Unexpected output format:", JSON.stringify(result.output).slice(0, 500));
      throw new Error(`Unexpected CLIP output format: ${typeof result.output}`);
    }

    return {
      embedding,
      dimensions: embedding.length,
    };
  },
});

/**
 * Generate text embedding using CLIP via Replicate
 * Use this for searching against CLIP image embeddings
 */
export const embedTextWithCLIP = action({
  args: {
    text: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiToken = process.env.REPLICATE_API_TOKEN;
    if (!apiToken) {
      throw new Error("REPLICATE_API_TOKEN environment variable is required");
    }

    // Retry logic for rate limiting
    let retries = 0;
    const maxRetries = 5;
    let prediction;

    while (retries < maxRetries) {
      const response = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          Authorization: `Token ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          version: REPLICATE_CLIP_MODEL.split(":")[1],
          input: {
            inputs: args.text,
          },
        }),
      });

      if (response.status === 429) {
        const errorData = await response.json();
        const retryAfter = errorData.retry_after || 10;
        console.log(
          `[Embeddings] Rate limited. Waiting ${retryAfter}s before retry ${retries + 1}/${maxRetries}...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, (retryAfter + 1) * 1000)
        );
        retries++;
        continue;
      }

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Replicate API error: ${response.status} - ${error}`);
      }

      prediction = await response.json();
      break;
    }

    if (!prediction) {
      throw new Error(
        `Failed to create prediction after ${maxRetries} retries due to rate limiting`
      );
    }

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
      throw new Error(`CLIP text embedding failed: ${result.error}`);
    }

    // Handle different output formats from Replicate CLIP models
    let embedding: number[];

    if (Array.isArray(result.output)) {
      if (result.output.length > 0 && typeof result.output[0] === "object" && result.output[0]?.embedding) {
        embedding = result.output[0].embedding;
      } else {
        embedding = result.output;
      }
    } else if (result.output?.embedding) {
      embedding = result.output.embedding;
    } else {
      console.error("[Embeddings] Unexpected output format:", JSON.stringify(result.output).slice(0, 500));
      throw new Error(`Unexpected CLIP output format: ${typeof result.output}`);
    }

    return {
      embedding,
      dimensions: embedding.length,
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
 * Embed frame image using OpenAI Vision (alternative to CLIP)
 * Uses GPT-4o-mini to describe the frame, then embeds the description
 * More cost-effective and uses OpenAI credits
 */
export const embedFrameImageWithOpenAI = action({
  args: {
    frameId: v.id("frames"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ success: true; frameId: string; dimensions: number; description: string }> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    const frame = await ctx.runQuery(api.frames.getFrame, {
      frameId: args.frameId,
    });

    if (!frame || !frame.url) {
      throw new Error(`Frame ${args.frameId} not found or has no URL`);
    }

    // Use GPT-4o-mini vision to describe the frame
    const visionResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: frame.url,
                  detail: "low", // Low detail for cost efficiency
                },
              },
              {
                type: "text",
                text: "Describe this video frame in 1-2 sentences. Focus on key visual elements, objects, people, colors, actions, and setting.",
              },
            ],
          },
        ],
        max_tokens: 150,
      }),
    });

    if (!visionResponse.ok) {
      const error = await visionResponse.text();
      throw new Error(`OpenAI Vision API error: ${visionResponse.status} - ${error}`);
    }

    const visionResult = await visionResponse.json();
    const description = visionResult.choices[0].message.content.trim();

    console.log(`[Embeddings] Frame description: ${description}`);

    // Embed the description
    const embeddingResult: { embedding: number[]; dimensions: number; tokens: number } =
      await ctx.runAction(api.actions.embeddings.embedText, {
        text: description,
      });

    // Store embedding (using same field as CLIP for compatibility)
    await ctx.runMutation(api.frames.updateFrameEmbeddings, {
      frameId: args.frameId,
      imageEmbedding: embeddingResult.embedding,
    });

    return {
      success: true,
      frameId: args.frameId as string,
      dimensions: embeddingResult.dimensions,
      description,
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
    useOpenAIVision: v.optional(v.boolean()), // Use OpenAI Vision instead of CLIP (default: false)
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

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      try {
        // Always embed keywords if available
        if (frame.keywords && frame.keywords.length > 0) {
          await ctx.runAction(api.actions.embeddings.embedFrameKeywords, {
            frameId: frame._id,
          });
        }

        // Optionally embed images
        if (args.embedImages) {
          if (args.useOpenAIVision) {
            // Use OpenAI Vision (no rate limiting needed, uses your credits)
            await ctx.runAction(api.actions.embeddings.embedFrameImageWithOpenAI, {
              frameId: frame._id,
            });
          } else {
            // Use CLIP via Replicate (with rate limiting)
            await ctx.runAction(api.actions.embeddings.embedFrameImage, {
              frameId: frame._id,
            });

            // Add delay except for the last frame
            if (i < frames.length - 1) {
              console.log(
                `[Embeddings] Waiting 200ms for rate limit (${i + 1}/${frames.length})...`
              );
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          }
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
