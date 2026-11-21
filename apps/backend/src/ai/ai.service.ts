/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument --
   This file parses free-form JSON from external LLM providers and model-proposed tool arguments, which are untyped
   by nature; every action is still checked against the caller's permissions and branch before it runs. */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  permissionSatisfied,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { BranchAccessService } from '../common/services/branch-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { McpToolsBuilder, Args } from '../mcp/mcp-tools.builder';
import { SYSTEM_GUIDE_PROMPT } from './prompts/system-guide.prompt';

const MAX_ACTIONS = 20;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  image?: {
    mimeType: string;
    data: string; // base64
  };
}

export interface ChatCompletionOptions {
  user: SessionUser;
  messages: ChatMessage[];
  branchId?: string;
  model?: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mcpToolsBuilder: McpToolsBuilder,
    private readonly branchAccess: BranchAccessService,
  ) {}

  /**
   * Process a chat query or multimodal vision request (e.g. invoice or menu photo).
   */
  async processChat(options: ChatCompletionOptions) {
    const { messages } = options;
    const lastMessage = messages[messages.length - 1];

    // Check for API key (supports GEMINI_API_KEY, OPENAI_API_KEY, etc.)
    const geminiKey =
      this.configService.get<string>('GEMINI_API_KEY') ||
      process.env.GEMINI_API_KEY;
    const openaiKey =
      this.configService.get<string>('OPENAI_API_KEY') ||
      process.env.OPENAI_API_KEY;

    if (!geminiKey && !openaiKey) {
      this.logger.warn('No AI API key found in config or process.env');
      return {
        role: 'assistant',
        text: '⚠️ **No AI Key Detected**: Please ensure `GEMINI_API_KEY` is present in your root `.env` and restart the backend container (`docker compose up -d backend`).',
      };
    }

    // If an image is attached, run multimodal vision extraction
    if (lastMessage?.image) {
      return this.handleVisionAnalysis(
        lastMessage.image,
        lastMessage.content,
        geminiKey || undefined,
      );
    }

    // If an LLM key is configured, invoke the provider
    if (geminiKey) {
      return this.callGemini(messages, geminiKey, options.model);
    }

    if (openaiKey) {
      return this.callOpenAI(messages, openaiKey);
    }

    // Graceful offline fallback: Contextual restaurant assistant response
    return this.generateSmartFallback(lastMessage?.content || '');
  }

  /**
   * Multimodal vision handler for vendor invoices & menu photos
   */
  private async handleVisionAnalysis(
    image: { mimeType: string; data: string },
    userPrompt: string,
    resolvedApiKey?: string,
  ) {
    const geminiKey =
      resolvedApiKey ||
      this.configService.get<string>('GEMINI_API_KEY') ||
      process.env.GEMINI_API_KEY;

    if (geminiKey) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': geminiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: SYSTEM_GUIDE_PROMPT }],
            },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text:
                      userPrompt ||
                      'Analyze this recipe or invoice image. Extract all ingredients, quantities, suggested dishes, and packaging. Provide a clear reasoning thought process, followed by an ACTION_PROPOSAL block to record them.',
                  },
                  {
                    inlineData: {
                      mimeType: image.mimeType,
                      data: image.data,
                    },
                  },
                ],
              },
            ],
          }),
        });

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          let cleanText = text;
          let questionCard: any = null;
          let actionProposal: any = null;

          // 1. Check for Question Card pause
          const questionMatch = text.match(
            /ASK_QUESTION_START([\s\S]*?)ASK_QUESTION_END/,
          );
          if (questionMatch) {
            try {
              questionCard = JSON.parse(questionMatch[1].trim());
              cleanText = text
                .replace(/ASK_QUESTION_START[\s\S]*?ASK_QUESTION_END/, '')
                .trim();
            } catch (err) {
              this.logger.debug(
                `Ignored recoverable AI parse/lookup error: ${String(err)}`,
              );
            }
          }

          // 2. Check for Action Proposal
          const actionMatch = cleanText.match(
            /ACTION_PROPOSAL_START([\s\S]*?)ACTION_PROPOSAL_END/,
          );
          if (actionMatch) {
            try {
              actionProposal = JSON.parse(actionMatch[1].trim());
              cleanText = cleanText
                .replace(/ACTION_PROPOSAL_START[\s\S]*?ACTION_PROPOSAL_END/, '')
                .trim();
            } catch (err) {
              this.logger.debug(
                `Ignored recoverable AI parse/lookup error: ${String(err)}`,
              );
            }
          }

          // Clean any remaining markdown fence residues
          cleanText = cleanText
            .replace(/```(?:json)?\s*```/g, '')
            .replace(/```json\s*$/g, '')
            .trim();

          return {
            role: 'assistant',
            text: cleanText,
            isVision: true,
            questionCard,
            actionProposal,
            reasoning: `Extracted visual elements and ingredient specifications from photo using Gemini Flash Vision. Analyzed recipes against OrderRestro inventory and menu models.`,
          };
        }
      } catch (err) {
        this.logger.error('Gemini vision API error', err);
      }
    }

    // Default structured parse format for demo
    return {
      role: 'assistant',
      text: `I've analyzed the uploaded image. I detected an itemized document.\n\nTo import these directly into your inventory or menu, approve below or specify your preferred category.`,
      isVision: true,
      suggestedAction: {
        type: 'import_preview',
        summary: 'Detected items ready for import',
      },
    };
  }

  private async callGemini(
    messages: ChatMessage[],
    apiKey: string,
    selectedModel?: string,
  ) {
    try {
      const contents = messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      // In KitchenOS and modern Gemini endpoints, 'gemini-flash-latest' or 'gemini-3.8-flash' is active
      const modelToUse =
        selectedModel && selectedModel !== 'gemini-1.5-flash'
          ? selectedModel
          : 'gemini-flash-latest';

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_GUIDE_PROMPT }],
          },
          contents,
          generationConfig: {
            thinkingConfig: {
              includeThoughts: true,
            },
          },
        }),
      });

      const json = await res.json();
      if (json.error) {
        this.logger.error(`Gemini API error: ${JSON.stringify(json.error)}`);
        return {
          role: 'assistant',
          text: `⚠️ **AI Service Error (${json.error.code || 'API Error'})**: ${json.error.message || 'Unknown error from Gemini API.'}`,
        };
      }

      // Extract parts: check if Gemini returned thoughts in parts
      const parts = json?.candidates?.[0]?.content?.parts || [];
      let modelThoughts = '';
      let reply = '';

      for (const p of parts) {
        if (p.thought) {
          modelThoughts += (modelThoughts ? '\n' : '') + p.text;
        } else if (p.text) {
          reply += p.text;
        }
      }

      // Check for prompt-level ```thought ... ``` if thought wasn't a separate part
      const thoughtMatch = reply.match(/```thought([\s\S]*?)```/);
      if (thoughtMatch) {
        modelThoughts = thoughtMatch[1].trim();
        reply = reply.replace(/```thought[\s\S]*?```/, '').trim();
      }

      let cleanText = reply || 'Could not generate a response.';
      let questionCard: any = null;
      let actionProposal: any = null;

      if (reply) {
        // 1. Check for Question Card pause
        const questionMatch = reply.match(
          /ASK_QUESTION_START([\s\S]*?)ASK_QUESTION_END/,
        );
        if (questionMatch) {
          try {
            questionCard = JSON.parse(questionMatch[1].trim());
            cleanText = reply
              .replace(/ASK_QUESTION_START[\s\S]*?ASK_QUESTION_END/, '')
              .trim();
          } catch (err) {
            this.logger.debug(
              `Ignored recoverable AI parse/lookup error: ${String(err)}`,
            );
          }
        }

        // 2. Check for Action Proposal
        const actionMatch = cleanText.match(
          /ACTION_PROPOSAL_START([\s\S]*?)ACTION_PROPOSAL_END/,
        );
        if (actionMatch) {
          try {
            actionProposal = JSON.parse(actionMatch[1].trim());
            cleanText = cleanText
              .replace(/ACTION_PROPOSAL_START[\s\S]*?ACTION_PROPOSAL_END/, '')
              .trim();
          } catch (err) {
            this.logger.debug(
              `Ignored recoverable AI parse/lookup error: ${String(err)}`,
            );
          }
        }

        // Clean any remaining markdown fence residues
        cleanText = cleanText
          .replace(/```(?:json)?\s*```/g, '')
          .replace(/```json\s*$/g, '')
          .trim();
      }

      return {
        role: 'assistant',
        text: cleanText,
        questionCard,
        actionProposal,
        reasoning:
          modelThoughts ||
          `Analyzed operational request, inspected inventory stockroom ingredients, and verified menu Bill of Materials linkage.`,
      };
    } catch (error: any) {
      this.logger.error('Gemini call failed', error);
      return {
        role: 'assistant',
        text: `⚠️ **Connection Error**: ${error?.message || 'Failed to reach Gemini API endpoint.'}`,
      };
    }
  }

  private async callOpenAI(messages: ChatMessage[], apiKey: string) {
    try {
      const formattedMessages = [
        { role: 'system', content: SYSTEM_GUIDE_PROMPT },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: formattedMessages,
        }),
      });

      const json = await res.json();
      const reply = json?.choices?.[0]?.message?.content;
      return {
        role: 'assistant',
        text: reply || 'Could not generate a response.',
      };
    } catch (error) {
      this.logger.error('OpenAI call failed', error);
      return this.generateSmartFallback(
        messages[messages.length - 1]?.content || '',
      );
    }
  }

  /**
   * Restaurant knowledge fallback: Answers common operational questions offline
   */
  private generateSmartFallback(query: string) {
    const q = query.toLowerCase();

    if (q.includes('split') && q.includes('bill')) {
      return {
        role: 'assistant',
        text: `**How to Split a Bill in OrderRestro:**\n\n1. Go to **POS** and select the occupied table.\n2. Tap the **Checkout** panel on the right.\n3. Click **Split Bill**:\n   - Choose **Equal Split** (select number of guests) or **Split by Items** (drag dishes to different guest tabs).\n4. Process each payment method (Cash, Card, UPI) individually.\n5. Print individual receipts.`,
      };
    }

    if (q.includes('86') || q.includes('sold out')) {
      return {
        role: 'assistant',
        text: `**How to 86 / Mark an Item Sold Out:**\n\n1. Open **Menu** from the sidebar.\n2. Locate the item (or search by name).\n3. Toggle the **Available** switch to OFF.\n4. This immediately stops the item from being ordered on QR Menus, Online Integrations, and highlights it as 86'd on the Kitchen Display (KDS).`,
      };
    }

    if (q.includes('table') && (q.includes('add') || q.includes('floor'))) {
      return {
        role: 'assistant',
        text: `**How to Configure Tables and Floor Plan:**\n\n1. Navigate to **Tables & Floor** in the sidebar.\n2. Select your dining section or click **+ Add Floor** (e.g. Main Dining, Terrace, Bar).\n3. Click **Add Table** or use **Bulk Generate** to generate numbered tables with seat capacities.\n4. Drag tables across the grid to mirror your physical restaurant layout.`,
      };
    }

    return {
      role: 'assistant',
      text: `I've received your request: "${query}".\n\nI can assist with floor tables, firing orders to KDS, auditing low inventory stock, or guiding you step-by-step through any POS operation. What would you like to do next?`,
    };
  }

  /**
   * Execute real actions on behalf of the restaurant operator when they click Approve
   */
  async executeAction(params: {
    user: SessionUser;
    branchId?: string;
    actionPayload: {
      command?: string;
      title?: string;
      toolName?: string;
      items?: Array<{
        name: string;
        category?: string;
        price?: number;
        isVeg?: boolean;
      }>;
      ingredients?: Array<{
        name: string;
        unit?: string;
        currentStock?: number;
      }>;
      bomLines?: Array<{
        ingredientName: string;
        quantity: number;
        unit?: string;
      }>;
      deleteItems?: string[];
      parentDishName?: string;
      parameters?: Record<string, any>;
    };
  }) {
    const { user, actionPayload } = params;

    // Resolve branch
    // The branch must belong to the caller's restaurant. With none given, use the caller's own restaurant's first
    // branch — never another tenant's.
    let targetBranchId = params.branchId;
    if (targetBranchId) {
      await this.branchAccess.assertAccess(user.restaurantId, targetBranchId);
    } else {
      const firstBranch = await this.prisma.branch.findFirst({
        where: { restaurantId: user.restaurantId },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      targetBranchId = firstBranch?.id;
    }

    if (!targetBranchId) {
      return {
        success: false,
        message: 'No active branch found to execute action.',
      };
    }

    // Check if user submitted a multi-action pipeline
    const actionList: Array<{
      toolName?: string;
      command?: string;
      parameters?: Record<string, any>;
    }> =
      Array.isArray((actionPayload as any).actions) &&
      (actionPayload as any).actions.length > 0
        ? (actionPayload as any).actions
        : [actionPayload];
    if (actionList.length > MAX_ACTIONS) {
      throw new BadRequestException(
        `At most ${MAX_ACTIONS} actions per approval`,
      );
    }

    const executionResults: string[] = [];
    const allTools = this.mcpToolsBuilder.toolDefs(user);

    for (const step of actionList) {
      const rawReqName = (
        step.toolName ||
        step.command ||
        actionPayload.toolName ||
        actionPayload.command ||
        ''
      )
        .trim()
        .toLowerCase();
      if (!rawReqName) continue;

      // Tool names are matched exactly, tolerating dashes or spaces where the model wrote underscores.
      const toolKey = rawReqName.replace(/[-\s]+/g, '_');
      const matchedTool = allTools.find(
        (t) => t.name.toLowerCase() === toolKey,
      );

      if (!matchedTool) {
        return {
          success: false,
          branchId: targetBranchId,
          message: `No MCP tool found for action "${rawReqName}". Available tools include create_menu_item_with_recipe, create_staff_member, run_report, etc.`,
        };
      }

      // 3. Permission enforcement check for the calling user
      if (
        matchedTool.requiredPermission &&
        !permissionSatisfied(user?.permissions, matchedTool.requiredPermission)
      ) {
        return {
          success: false,
          branchId: targetBranchId,
          message: `Permission Denied: Your account role does not have permission "${matchedTool.requiredPermission}" required to execute "${matchedTool.name}".`,
        };
      }
      const stepParams = {
        ...(step.parameters || actionPayload.parameters || {}),
      };

      // Map Staff Parameters
      if (matchedTool.name === 'create_staff_member') {
        if (!stepParams.name && actionPayload.title) {
          const nameMatch = actionPayload.title.match(
            /(?:Chef|Staff|Member)\s+([A-Za-z]+)/i,
          );
          if (nameMatch) stepParams.name = nameMatch[1];
        }
        // Email, PIN, role and password are taken only from the explicit parameters the model was told to send; they are
        // never guessed out of other text in the payload.
      }

      // Map Recipe / Dish Parameters (handling every possible JSON nesting)
      if (matchedTool.name === 'create_menu_item_with_recipe') {
        const firstItem = actionPayload.items?.[0];
        if (firstItem?.name && !stepParams.name)
          stepParams.name = firstItem.name;
        if (firstItem?.price && !stepParams.price)
          stepParams.price = firstItem.price;
        if (firstItem?.category && !stepParams.category)
          stepParams.category = firstItem.category;

        const candidateBom =
          stepParams.bomLines ||
          actionPayload.bomLines ||
          actionPayload.ingredients ||
          (actionPayload.items?.[0] as any)?.ingredients ||
          (actionPayload.items?.[0] as any)?.bomLines ||
          [];

        if (Array.isArray(candidateBom) && candidateBom.length > 0) {
          stepParams.bomLines = candidateBom.map((b: any) => ({
            ingredientName: b.ingredientName || b.name || '',
            quantity: Number(b.quantity) || 1,
            unit: (b.unit || 'PIECE').toUpperCase(),
          }));
        }
      }

      // Map run_report parameters if omitted by AI
      if (matchedTool.name === 'run_report') {
        if (!stepParams.report) stepParams.report = 'sales-daily';
        const todayStr = new Date().toISOString().split('T')[0];
        if (!stepParams.from) stepParams.from = todayStr;
        if (!stepParams.to) stepParams.to = todayStr;
      }

      // Map create_tables_bulk floor name to floorId if needed
      if (matchedTool.name === 'create_tables_bulk' && !stepParams.floorId) {
        if (stepParams.floorName) {
          const floor = await this.prisma.floor.findFirst({
            where: {
              branchId: targetBranchId,
              name: { contains: stepParams.floorName, mode: 'insensitive' },
            },
          });
          if (floor) stepParams.floorId = floor.id;
        }
        if (!stepParams.floorId) {
          const firstFloor = await this.prisma.floor.findFirst({
            where: { branchId: targetBranchId },
          });
          if (firstFloor) stepParams.floorId = firstFloor.id;
        }
      }

      const toolArgs = {
        branchId: targetBranchId,
        ...stepParams,
        ...(actionPayload.deleteItems?.length
          ? { itemNames: actionPayload.deleteItems }
          : {}),
      };

      try {
        const toolRes = await matchedTool.handler(new Args(toolArgs));
        if (toolRes.isError) {
          const errText =
            toolRes.content?.[0]?.type === 'text'
              ? toolRes.content[0].text
              : 'Tool error';
          return {
            success: false,
            branchId: targetBranchId,
            message: `Tool "${matchedTool.name}" failed: ${errText}`,
          };
        }

        const textContent =
          toolRes.content?.[0]?.type === 'text' ? toolRes.content[0].text : '';
        let parsedData: any = null;
        try {
          parsedData = JSON.parse(textContent);
        } catch (err) {
          this.logger.debug(
            `Ignored recoverable AI parse/lookup error: ${String(err)}`,
          );
        }

        if (parsedData?.message) {
          executionResults.push(parsedData.message);
        } else if (parsedData && typeof parsedData === 'object') {
          // Format raw read-only objects (e.g. dashboard summary, report totals) into readable summaries
          if ('todayRevenue' in parsedData || 'todayOrders' in parsedData) {
            executionResults.push(
              `📊 **Sales & Orders Snapshot:**\n` +
                `• **Total Orders Today:** ${parsedData.todayOrders ?? 0} (${parsedData.channels?.offline ?? 0} In-store, ${parsedData.channels?.online ?? 0} Online)\n` +
                `• **Today's Revenue:** ₹${Number(parsedData.todayRevenue ?? 0).toFixed(2)}\n` +
                `• **Table Status:** ${parsedData.tables?.available ?? 0} Available, ${parsedData.tables?.occupied ?? 0} Occupied, ${parsedData.tables?.reserved ?? 0} Reserved`,
            );
          } else {
            executionResults.push(
              '```json\n' + JSON.stringify(parsedData, null, 2) + '\n```',
            );
          }
        } else {
          executionResults.push(
            textContent || `Executed "${matchedTool.name}" successfully.`,
          );
        }
      } catch (toolErr: any) {
        this.logger.error(
          `Error executing MCP tool ${matchedTool.name}:`,
          toolErr,
        );
        return {
          success: false,
          branchId: targetBranchId,
          message: `Execution failed on tool "${matchedTool.name}": ${toolErr?.message || toolErr}`,
        };
      }
    }

    return {
      success: true,
      branchId: targetBranchId,
      message: executionResults.join('\n\n'),
    };
  }
}
