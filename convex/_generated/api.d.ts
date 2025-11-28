/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_claudeVision from "../actions/claudeVision.js";
import type * as actions_embeddings from "../actions/embeddings.js";
import type * as actions_frameExtraction from "../actions/frameExtraction.js";
import type * as actions_groqAnalysis from "../actions/groqAnalysis.js";
import type * as actions_search from "../actions/search.js";
import type * as actions_transcription from "../actions/transcription.js";
import type * as actions_videoUpload from "../actions/videoUpload.js";
import type * as frames from "../frames.js";
import type * as myFunctions from "../myFunctions.js";
import type * as processing from "../processing.js";
import type * as search from "../search.js";
import type * as videos from "../videos.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/claudeVision": typeof actions_claudeVision;
  "actions/embeddings": typeof actions_embeddings;
  "actions/frameExtraction": typeof actions_frameExtraction;
  "actions/groqAnalysis": typeof actions_groqAnalysis;
  "actions/search": typeof actions_search;
  "actions/transcription": typeof actions_transcription;
  "actions/videoUpload": typeof actions_videoUpload;
  frames: typeof frames;
  myFunctions: typeof myFunctions;
  processing: typeof processing;
  search: typeof search;
  videos: typeof videos;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
