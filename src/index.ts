#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CallToolRequest,
  ListToolsRequest,
  ListPromptsRequest,
  GetPromptRequest,
  Tool,
  Prompt,
  GetPromptResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Logger } from "./utils/logger.js";
import { PROTOCOL, ToolArguments } from "./constants.js";

import { 
  getToolDefinitions, 
  getPromptDefinitions, 
  executeTool, 
  toolExists, 
  getPromptMessage 
} from "./tools/index.js";

const server = new Server(
  {
    name: "gemini-mcp-tool",
    version: "3.0.3",
  },{
    capabilities: {
      tools: {},
      prompts: {},
      notifications: {},
      logging: {},
    },
  },
);

async function sendNotification(method: string, params: any) {
  try {
    await server.notification({ method, params });
  } catch (error) {
    Logger.error("notification failed: ", error);
  }
}

/**
 * @param progressToken The progress token provided by the client
 * @param progress The current progress value
 * @param total Optional total value
 * @param message Optional status message
 */
async function sendProgressNotification(
  progressToken: string | number | undefined,
  progress: number,
  total?: number,
  message?: string
) {
  if (progressToken === undefined || progressToken === null) return; // Only send if client requested progress
  
  try {
    const params: any = {
      progressToken,
      progress
    };
    
    if (total !== undefined) params.total = total; // future cache progress
    if (message) params.message = message;
    
    await server.notification({
      method: PROTOCOL.NOTIFICATIONS.PROGRESS,
      params
    });
  } catch (error) {
    Logger.error("Failed to send progress notification:", error);
  }
}

/** Per-request progress state (avoids global state race conditions) */
interface ProgressState {
  interval: NodeJS.Timeout;
  progressToken?: string | number;
  operationName: string;
  latestOutput: string;
  isActive: boolean;
  stop: (success: boolean) => void;
  updateOutput: (output: string) => void;
}

function startProgressUpdates(
  operationName: string,
  progressToken?: string | number
): ProgressState {
  const hasProgressToken = progressToken !== undefined && progressToken !== null;

  // Per-request state - no global variables
  let isActive = true;
  let latestOutput = "";
  let messageIndex = 0;
  let progress = 0;

  const progressMessages = [
    `🧠 ${operationName} - Analyzing your request...`,
    `📊 ${operationName} - Processing files and generating insights...`,
    `✨ ${operationName} - Creating structured response for your review...`,
    `⏱️ ${operationName} - Large analysis in progress (this is normal for big requests)...`,
    `🔍 ${operationName} - Still working... Quality results take time...`,
  ];

  // Send immediate acknowledgment if progress requested
  if (hasProgressToken) {
    sendProgressNotification(
      progressToken,
      0,
      undefined, // No total - indeterminate progress
      `🔍 Starting ${operationName}`
    );
  }

  // Keep client alive with periodic updates
  const progressInterval = setInterval(async () => {
    if (isActive && hasProgressToken) {
      // Simply increment progress value
      progress += 1;

      // Include latest output if available
      const baseMessage = progressMessages[messageIndex % progressMessages.length];
      const outputPreview = latestOutput.slice(-150).trim(); // Last 150 chars
      const message = outputPreview
        ? `${baseMessage}\n📝 Output: ...${outputPreview}`
        : baseMessage;

      await sendProgressNotification(
        progressToken,
        progress,
        undefined, // No total - indeterminate progress
        message
      );
      messageIndex++;
    }
  }, PROTOCOL.KEEPALIVE_INTERVAL); // Every 25 seconds

  const stop = (success: boolean) => {
    isActive = false;
    clearInterval(progressInterval);

    // Send final progress notification if client requested progress
    if (hasProgressToken) {
      sendProgressNotification(
        progressToken,
        100,
        100,
        success ? `✅ ${operationName} completed successfully` : `❌ ${operationName} failed`
      );
    }
  };

  const updateOutput = (output: string) => {
    latestOutput = output;
  };

  return {
    interval: progressInterval,
    progressToken,
    operationName,
    latestOutput,
    isActive,
    stop,
    updateOutput,
  };
}

// tools/list
server.setRequestHandler(ListToolsRequestSchema, async (request: ListToolsRequest): Promise<{ tools: Tool[] }> => {
  return { tools: getToolDefinitions() as unknown as Tool[] };
});

// tools/get
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest): Promise<CallToolResult> => {
  const toolName: string = request.params.name;

  if (toolExists(toolName)) {
    // Check if client requested progress updates
    const progressToken = (request.params as any)._meta?.progressToken;

    // Start progress updates if client requested them (per-request state)
    const progressState = startProgressUpdates(toolName, progressToken);

    try {
      // Get prompt and other parameters from arguments with proper typing
      const args: ToolArguments = (request.params.arguments as ToolArguments) || {};

      Logger.toolInvocation(toolName, request.params.arguments);

      // Execute the tool using the unified registry with progress callback
      const result = await executeTool(toolName, args, (newOutput) => {
        progressState.updateOutput(newOutput);
      });

      // Stop progress updates
      progressState.stop(true);

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
        isError: false,
      };
    } catch (error) {
      // Stop progress updates on error
      progressState.stop(false);

      Logger.error(`Error in tool '${toolName}':`, error);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        content: [
          {
            type: "text",
            text: `Error executing ${toolName}: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  } else {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

// prompts/list
server.setRequestHandler(ListPromptsRequestSchema, async (request: ListPromptsRequest): Promise<{ prompts: Prompt[] }> => {
  return { prompts: getPromptDefinitions() as unknown as Prompt[] };
});

// prompts/get
server.setRequestHandler(GetPromptRequestSchema, async (request: GetPromptRequest): Promise<GetPromptResult> => {
  const promptName = request.params.name;
  const args = request.params.arguments || {};
  
  const promptMessage = getPromptMessage(promptName, args);
  
  if (!promptMessage) {
    throw new Error(`Unknown prompt: ${promptName}`);
  }
  
  return { 
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: promptMessage
      }
    }]
  };
});

// Start the server
async function main() {
  Logger.debug("init ai-cli-mcp-server");
  const transport = new StdioServerTransport(); await server.connect(transport);
  Logger.debug("ai-cli-mcp-server listening on stdio");
} main().catch((error) => {Logger.error("Fatal error:", error); process.exit(1); }); 
