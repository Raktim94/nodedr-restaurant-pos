import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SessionUser } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class AiGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async extractInvoice(
    user: SessionUser,
    body: { text?: string; imageBase64?: string; mimeType?: string },
  ) {
    if (body.text?.trim()) return this.parseInvoiceText(body.text);
    if (!body.imageBase64) {
      throw new BadRequestException('text or imageBase64 is required');
    }
    if (body.imageBase64.length > 14_000_000) {
      throw new BadRequestException(
        'Invoice image is too large (maximum 10 MB)',
      );
    }
    const endpoint = this.config.get<string>('AI_OCR_ENDPOINT');
    const apiKey = this.config.get<string>('AI_OCR_API_KEY');
    if (!endpoint || !apiKey) {
      throw new ServiceUnavailableException(
        'Invoice OCR provider is not configured; submit extracted text or configure AI_OCR_ENDPOINT and AI_OCR_API_KEY',
      );
    }
    await this.assertQuota(user.restaurantId, 'invoice-ocr');

    const started = Date.now();
    try {
      const result = await this.requestWithRetry(endpoint, apiKey, {
        feature: 'invoice-ocr',
        imageBase64: body.imageBase64,
        mimeType: body.mimeType ?? 'image/jpeg',
      });
      const text = typeof result.text === 'string' ? result.text : '';
      if (!text) throw new BadGatewayException('OCR provider returned no text');
      await this.logUsage(
        user,
        'invoice-ocr',
        'SUCCESS',
        result,
        Date.now() - started,
      );
      return { ...this.parseInvoiceText(text), rawText: text };
    } catch (error) {
      await this.logUsage(
        user,
        'invoice-ocr',
        'FAILED',
        {},
        Date.now() - started,
        error,
      );
      throw error;
    }
  }

  parseInvoiceText(text: string) {
    const clean = text.replace(/\r/g, '').trim();
    const invoiceNumber =
      clean.match(
        /(?:invoice|bill)\s*(?:no|number|#)\s*[:.-]?\s*([A-Z0-9][A-Z0-9\/-]*)/i,
      )?.[1] ?? null;
    const gstNumber =
      clean
        .match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/i)?.[0]
        ?.toUpperCase() ?? null;
    const date =
      clean.match(
        /(?:date)\s*[:.-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
      )?.[1] ?? null;
    const totalMatches = [
      ...clean.matchAll(
        /(?:grand\s*total|invoice\s*total|total)\s*[:₹$ ]*([\d,]+(?:\.\d{1,2})?)/gi,
      ),
    ];
    const total = totalMatches.length
      ? Number(totalMatches.at(-1)![1].replace(/,/g, ''))
      : null;
    return {
      invoiceNumber,
      invoiceDate: date,
      gstNumber,
      totalAmount: Number.isFinite(total) ? total : null,
      confidence: [invoiceNumber, date, total].filter(Boolean).length / 3,
      requiresHumanReview: !invoiceNumber || !date || !Number.isFinite(total),
    };
  }

  private async assertQuota(restaurantId: string, provider: string) {
    const quota = await this.prisma.apiQuota.findUnique({
      where: { restaurantId_provider: { restaurantId, provider } },
    });
    if (!quota) return;
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const month = new Date(now.getFullYear(), now.getMonth(), 1);
    const [daily, monthly] = await Promise.all([
      quota.dailyLimit == null
        ? 0
        : this.prisma.aiUsageLog.count({
            where: { restaurantId, provider, createdAt: { gte: day } },
          }),
      quota.monthlyLimit == null
        ? 0
        : this.prisma.aiUsageLog.count({
            where: { restaurantId, provider, createdAt: { gte: month } },
          }),
    ]);
    if (
      (quota.dailyLimit != null && daily >= quota.dailyLimit) ||
      (quota.monthlyLimit != null && monthly >= quota.monthlyLimit)
    ) {
      throw new HttpException(
        'Company AI quota has been reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async requestWithRetry(
    endpoint: string,
    apiKey: string,
    payload: unknown,
  ): Promise<Record<string, unknown>> {
    const delays = [0, 1000, 3000, 7000];
    let lastError: Error | null = null;
    for (const delay of delays) {
      if (delay) await sleep(delay + Math.floor(Math.random() * 300));
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });
        if (response.ok)
          return (await response.json()) as Record<string, unknown>;
        if (response.status !== 429 && response.status < 500) {
          throw new BadGatewayException(
            `OCR provider rejected the request (${response.status})`,
          );
        }
        lastError = new Error(
          `OCR provider temporary error ${response.status}`,
        );
      } catch (error) {
        if (error instanceof BadGatewayException) throw error;
        lastError =
          error instanceof Error ? error : new Error('OCR request failed');
      }
    }
    throw new BadGatewayException(
      lastError?.message ?? 'OCR provider unavailable',
    );
  }

  private async logUsage(
    user: SessionUser,
    feature: string,
    status: string,
    result: Record<string, unknown>,
    durationMs: number,
    error?: unknown,
  ) {
    await this.prisma.aiUsageLog
      .create({
        data: {
          restaurantId: user.restaurantId,
          userId: user.id,
          provider: 'invoice-ocr',
          model: String(result.model ?? 'configured-provider'),
          feature,
          inputTokens: Number(result.inputTokens ?? 0),
          outputTokens: Number(result.outputTokens ?? 0),
          estimatedCost: Number(result.estimatedCost ?? 0),
          status,
          errorCode: error instanceof Error ? error.name : null,
          requestId:
            typeof result.requestId === 'string' ? result.requestId : undefined,
        },
      })
      .catch(() => undefined);
    void durationMs;
  }
}
